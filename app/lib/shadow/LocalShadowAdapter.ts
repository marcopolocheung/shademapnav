import type maplibregl from 'maplibre-gl';
import SunCalc from 'suncalc';
import type { IShadowLayer } from './IShadowLayer';
import {
  type CacheAnchor,
  coversPoint,
  shouldRebuildCache,
} from '../shade/cachePolicy';
import {
  type BuildingPrism,
  buildShadowTriangles,
  metersPerDegree,
  pointInPrismShadow,
  prismsFromTileFeatures,
  triangulateRing,
} from '../shade/geometry';
import SunWorker from '../../workers/sunPosition.worker?worker';

// Shadow-edge antialiasing via supersampling: the shadow FBO is rendered at
// SHADOW_SUPERSAMPLE× the canvas resolution, then box-downsampled by the LINEAR
// composite quad (Pass D). 2 = 4 samples/pixel. Cost is ~4× shadow fragment work
// and FBO memory, so the supersampled dimension is capped at SHADOW_FBO_MAX_DIM
// (per-axis) to avoid blowing past GPU limits / memory on hi-DPR displays.
const SHADOW_SUPERSAMPLE = 2;
const SHADOW_FBO_MAX_DIM = 4096;

interface ShadowGeometry {
  shadowVerts: Float32Array;    // Mercator (x,y) shadow triangles
  shadowHeights: Float32Array;  // normalized height per shadow vertex (h/maxH)
  roofVerts: Float32Array;      // Mercator (x,y) building footprint triangles (un-offset)
  roofHeights: Float32Array;    // normalized height per roof vertex (h/maxH)
  sunBelowHorizon: boolean;
}

interface CachedBuildingGeometry {
  /** One entry per prism ring, ordered shortest building first (see `prismsFromTileFeatures`). */
  buildings: Array<{
    prism: BuildingPrism;
    normalizedH: number;
    /** Roof footprint, pre-triangulated and pre-offset to `centerMerc`. */
    mercatorRoofVerts: Float32Array;
  }>;
  maxH: number;
  centerMerc: [number, number];
  /** What this cache was built for — see `shouldRebuildCache`. */
  anchor: CacheAnchor;
}

/**
 * Local shadow renderer implemented as a MapLibre CustomLayer.
 *
 * This fixes the structural pan/zoom lag that occurred when we projected GeoJSON
 * into a separate 2D overlay canvas. By drawing inside MapLibre's WebGL render
 * loop with the provided camera matrix, the shadow geometry is rendered in the
 * exact same frame as tiles and other vector layers.
 */
export class LocalShadowAdapter implements IShadowLayer, maplibregl.CustomLayerInterface {
  /** MapLibre style layer id */
  id = 'local-shadow-layer';
  type: 'custom' = 'custom';
  renderingMode: '2d' = '2d';

  private map: maplibregl.Map | null = null;
  private gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;

  private currentDate: Date;
  private listeners: Map<string, Set<() => void>> = new Map();

  // WebGL resources
  private program: WebGLProgram | null = null;
  private positionBuffer: WebGLBuffer | null = null;
  private a_pos = -1;
  private u_matrix: WebGLUniformLocation | null = null;
  private u_color: WebGLUniformLocation | null = null;

  // Geometry cache
  private vertexCount = 0;
  private dirty = true;
  private cachedGeometry: ShadowGeometry = {
    shadowVerts: new Float32Array(),
    shadowHeights: new Float32Array(),
    roofVerts: new Float32Array(),
    roofHeights: new Float32Array(),
    sunBelowHorizon: false,
  };

  // Phase 2: Building geometry cache — invalidated on sourcedata/moveend/zoomend
  private buildingCache: CachedBuildingGeometry | null = null;

  // Phase 3: Buffer upload versioning — skip re-upload when geometry unchanged
  private geomVersion = 0;
  private lastUploadedVersion = -1;

  // Phase 1 + 4: Sun position tracking
  private lastSunAzDeg: number | null = null;
  private lastSunAltDeg: number | null = null;
  private lastSunAzRad: number | null = null;
  private lastSunAltRad: number | null = null;
  private sunWorker: Worker | null = null;

  // Offscreen FBO for single-write shadow compositing
  private fbo: WebGLFramebuffer | null = null;
  private fboTexture: WebGLTexture | null = null;
  private fboWidth = 0;
  private fboHeight = 0;

  // Height pass (Pass B): renders shadow geometry with height-as-grayscale
  private heightProgram: WebGLProgram | null = null;
  private heightAttrPos = -1;
  private heightAttrH = -1;
  private heightUMatrix: WebGLUniformLocation | null = null;
  private shadowHeightBuffer: WebGLBuffer | null = null;
  private heightFbo: WebGLFramebuffer | null = null;
  private heightFboTexture: WebGLTexture | null = null;

  // Roof exclusion pass (Pass C): erases self-shadow from roof footprints
  private roofProgram: WebGLProgram | null = null;
  private roofAttrPos = -1;
  private roofAttrH = -1;
  private roofUMatrix: WebGLUniformLocation | null = null;
  private roofUHeightTex: WebGLUniformLocation | null = null;
  private roofUResolution: WebGLUniformLocation | null = null;
  private roofPosBuffer: WebGLBuffer | null = null;
  private roofHeightBuffer: WebGLBuffer | null = null;

  // Full-screen quad for compositing FBO texture
  private quadProgram: WebGLProgram | null = null;
  private quadBuffer: WebGLBuffer | null = null;
  private quadAttrLoc = -1;
  private quadTexLoc: WebGLUniformLocation | null = null;

  /**
   * Discard the building cache only if the camera has actually invalidated it.
   *
   * Rebuilding is the most expensive routine here, and all three map events below
   * used to force one unconditionally — so a single pan paid for two (the source
   * settles *and* the move ends), and a follow camera paid on every settle. The
   * policy in `../shade/cachePolicy` decides; this just applies it.
   *
   * Always repaints regardless: the sun may have moved even when the geometry
   * has not.
   */
  private invalidateIfStale() {
    const map = this.map;
    if (!map) return;
    const center = map.getCenter();
    const stale = shouldRebuildCache(this.buildingCache?.anchor ?? null, {
      centerLng: center.lng,
      centerLat: center.lat,
      zoom: map.getZoom(),
      sourceLoaded: map.isSourceLoaded('maptiler_planet'),
    });
    if (stale) {
      this.buildingCache = null;
      this.dirty = true;
    }
    map.triggerRepaint();
  }

  // Map event handlers (bound so we can unregister)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private onSourceData = (e: any) => {
    // Rebuild only when all tiles for the source have finished loading,
    // not on every intermediate tile update (prevents flickering).
    if (!this.map) return;
    if (e?.sourceId === 'maptiler_planet' && this.map.isSourceLoaded('maptiler_planet')) {
      this.invalidateIfStale();
    }
  };

  private onZoomEnd = () => {
    this.invalidateIfStale();
  };

  private onMoveEnd = () => {
    this.lastSunAzDeg = null;
    this.lastSunAltDeg = null;
    this.invalidateIfStale();
  };

  // MapLibre expects premultiplied alpha for custom layers by default.
  // Shadow color interpolates from BASE_RGB (night/sunrise/sunset) to NOON_RGB (12:00 noon)
  // based on current sun altitude relative to its altitude at 12:00.
  private static readonly SHADOW_ALPHA = 0.7;
  // IMPORTANT: shadows MUST stay blue-dominant at every sun altitude — shade
  // routing detects them by blue dominance (app/lib/shadeSampling.ts). A neutral
  // gray shadow is invisible to the sampler (r≈g≈b → 0% coverage, single route).
  // So BOTH endpoints below are blue. NOON is a lighter blue for midday
  // visibility, not gray. (CLAUDE.md invariant #5: change one → change both.)
  private static readonly BASE_RGB: [number, number, number] = [1 / 255, 17 / 255, 47 / 255]; // #01112f
  private static readonly NOON_RGB: [number, number, number] = [0x22 / 255, 0x46 / 255, 0x7f / 255]; // #22467f (lighter blue)

  constructor(opts?: { date?: Date; id?: string }) {
    this.currentDate = opts?.date ?? new Date();
    if (opts?.id) this.id = opts.id;

    // Phase 4: Spawn sun position worker
    try {
      this.sunWorker = new SunWorker();
      this.sunWorker.onmessage = (e: MessageEvent<{
        azimuthDeg: number; altitudeDeg: number;
        azimuthRad: number; altitudeRad: number;
      }>) => {
        const { azimuthDeg, altitudeDeg, azimuthRad, altitudeRad } = e.data;
        // Phase 1: sun angle dirty check
        if (this.lastSunAzDeg != null && this.lastSunAltDeg != null
            && Math.abs(azimuthDeg - this.lastSunAzDeg) < 0.15
            && Math.abs(altitudeDeg - this.lastSunAltDeg) < 0.15) {
          return; // sun barely moved
        }
        this.lastSunAzDeg = azimuthDeg;
        this.lastSunAltDeg = altitudeDeg;
        this.lastSunAzRad = azimuthRad;
        this.lastSunAltRad = altitudeRad;
        this.dirty = true;
        this.map?.triggerRepaint();
      };
    } catch {
      // Worker unavailable (e.g. SSR) — will fall back to sync computation
      this.sunWorker = null;
    }
  }

  // ─── IShadowLayer ──────────────────────────────────────────────────────────

  setDate(date: Date) {
    this.currentDate = date;

    if (this.map && this.sunWorker) {
      // Phase 4: Delegate sun computation to worker — dirty check happens in onmessage
      const center = this.map.getCenter();
      this.sunWorker.postMessage({ lat: center.lat, lon: center.lng, timestamp: date.getTime() });
      return;
    }

    // Fallback: synchronous sun dirty check (Phase 1)
    if (this.map) {
      const center = this.map.getCenter();
      const sun = SunCalc.getPosition(date, center.lat, center.lng);
      const azDeg = sun.azimuth * 180 / Math.PI;
      const altDeg = sun.altitude * 180 / Math.PI;
      if (this.lastSunAzDeg != null && this.lastSunAltDeg != null
          && Math.abs(azDeg - this.lastSunAzDeg) < 0.15
          && Math.abs(altDeg - this.lastSunAltDeg) < 0.15) {
        return; // sun barely moved
      }
    }

    this.dirty = true;
    this.map?.triggerRepaint();
  }

  resize() {
    // FBO will be resized lazily in ensureFBO() on next render.
    this.dirty = true;
    this.map?.triggerRepaint();
  }

  remove() {
    // Remove this style layer; MapLibre will call onRemove for WebGL cleanup.
    if (!this.map) return;
    if (this.map.getLayer(this.id)) {
      try {
        this.map.removeLayer(this.id);
      } catch {
        // ignore transient style-update errors
      }
    }
  }

  setSunExposure(_enabled: boolean, _opts?: { startDate: Date; endDate: Date; iterations: number }) {
    // Accumulation mode not supported in local renderer — no-op
  }

  on(event: string, callback: () => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(callback);
  }

  queryPointShade(lng: number, lat: number, opts?: { date?: Date }) {
    if (!this.map) return null;
    if (!this.map.getBounds().contains([lng, lat])) return null;

    if (!this.buildingCache) {
      this.buildingCache = this.buildBuildingGeometryCache();
    }
    // The cache is now allowed to lag the viewport, so being inside the *viewport*
    // no longer means the cache holds buildings for this point. Answering from a
    // cache that never covered it would report open sun for ground we never looked
    // at — a confident wrong number, which is worse than a slow one. Rebuild for
    // the current camera and re-check rather than guess.
    if (!coversPoint(this.buildingCache.anchor, lng, lat)) {
      this.buildingCache = this.buildBuildingGeometryCache();
      if (!coversPoint(this.buildingCache.anchor, lng, lat)) return null;
    }
    const cache = this.buildingCache;
    if (!cache) return null;

    const queryDate = opts?.date ?? this.currentDate;
    const sun = SunCalc.getPosition(queryDate, lat, lng);
    if (sun.altitude <= 0) {
      return { shadeFraction: 1, source: "geometry-cache" as const };
    }

    const { mPerLat, mPerLng } = metersPerDegree(lat);
    const prisms = cache.buildings.map(b => b.prism);
    const offsetsM: Array<[number, number]> = [
      [0, 0],
      [-4, 0],
      [4, 0],
      [0, -4],
      [0, 4],
    ];

    let shaded = 0;
    for (const [dxM, dyM] of offsetsM) {
      const sampleLng = lng + dxM / mPerLng;
      const sampleLat = lat + dyM / mPerLat;
      if (pointInPrismShadow(prisms, sampleLng, sampleLat, sun.azimuth, sun.altitude, mPerLat, mPerLng)) {
        shaded++;
      }
    }

    return { shadeFraction: shaded / offsetsM.length, source: "geometry-cache" as const };
  }

  // ─── CustomLayerInterface ──────────────────────────────────────────────────

  onAdd(map: maplibregl.Map, gl: WebGL2RenderingContext | WebGLRenderingContext) {
    this.map = map;
    this.gl = gl;

    // Keep geometry cache in sync with streaming vector tiles.
    map.on('sourcedata', this.onSourceData);
    map.on('zoomend', this.onZoomEnd);
    map.on('moveend', this.onMoveEnd);

    // Compile minimal shader program
    const vsSrc = `
      attribute vec2 a_pos;
      uniform mat4 u_matrix;
      void main() {
        gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
      }
    `;
    const fsSrc = `
      precision mediump float;
      uniform vec4 u_color;
      void main() {
        gl_FragColor = u_color;
      }
    `;

    this.program = createProgram(gl, vsSrc, fsSrc);
    this.positionBuffer = gl.createBuffer();
    this.a_pos = gl.getAttribLocation(this.program, 'a_pos');
    this.u_matrix = gl.getUniformLocation(this.program, 'u_matrix');
    this.u_color = gl.getUniformLocation(this.program, 'u_color');

    // Compile height shader (Pass B): outputs normalized height as grayscale
    const heightVsSrc = `
      attribute vec2 a_pos;
      attribute float a_height;
      uniform mat4 u_matrix;
      varying float v_height;
      void main() {
        gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
        v_height = a_height;
      }
    `;
    const heightFsSrc = `
      precision mediump float;
      varying float v_height;
      void main() {
        gl_FragColor = vec4(v_height, v_height, v_height, 1.0);
      }
    `;
    this.heightProgram = createProgram(gl, heightVsSrc, heightFsSrc);
    this.heightAttrPos = gl.getAttribLocation(this.heightProgram, 'a_pos');
    this.heightAttrH = gl.getAttribLocation(this.heightProgram, 'a_height');
    this.heightUMatrix = gl.getUniformLocation(this.heightProgram, 'u_matrix');
    this.shadowHeightBuffer = gl.createBuffer();

    // Compile roof exclusion shader (Pass C): conditionally erases self-shadow
    const roofVsSrc = `
      attribute vec2 a_pos;
      attribute float a_height;
      uniform mat4 u_matrix;
      varying float v_height;
      void main() {
        gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
        v_height = a_height;
      }
    `;
    const roofFsSrc = `
      precision mediump float;
      uniform sampler2D u_heightTex;
      uniform vec2 u_resolution;
      varying float v_height;
      void main() {
        vec2 uv = gl_FragCoord.xy / u_resolution;
        float maxIncoming = texture2D(u_heightTex, uv).r;
        if (maxIncoming <= v_height + 0.004) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        } else {
          discard;
        }
      }
    `;
    this.roofProgram = createProgram(gl, roofVsSrc, roofFsSrc);
    this.roofAttrPos = gl.getAttribLocation(this.roofProgram, 'a_pos');
    this.roofAttrH = gl.getAttribLocation(this.roofProgram, 'a_height');
    this.roofUMatrix = gl.getUniformLocation(this.roofProgram, 'u_matrix');
    this.roofUHeightTex = gl.getUniformLocation(this.roofProgram, 'u_heightTex');
    this.roofUResolution = gl.getUniformLocation(this.roofProgram, 'u_resolution');
    this.roofPosBuffer = gl.createBuffer();
    this.roofHeightBuffer = gl.createBuffer();

    // Compile quad shader for FBO texture compositing
    const quadVsSrc = `
      attribute vec2 a_pos;
      varying vec2 v_uv;
      void main() {
        v_uv = a_pos * 0.5 + 0.5;
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }
    `;
    const quadFsSrc = `
      precision mediump float;
      uniform sampler2D u_texture;
      varying vec2 v_uv;
      void main() {
        gl_FragColor = texture2D(u_texture, v_uv);
      }
    `;
    this.quadProgram = createProgram(gl, quadVsSrc, quadFsSrc);
    this.quadAttrLoc = gl.getAttribLocation(this.quadProgram, 'a_pos');
    this.quadTexLoc = gl.getUniformLocation(this.quadProgram, 'u_texture');
    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1,  1, 1,
      -1, -1,  1, 1,  -1, 1,
    ]), gl.STATIC_DRAW);
  }

  render(gl: WebGL2RenderingContext | WebGLRenderingContext, options: maplibregl.CustomRenderMethodInput) {
    if (!this.map || !this.program || !this.positionBuffer || !this.u_matrix || !this.u_color) return;
    if (!this.quadProgram || !this.quadBuffer) return;

    // gl.MAX requires WebGL2 (guaranteed by MapLibre)
    const gl2 = gl as WebGL2RenderingContext;

    if (this.dirty) {
      // Phase 2: Rebuild building cache only when map view changed
      if (!this.buildingCache) {
        this.buildingCache = this.buildBuildingGeometryCache();
      }
      this.cachedGeometry = this.extrudeShadows(this.buildingCache);
      this.geomVersion++;
      this.dirty = false;
      this.emit('idle');
    }

    const geo = this.cachedGeometry;
    if (geo.shadowVerts.length === 0) return;

    // FBO passes (A/B/C) render at supersampled resolution for shadow-edge AA;
    // the final composite (Pass D) draws at the real canvas viewport, box-
    // downsampling via the LINEAR-filtered fboTexture. Cap each axis so the
    // supersampled buffer can't exceed GPU/memory limits.
    const cw = gl.canvas.width;
    const ch = gl.canvas.height;
    const ssW = Math.min(cw * SHADOW_SUPERSAMPLE, SHADOW_FBO_MAX_DIM);
    const ssH = Math.min(ch * SHADOW_SUPERSAMPLE, SHADOW_FBO_MAX_DIM);
    const w = ssW;
    const h = ssH;
    this.ensureFBO(gl, w, h);
    if (!this.fbo) return;

    // Phase 3: Only re-upload buffers when geometry actually changed
    if (this.geomVersion !== this.lastUploadedVersion) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, geo.shadowVerts, gl.DYNAMIC_DRAW);
      this.vertexCount = geo.shadowVerts.length / 2;

      if (this.shadowHeightBuffer) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.shadowHeightBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, geo.shadowHeights, gl.DYNAMIC_DRAW);
      }
      if (this.roofPosBuffer) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.roofPosBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, geo.roofVerts, gl.DYNAMIC_DRAW);
      }
      if (this.roofHeightBuffer) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.roofHeightBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, geo.roofHeights, gl.DYNAMIC_DRAW);
      }
      this.lastUploadedVersion = this.geomVersion;
    }

    // ── Save GL state ──
    const prevFBO = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const prevViewport = gl.getParameter(gl.VIEWPORT);
    const wasBlend = gl.isEnabled(gl.BLEND);
    const wasCull = gl.isEnabled(gl.CULL_FACE);
    const prevBlendSrcRGB = gl.getParameter(gl.BLEND_SRC_RGB);
    const prevBlendDstRGB = gl.getParameter(gl.BLEND_DST_RGB);
    const prevBlendSrcA = gl.getParameter(gl.BLEND_SRC_ALPHA);
    const prevBlendDstA = gl.getParameter(gl.BLEND_DST_ALPHA);
    const prevBlendEqRGB = gl.getParameter(gl.BLEND_EQUATION_RGB);
    const prevBlendEqA = gl.getParameter(gl.BLEND_EQUATION_ALPHA);
    const prevActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE);
    const prevTexture = gl.getParameter(gl.TEXTURE_BINDING_2D);

    // Compute adjusted projection matrix in Float64 to account for center offset.
    // Vertices are stored relative to centerMerc, so we pre-multiply a translation
    // by (cx, cy) into the matrix — done in Float64 on CPU before converting to
    // Float32 for the GPU, preserving sub-pixel precision.
    const mainMat = options.defaultProjectionData.mainMatrix;
    const [cx, cy] = this.buildingCache?.centerMerc ?? [0, 0];
    const m = new Float64Array(16);
    for (let i = 0; i < 16; i++) m[i] = Number(mainMat[i]);
    m[12] += m[0] * cx + m[4] * cy;
    m[13] += m[1] * cx + m[5] * cy;
    m[14] += m[2] * cx + m[6] * cy;
    m[15] += m[3] * cx + m[7] * cy;
    const matrix = new Float32Array(m);

    // ── Pass A: Render shadows into FBO with MAX blending ──
    gl2.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl2.viewport(0, 0, w, h);
    gl2.clearColor(0, 0, 0, 0);
    gl2.clear(gl.COLOR_BUFFER_BIT);

    gl2.useProgram(this.program);
    gl2.uniformMatrix4fv(this.u_matrix, false, matrix);
    const [r, g, b, a] = this.computeShadowColor(geo.sunBelowHorizon);
    gl2.uniform4f(this.u_color, r, g, b, a);

    gl2.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl2.enableVertexAttribArray(this.a_pos);
    gl2.vertexAttribPointer(this.a_pos, 2, gl.FLOAT, false, 0, 0);

    gl2.enable(gl.BLEND);
    gl2.blendEquation(gl2.MAX);
    gl2.blendFunc(gl.ONE, gl.ONE);
    gl2.disable(gl.CULL_FACE);

    gl2.drawArrays(gl.TRIANGLES, 0, this.vertexCount);

    // ── Pass B + C: Height-aware roof exclusion ──
    const roofVertexCount = geo.roofVerts.length / 2;
    if (!geo.sunBelowHorizon && roofVertexCount > 0 &&
        this.heightProgram && this.shadowHeightBuffer &&
        this.heightFbo && this.heightFboTexture &&
        this.roofProgram && this.roofPosBuffer && this.roofHeightBuffer) {

      // ── Pass B: Render shadow geometry into height FBO with MAX blending ──
      // Each fragment outputs the normalized height of the shadow caster as grayscale.
      gl2.bindFramebuffer(gl.FRAMEBUFFER, this.heightFbo);
      gl2.viewport(0, 0, w, h);
      gl2.clearColor(0, 0, 0, 0);
      gl2.clear(gl.COLOR_BUFFER_BIT);

      gl2.useProgram(this.heightProgram);
      gl2.uniformMatrix4fv(this.heightUMatrix, false, matrix);

      // Bind shadow position buffer (same geometry as Pass A)
      gl2.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
      gl2.enableVertexAttribArray(this.heightAttrPos);
      gl2.vertexAttribPointer(this.heightAttrPos, 2, gl.FLOAT, false, 0, 0);

      // Bind shadow height buffer
      gl2.bindBuffer(gl.ARRAY_BUFFER, this.shadowHeightBuffer);
      gl2.enableVertexAttribArray(this.heightAttrH);
      gl2.vertexAttribPointer(this.heightAttrH, 1, gl.FLOAT, false, 0, 0);

      // MAX blending so the tallest shadow caster wins at each pixel
      gl2.blendEquation(gl2.MAX);
      gl2.blendFunc(gl.ONE, gl.ONE);

      gl2.drawArrays(gl.TRIANGLES, 0, this.vertexCount);

      // ── Pass C: Render roof footprints into shadow FBO with destination-out ──
      // Erases shadow where maxIncomingHeight <= buildingHeight (self-shadow).
      gl2.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl2.viewport(0, 0, w, h);
      // Do NOT clear — we want to selectively erase from existing shadow

      gl2.useProgram(this.roofProgram);
      gl2.uniformMatrix4fv(this.roofUMatrix, false, matrix);

      // Bind height FBO texture for sampling
      gl2.activeTexture(gl.TEXTURE0);
      gl2.bindTexture(gl.TEXTURE_2D, this.heightFboTexture);
      gl2.uniform1i(this.roofUHeightTex, 0);
      gl2.uniform2f(this.roofUResolution, w, h);

      // Bind roof position buffer
      gl2.bindBuffer(gl.ARRAY_BUFFER, this.roofPosBuffer);
      gl2.enableVertexAttribArray(this.roofAttrPos);
      gl2.vertexAttribPointer(this.roofAttrPos, 2, gl.FLOAT, false, 0, 0);

      // Bind roof height buffer
      gl2.bindBuffer(gl.ARRAY_BUFFER, this.roofHeightBuffer);
      gl2.enableVertexAttribArray(this.roofAttrH);
      gl2.vertexAttribPointer(this.roofAttrH, 1, gl.FLOAT, false, 0, 0);

      // Destination-out: where roof fragment outputs alpha=1, erase shadow FBO
      gl2.blendEquation(gl.FUNC_ADD);
      gl2.blendFuncSeparate(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);

      gl2.drawArrays(gl.TRIANGLES, 0, roofVertexCount);
    }

    // ── Pass D: Composite FBO texture onto main canvas ──
    gl2.bindFramebuffer(gl.FRAMEBUFFER, prevFBO);
    gl2.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);

    gl2.useProgram(this.quadProgram);
    gl2.activeTexture(gl.TEXTURE0);
    gl2.bindTexture(gl.TEXTURE_2D, this.fboTexture);
    gl2.uniform1i(this.quadTexLoc, 0);

    gl2.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl2.enableVertexAttribArray(this.quadAttrLoc);
    gl2.vertexAttribPointer(this.quadAttrLoc, 2, gl.FLOAT, false, 0, 0);

    gl2.blendEquation(gl.FUNC_ADD);
    gl2.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    gl2.drawArrays(gl.TRIANGLES, 0, 6);

    // ── Restore GL state ──
    if (!wasBlend) gl2.disable(gl.BLEND);
    if (wasCull) gl2.enable(gl.CULL_FACE);
    gl2.blendEquationSeparate(prevBlendEqRGB, prevBlendEqA);
    gl2.blendFuncSeparate(prevBlendSrcRGB, prevBlendDstRGB, prevBlendSrcA, prevBlendDstA);
    gl2.activeTexture(prevActiveTexture);
    gl2.bindTexture(gl.TEXTURE_2D, prevTexture);
  }

  onRemove(_map: maplibregl.Map, gl: WebGL2RenderingContext | WebGLRenderingContext) {
    // Unregister map listeners
    if (this.map) {
      this.map.off('sourcedata', this.onSourceData);
      this.map.off('zoomend', this.onZoomEnd);
      this.map.off('moveend', this.onMoveEnd);
    }

    // Phase 4: Terminate sun worker
    if (this.sunWorker) {
      this.sunWorker.terminate();
      this.sunWorker = null;
    }

    if (this.program) gl.deleteProgram(this.program);
    if (this.positionBuffer) gl.deleteBuffer(this.positionBuffer);
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    if (this.fboTexture) gl.deleteTexture(this.fboTexture);
    if (this.heightProgram) gl.deleteProgram(this.heightProgram);
    if (this.shadowHeightBuffer) gl.deleteBuffer(this.shadowHeightBuffer);
    if (this.heightFbo) gl.deleteFramebuffer(this.heightFbo);
    if (this.heightFboTexture) gl.deleteTexture(this.heightFboTexture);
    if (this.roofProgram) gl.deleteProgram(this.roofProgram);
    if (this.roofPosBuffer) gl.deleteBuffer(this.roofPosBuffer);
    if (this.roofHeightBuffer) gl.deleteBuffer(this.roofHeightBuffer);
    if (this.quadProgram) gl.deleteProgram(this.quadProgram);
    if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
    this.program = null;
    this.positionBuffer = null;
    this.fbo = null;
    this.fboTexture = null;
    this.heightProgram = null;
    this.shadowHeightBuffer = null;
    this.heightFbo = null;
    this.heightFboTexture = null;
    this.roofProgram = null;
    this.roofPosBuffer = null;
    this.roofHeightBuffer = null;
    this.quadProgram = null;
    this.quadBuffer = null;
    this.buildingCache = null;
    this.map = null;
    this.gl = null;
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  /**
   * Compute the premultiplied shadow color based on sun altitude.
   * At sunrise/sunset (altitude ≈ 0): base color #01112f
   * At 12:00 noon (altitude = noon peak): lighter blue #22467f
   * Night (sun below horizon): base color unchanged
   */
  private computeShadowColor(sunBelowHorizon: boolean): [number, number, number, number] {
    const a = LocalShadowAdapter.SHADOW_ALPHA;
    const [br, bg, bb] = LocalShadowAdapter.BASE_RGB;

    if (sunBelowHorizon) {
      return [br * a, bg * a, bb * a, a];
    }

    let t = 0;
    if (this.map && this.lastSunAltRad != null && this.lastSunAltRad > 0) {
      const center = this.map.getCenter();
      const { solarNoon } = SunCalc.getTimes(this.currentDate, center.lat, center.lng);
      const noonAlt = SunCalc.getPosition(solarNoon, center.lat, center.lng).altitude;
      if (noonAlt > 0) {
        t = Math.min(1, this.lastSunAltRad / noonAlt);
      }
    }

    const [nr, ng, nb] = LocalShadowAdapter.NOON_RGB;
    return [
      (br + t * (nr - br)) * a,
      (bg + t * (ng - bg)) * a,
      (bb + t * (nb - bb)) * a,
      a,
    ];
  }

  private ensureFBO(gl: WebGL2RenderingContext | WebGLRenderingContext, w: number, h: number) {
    if (this.fbo && this.fboWidth === w && this.fboHeight === h) return;

    // Clean up old resources
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    if (this.fboTexture) gl.deleteTexture(this.fboTexture);
    if (this.heightFbo) gl.deleteFramebuffer(this.heightFbo);
    if (this.heightFboTexture) gl.deleteTexture(this.heightFboTexture);

    // Shadow FBO
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);

    this.fboTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.fboTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    // LINEAR so Pass D box-downsamples the supersampled shadow → antialiased edges.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTexture, 0);

    // Height FBO (same size, same format)
    this.heightFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.heightFbo);

    this.heightFboTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.heightFboTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.heightFboTexture, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);

    this.fboWidth = w;
    this.fboHeight = h;
  }

  /**
   * Phase 2: Build and cache building geometry (footprints + roof triangulations).
   * This is the expensive part — querying source features, earcut triangulations,
   * Mercator conversions. Cached and reused across setDate() calls since building
   * shapes don't change with time.
   */
  private buildBuildingGeometryCache(): CachedBuildingGeometry {
    const center = this.map?.getCenter();
    const bounds = this.map?.getBounds();
    const anchor: CacheAnchor = {
      centerLng: center?.lng ?? 0,
      centerLat: center?.lat ?? 0,
      zoom: this.map?.getZoom() ?? 0,
      bounds: bounds
        ? [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]
        : [0, 0, 0, 0],
      // A cache assembled while tiles are still streaming holds only part of the
      // buildings; the policy replaces it as soon as the source settles.
      builtFromLoadedSource: this.map?.isSourceLoaded('maptiler_planet') ?? false,
    };
    const emptyCache: CachedBuildingGeometry = {
      buildings: [], maxH: 1, centerMerc: [0, 0], anchor,
    };
    if (!this.map || !center) return emptyCache;
    if (this.map.getZoom() < 12) return emptyCache;

    const [cx, cy] = lngLatToMercator(center.lng, center.lat);

    const features = this.map.querySourceFeatures('maptiler_planet', {
      sourceLayer: 'building',
    });
    const { prisms, maxHeightM } = prismsFromTileFeatures(features);

    const cached: CachedBuildingGeometry = {
      buildings: [], maxH: maxHeightM, centerMerc: [cx, cy], anchor,
    };

    for (const prism of prisms) {
      // Roof footprint triangulation, Mercator-projected and centered once here
      // so Pass C can memcpy it straight into the vertex buffer every frame.
      const roofVerts: number[] = [];
      for (const [lng, lat] of triangulateRing(prism.ring)) {
        const [x, y] = lngLatToMercator(lng, lat);
        roofVerts.push(x - cx, y - cy);
      }

      cached.buildings.push({
        prism,
        normalizedH: prism.heightM / maxHeightM,
        mercatorRoofVerts: new Float32Array(roofVerts),
      });
    }

    return cached;
  }

  /**
   * Phase 2: Extrude shadows from cached building geometry using current sun position.
   * This is the fast path — no querySourceFeatures, no earcut, just shadow offset math.
   */
  private extrudeShadows(cache: CachedBuildingGeometry): ShadowGeometry {
    const empty: ShadowGeometry = {
      shadowVerts: new Float32Array(),
      shadowHeights: new Float32Array(),
      roofVerts: new Float32Array(),
      roofHeights: new Float32Array(),
      sunBelowHorizon: false,
    };
    if (!this.map) return empty;

    // Phase 4: Use worker-provided sun position if available, else compute synchronously
    let sunAzimuth: number;
    let sunAltitude: number;
    if (this.lastSunAzRad != null && this.lastSunAltRad != null) {
      sunAzimuth = this.lastSunAzRad;
      sunAltitude = this.lastSunAltRad;
    } else {
      const center = this.map.getCenter();
      const sun = SunCalc.getPosition(this.currentDate, center.lat, center.lng);
      sunAzimuth = sun.azimuth;
      sunAltitude = sun.altitude;
      // Store for dirty-check
      this.lastSunAzDeg = sunAzimuth * 180 / Math.PI;
      this.lastSunAltDeg = sunAltitude * 180 / Math.PI;
      this.lastSunAzRad = sunAzimuth;
      this.lastSunAltRad = sunAltitude;
    }

    // Sun below horizon → full dark overlay (world quad)
    if (sunAltitude <= 0) {
      return {
        shadowVerts: new Float32Array([
          0, 0,  1, 0,  1, 1,
          0, 0,  1, 1,  0, 1,
        ]),
        shadowHeights: new Float32Array(),
        roofVerts: new Float32Array(),
        roofHeights: new Float32Array(),
        sunBelowHorizon: true,
      };
    }

    if (cache.buildings.length === 0) return empty;

    const center = this.map.getCenter();
    const { mPerLat, mPerLng } = metersPerDegree(center.lat);

    const shadowVertsList: number[] = [];
    const shadowHeightsList: number[] = [];
    const roofVertsList: number[] = [];
    const roofHeightsList: number[] = [];

    const [cx, cy] = cache.centerMerc;

    for (const bldg of cache.buildings) {
      // Shadow geometry: edge-by-edge side-wall extrusion + earcut caps
      const shadowTris = buildShadowTriangles(
        bldg.prism.ring, bldg.prism.heightM, sunAzimuth, sunAltitude, mPerLat, mPerLng
      );
      for (const [lng, lat] of shadowTris) {
        const [x, y] = lngLatToMercator(lng, lat);
        shadowVertsList.push(x - cx, y - cy);
        shadowHeightsList.push(bldg.normalizedH);
      }

      // Roof verts from cache (already triangulated and in Mercator)
      const rv = bldg.mercatorRoofVerts;
      for (let i = 0; i < rv.length; i++) {
        roofVertsList.push(rv[i]);
      }
      const roofTriCount = rv.length / 2; // number of xy pairs = vertex count
      for (let i = 0; i < roofTriCount; i++) {
        roofHeightsList.push(bldg.normalizedH);
      }
    }

    return {
      shadowVerts: new Float32Array(shadowVertsList),
      shadowHeights: new Float32Array(shadowHeightsList),
      roofVerts: new Float32Array(roofVertsList),
      roofHeights: new Float32Array(roofHeightsList),
      sunBelowHorizon: false,
    };
  }

  private emit(event: string) {
    const cbs = this.listeners.get(event);
    if (cbs) cbs.forEach(cb => cb());
  }
}

// ─── Geometry helpers ──────────────────────────────────────────────────────────

function lngLatToMercator(lng: number, lat: number): [number, number] {
  const x = (lng + 180) / 360;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI);
  return [x, y];
}

function createShader(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) || 'Unknown shader compile error';
    gl.deleteShader(shader);
    throw new Error(info);
  }
  return shader;
}

function createProgram(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  vertexSrc: string,
  fragmentSrc: string,
): WebGLProgram {
  const vs = createShader(gl, gl.VERTEX_SHADER, vertexSrc);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fragmentSrc);
  const program = gl.createProgram();
  if (!program) throw new Error('Failed to create program');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) || 'Unknown program link error';
    gl.deleteProgram(program);
    throw new Error(info);
  }
  return program;
}
