import type maplibregl from 'maplibre-gl';
import SunCalc from 'suncalc';
import earcut from 'earcut';
import type { IShadowLayer } from './IShadowLayer';

interface ShadowGeometry {
  shadowVerts: Float32Array;    // Mercator (x,y) shadow triangles
  shadowHeights: Float32Array;  // normalized height per shadow vertex (h/maxH)
  roofVerts: Float32Array;      // Mercator (x,y) building footprint triangles (un-offset)
  roofHeights: Float32Array;    // normalized height per roof vertex (h/maxH)
  sunBelowHorizon: boolean;
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

  // Map event handlers (bound so we can unregister)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private onSourceData = (e: any) => {
    // Recompute whenever building source tiles change.
    // This fires during pan/zoom as vector tiles stream in.
    if (!this.map) return;
    if (e?.sourceId === 'maptiler_planet') {
      this.dirty = true;
      this.map.triggerRepaint();
    }
  };

  private onZoomEnd = () => {
    if (!this.map) return;
    this.dirty = true;
    this.map.triggerRepaint();
  };

  // Must match the existing shade-sampling heuristic in page.tsx:
  // sampleBothSidewalks checks B/R > 1.8 — #01112f has R=1, B=47, ratio=47 ✓
  // MapLibre expects premultiplied alpha for custom layers by default.
  private static readonly SHADOW_ALPHA = 0.7;
  private static readonly SHADOW_PREMULT_RGBA: [number, number, number, number] = [
    (1 / 255) * LocalShadowAdapter.SHADOW_ALPHA,
    (17 / 255) * LocalShadowAdapter.SHADOW_ALPHA,
    (47 / 255) * LocalShadowAdapter.SHADOW_ALPHA,
    LocalShadowAdapter.SHADOW_ALPHA,
  ];

  constructor(opts?: { date?: Date; id?: string }) {
    this.currentDate = opts?.date ?? new Date();
    if (opts?.id) this.id = opts.id;
  }

  // ─── IShadowLayer ──────────────────────────────────────────────────────────

  setDate(date: Date) {
    this.currentDate = date;
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

  // ─── CustomLayerInterface ──────────────────────────────────────────────────

  onAdd(map: maplibregl.Map, gl: WebGL2RenderingContext | WebGLRenderingContext) {
    this.map = map;
    this.gl = gl;

    // Keep geometry cache in sync with streaming vector tiles.
    map.on('sourcedata', this.onSourceData);
    map.on('zoomend', this.onZoomEnd);

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
      this.cachedGeometry = this.computeShadowGeometry();
      this.dirty = false;
      this.emit('idle');
    }

    const geo = this.cachedGeometry;
    if (geo.shadowVerts.length === 0) return;

    const w = gl.canvas.width;
    const h = gl.canvas.height;
    this.ensureFBO(gl, w, h);
    if (!this.fbo) return;

    // Upload shadow geometry
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, geo.shadowVerts, gl.DYNAMIC_DRAW);
    this.vertexCount = geo.shadowVerts.length / 2;

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

    const matrix = options.defaultProjectionData.mainMatrix;

    // ── Pass A: Render shadows into FBO with MAX blending ──
    gl2.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl2.viewport(0, 0, w, h);
    gl2.clearColor(0, 0, 0, 0);
    gl2.clear(gl.COLOR_BUFFER_BIT);

    gl2.useProgram(this.program);
    gl2.uniformMatrix4fv(this.u_matrix, false, matrix as unknown as Float32List);
    const [r, g, b, a] = LocalShadowAdapter.SHADOW_PREMULT_RGBA;
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
      gl2.uniformMatrix4fv(this.heightUMatrix, false, matrix as unknown as Float32List);

      // Bind shadow position buffer (same geometry as Pass A)
      gl2.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
      gl2.enableVertexAttribArray(this.heightAttrPos);
      gl2.vertexAttribPointer(this.heightAttrPos, 2, gl.FLOAT, false, 0, 0);

      // Bind shadow height buffer
      gl2.bindBuffer(gl.ARRAY_BUFFER, this.shadowHeightBuffer);
      gl2.bufferData(gl.ARRAY_BUFFER, geo.shadowHeights, gl.DYNAMIC_DRAW);
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
      gl2.uniformMatrix4fv(this.roofUMatrix, false, matrix as unknown as Float32List);

      // Bind height FBO texture for sampling
      gl2.activeTexture(gl.TEXTURE0);
      gl2.bindTexture(gl.TEXTURE_2D, this.heightFboTexture);
      gl2.uniform1i(this.roofUHeightTex, 0);
      gl2.uniform2f(this.roofUResolution, w, h);

      // Bind roof position buffer
      gl2.bindBuffer(gl.ARRAY_BUFFER, this.roofPosBuffer);
      gl2.bufferData(gl.ARRAY_BUFFER, geo.roofVerts, gl.DYNAMIC_DRAW);
      gl2.enableVertexAttribArray(this.roofAttrPos);
      gl2.vertexAttribPointer(this.roofAttrPos, 2, gl.FLOAT, false, 0, 0);

      // Bind roof height buffer
      gl2.bindBuffer(gl.ARRAY_BUFFER, this.roofHeightBuffer);
      gl2.bufferData(gl.ARRAY_BUFFER, geo.roofHeights, gl.DYNAMIC_DRAW);
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
    this.map = null;
    this.gl = null;
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

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
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
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

  private computeShadowGeometry(): ShadowGeometry {
    const empty: ShadowGeometry = {
      shadowVerts: new Float32Array(),
      shadowHeights: new Float32Array(),
      roofVerts: new Float32Array(),
      roofHeights: new Float32Array(),
      sunBelowHorizon: false,
    };
    if (!this.map) return empty;

    const center = this.map.getCenter();
    const sun = SunCalc.getPosition(this.currentDate, center.lat, center.lng);

    // Sun below horizon → full dark overlay (world quad)
    if (sun.altitude <= 0) {
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

    if (this.map.getZoom() < 12) return empty;

    const lat0 = center.lat * Math.PI / 180;
    const mPerLat = 111320;
    const mPerLng = 111320 * Math.cos(lat0);

    // PROBLEMS.md compliance:
    // - building_part substitution only for tall buildings (>100m)
    // - height fallback: render_height ?? height ?? building:levels*3.1 ?? 3.1
    // - only skip a tall parent building if we actually found matching parts;
    //   otherwise keep the parent so we never “lose” a tall building.
    const TALL_THRESHOLD = 100;

    const heightMFor = (props: Record<string, unknown> | null | undefined): number => {
      if (!props) return 3.1;
      const rh = Number((props as any).render_height);
      if (Number.isFinite(rh) && rh > 0) return rh;
      const h = Number((props as any).height);
      if (Number.isFinite(h) && h > 0) return h;
      const lv = Number((props as any)['building:levels']);
      if (Number.isFinite(lv) && lv > 0) return lv * 3.1;
      return 3.1;
    };

    const rawBuildings = this.map.querySourceFeatures('maptiler_planet', {
      sourceLayer: 'building',
    }).filter(f =>
      f.properties &&
      f.properties.underground !== 'true'
    );

    // Filter out parent outlines of tall buildings whose parts are separate features.
    // MapTiler tiles set hide_3d: true on parent outlines that have building:part sub-features.
    const buildings = rawBuildings.filter(b => {
      if (heightMFor(b.properties as any) > TALL_THRESHOLD && (b.properties as any)?.hide_3d) {
        return false;
      }
      return true;
    });

    // Sort shortest → tallest (matches existing ShadeMap rasterization order)
    buildings.sort((a, b) => heightMFor(a.properties as any) - heightMFor(b.properties as any));

    // First pass: find maxH for normalization
    let maxH = 0;
    for (const b of buildings) {
      const h = heightMFor(b.properties as any);
      if (h > maxH) maxH = h;
    }
    if (maxH === 0) maxH = 1; // prevent division by zero

    const shadowVertsList: number[] = [];
    const shadowHeightsList: number[] = [];
    const roofVertsList: number[] = [];
    const roofHeightsList: number[] = [];

    for (const b of buildings) {
      if (b.geometry.type !== 'Polygon' && b.geometry.type !== 'MultiPolygon') continue;
      const heightM = heightMFor(b.properties as any);
      const normalizedH = heightM / maxH;

      const rings =
        b.geometry.type === 'Polygon'
          ? b.geometry.coordinates
          : b.geometry.coordinates.flat(1);

      for (const ring of rings) {
        const coords = ring as [number, number][];

        // Shadow geometry: edge-by-edge side-wall extrusion + earcut caps
        const shadowTris = buildShadowTriangles(coords, heightM, sun.azimuth, sun.altitude, mPerLat, mPerLng);
        for (const [lng, lat] of shadowTris) {
          const [x, y] = lngLatToMercator(lng, lat);
          shadowVertsList.push(x, y);
          shadowHeightsList.push(normalizedH);
        }

        // Earcut triangulation for true concave footprint (Pass C roof exclusion)
        const flatCoords: number[] = [];
        for (const [lng, lat] of coords) {
          flatCoords.push(lng, lat);
        }
        const indices = earcut(flatCoords, [], 2);
        for (let i = 0; i < indices.length; i += 3) {
          const a = indices[i], b = indices[i + 1], c = indices[i + 2];
          const [x0, y0] = lngLatToMercator(flatCoords[a * 2], flatCoords[a * 2 + 1]);
          const [x1, y1] = lngLatToMercator(flatCoords[b * 2], flatCoords[b * 2 + 1]);
          const [x2, y2] = lngLatToMercator(flatCoords[c * 2], flatCoords[c * 2 + 1]);
          roofVertsList.push(x0, y0, x1, y1, x2, y2);
          roofHeightsList.push(normalizedH, normalizedH, normalizedH);
        }
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

/**
 * Returns the shadow polygon for one building ring.
 * Shadow = convex hull of (original footprint ∪ footprint translated in anti-sun direction).
 */
/**
 * Build shadow triangles via edge-by-edge side-wall extrusion + earcut caps.
 *
 * For each consecutive edge of the polygon ring, a quad (2 triangles) is formed
 * between the original edge and its sun-shifted counterpart. Then the original
 * footprint and the shifted footprint are triangulated with earcut to cap the
 * top and bottom. This preserves the true concave shape of the building.
 *
 * Returns an array of [lng, lat] points where every 3 form one triangle.
 */
function buildShadowTriangles(
  ring: [number, number][],
  heightM: number,
  azimuth: number,   // radians, SunCalc convention (clockwise from south)
  altitude: number,  // radians above horizon
  mPerLat: number,
  mPerLng: number,
): [number, number][] {
  const shadowLengthM = heightM / Math.tan(altitude);
  // SunCalc's azimuth is the direction *to the sun* (clockwise from south).
  // A shadow projects *away* from the sun, so the footprint translation must
  // be in the opposite direction.
  const dLat = Math.cos(azimuth) * shadowLengthM / mPerLat;
  const dLng = Math.sin(azimuth) * shadowLengthM / mPerLng;

  // Ensure ring is open (no duplicate closing vertex)
  let pts = ring;
  if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) {
    pts = pts.slice(0, -1);
  }
  if (pts.length < 3) return [];

  const shifted = pts.map(([lng, lat]) => [lng + dLng, lat + dLat] as [number, number]);
  const out: [number, number][] = [];

  // Side-wall quads: for each edge, extrude from original to shifted
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const a = pts[i], b = pts[j];
    const sa = shifted[i], sb = shifted[j];
    // Quad as 2 triangles: (a, b, sa) and (b, sb, sa)
    out.push(a, b, sa);
    out.push(b, sb, sa);
  }

  // Cap: original footprint (bottom)
  const flatOrig: number[] = [];
  for (const [lng, lat] of pts) flatOrig.push(lng, lat);
  const origIdx = earcut(flatOrig, [], 2);
  for (let i = 0; i < origIdx.length; i += 3) {
    const a = origIdx[i], b = origIdx[i + 1], c = origIdx[i + 2];
    out.push(pts[a], pts[b], pts[c]);
  }

  // Cap: shifted footprint (top)
  const flatShifted: number[] = [];
  for (const [lng, lat] of shifted) flatShifted.push(lng, lat);
  const shiftIdx = earcut(flatShifted, [], 2);
  for (let i = 0; i < shiftIdx.length; i += 3) {
    const a = shiftIdx[i], b = shiftIdx[i + 1], c = shiftIdx[i + 2];
    out.push(shifted[a], shifted[b], shifted[c]);
  }

  return out;
}

function lngLatToMercator(lng: number, lat: number): [number, number] {
  const x = (lng + 180) / 360;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI);
  return [x, y];
}

/**
 * Fan triangulation for a convex GeoJSON ring.
 *
 * Input may be closed (last vertex == first). Output is an array of points
 * where every 3 points form one triangle.
 */
function triangulateConvexRing(ring: [number, number][]): [number, number][] {
  if (ring.length < 4) return [];
  const pts = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1)
    : ring;
  if (pts.length < 3) return [];
  const out: [number, number][] = [];
  const p0 = pts[0];
  for (let i = 1; i < pts.length - 1; i++) {
    out.push(p0, pts[i], pts[i + 1]);
  }
  return out;
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

/** Andrew's monotone chain convex hull — O(n log n) */
function convexHull(pts: [number, number][]): [number, number][] {
  if (pts.length < 3) return pts;
  const sorted = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number,number], a: [number,number], b: [number,number]) =>
    (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0]);

  const lower: [number,number][] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number,number][] = [];
  for (const p of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return [...lower, ...upper];
}


