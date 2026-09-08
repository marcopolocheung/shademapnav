#!/usr/bin/env python3
"""Compare what the shadow renderer draws against ray-traced ground truth.

A shadow bug is a picture, not a log line: nothing throws, no number goes out of
range, and `npm test` never runs a shader. This verifier turns one into a number
and a picture you can point at.

It drives the real app, reads back the frame, and asks the page for the very
prisms the renderer just used. Then it ray-traces those prisms itself — camera
rays for "what surface is this pixel", a sun ray for "is that point shaded" — and
diffs the two answers per pixel. Disagreements come out as a mask image, so a bug
that reads as "the shadow doesn't line up" becomes a shape on a black background
with a percentage next to it.

What it can and cannot tell you
-------------------------------
The truth here is the renderer's *own* geometry, traced exactly. So this checks
the shaders against the buildings they were handed. It cannot tell you the
buildings are right (wrong heights, missing footprints, tile clipping): a surface
the two disagree about the *identity* of is excluded and reported separately as
`surfaceMismatch`.

Ground pixels are classified with `isBlueDominantShadowPixel` — invariant #5, the
same predicate routing uses — so over a coloured basemap they carry the noise that
predicate has. Wall and roof pixels carry no such noise: the building pass is
patched to state its decision outright.

How the frame is read
---------------------
Two in-flight rewrites of the dev-served modules, both asserted so a shader or
component edit fails loudly instead of silently invalidating the measurement:

* `MapView.tsx` publishes the map and the shadow layer on `window`.
* Pass E's fragment shader keeps its colour but writes its decision into alpha:

      10 + 20*shaded + 40*roof + 80*sun-facing

  giving 90 lit wall / 110 shaded sun-facing wall / 30 wall turned away /
  130 lit roof / 150 shaded roof. Ground keeps alpha 255. An MSAA-blended
  silhouette pixel lands on none of those and is dropped.

Usage
-----
    npm run dev &
    LD_LIBRARY_PATH=$HOME/miniconda3/lib \
      ~/miniconda3/bin/python scripts/verify/shadow_truth.py \
        --url http://localhost:5173 --out out/ --tag before

    # after a change, same scene and camera:
    ... --tag after --baseline out/before.json

Needs `numpy` and `pillow` alongside playwright; both ship with the miniconda
install this repo's browser notes already rely on. See
`docs/notes/browser-verification.md`.
"""

from __future__ import annotations

import argparse
import base64
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

# Midtown Manhattan, late afternoon: the sun is low and nearly due west, so long
# street shadows run up sun-facing walls — the case where wall and ground have to
# agree. Tilted hard, because the defects this tool exists to find scale with pitch.
DEFAULTS = dict(
    lat=40.7444, lng=-73.9752, zoom=18.5, pitch=60.0, bearing=20.0,
    date="2026-09-05", time="16:13",
)
VIEWPORT = {"width": 1280, "height": 900}
TIMEZONE = "America/New_York"

# WebGL needs a software rasteriser; there is no GPU in WSL.
CHROME_FLAGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]

EARTH_CIRCUMFERENCE_M = 2 * math.pi * 6371008.8

# Pass E alpha codes, and whether each one means "shaded".
PASS_E_CODES = {90: (2, False), 110: (2, True), 30: (2, True), 130: (3, False), 150: (3, True)}
GROUND, WALL, ROOF = 1, 2, 3
SURFACE_NAMES = {GROUND: "ground", WALL: "wall", ROOF: "roof"}

PATCHES = [
    ("**/app/components/MapView.tsx*", [
        ("onMapReady?.(map)", "(window.__map = map, onMapReady?.(map))"),
        ("onShadowLayerReady?.(shadowLayer)",
         "(window.__shade = shadowLayer, onShadowLayerReady?.(shadowLayer))"),
    ]),
    ("**/app/lib/shadow/LocalShadowAdapter.ts*", [
        ("gl_FragColor = vec4(mix(lit, dark, shaded), 1.0);",
         "gl_FragColor = vec4(mix(lit, dark, shaded), (10.0 + 20.0*shaded"
         " + 40.0*step(0.5, v_normal.z) + 80.0*step(0.0, v_facing))/255.0);"),
        ("const matrix = new Float32Array(m);",
         "const matrix = new Float32Array(m); (window).__frameMatrix = Array.from(m);"),
    ]),
]

READ_PIXELS_JS = """() => {
  const c = document.querySelector('.maplibregl-canvas');
  const g = c.getContext('webgl2');
  g.bindFramebuffer(g.FRAMEBUFFER, null);
  const w = c.width, h = c.height;
  const px = new Uint8Array(w * h * 4);
  g.readPixels(0, 0, w, h, g.RGBA, g.UNSIGNED_BYTE, px);
  let s = '';
  for (let i = 0; i < px.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, px.subarray(i, i + 0x8000));
  }
  return {w, h, b64: btoa(s)};
}"""

SCENE_JS = """() => {
  const s = window.__shade, m = window.__map, c = s.buildingCache;
  return {
    center: m.getCenter().toArray(), zoom: m.getZoom(),
    pitch: m.getPitch(), bearing: m.getBearing(),
    sunAzRad: s.lastSunAzRad, sunAltRad: s.lastSunAltRad,
    maxH: c.maxH, centerMerc: c.centerMerc, matrix: window.__frameMatrix,
    prisms: c.buildings.map(b => ({r: b.prism.ring, h: b.prism.heightM})),
  };
}"""


# ─── Capture ───────────────────────────────────────────────────────────────────

def capture(page, url: str, args) -> tuple[np.ndarray, dict]:
    """Load the scene, tilt it, and read back the instrumented frame."""
    applied: dict[str, int] = {}

    def rewriter(subs):
        # One parameter exactly: playwright hands a two-parameter handler the
        # Request as well, and a bound default would silently become that Request.
        def handle(route_obj):
            response = route_obj.fetch()
            body = response.text()
            for needle, replacement in subs:
                applied[needle] = applied.get(needle, 0) + body.count(needle)
                body = body.replace(needle, replacement)
            route_obj.fulfill(
                status=response.status,
                headers={k: v for k, v in response.headers.items()
                         if k.lower() != "content-length"},
                body=body,
            )
        return handle

    for pattern, subs in PATCHES:
        page.route(pattern, rewriter(subs))

    scene = (f"/?lat={args.lat}&lng={args.lng}&z={args.zoom}"
             f"&date={args.date}&time={args.time}")
    page.goto(url + scene, wait_until="load")
    page.wait_for_timeout(args.settle_ms)
    page.evaluate("([p, b]) => window.__map.jumpTo({pitch: p, bearing: b})",
                  [args.pitch, args.bearing])
    page.wait_for_timeout(args.settle_ms // 2)

    for _, subs in PATCHES:
        for needle, _ in subs:
            assert applied.get(needle), f"rewrite never matched: {needle!r}"

    meta = page.evaluate(SCENE_JS)
    raw = page.evaluate(READ_PIXELS_JS)
    # readPixels is bottom-up; flip so row 0 is the top of the screen.
    frame = np.frombuffer(base64.b64decode(raw["b64"]), np.uint8)
    frame = frame.reshape(raw["h"], raw["w"], 4)[::-1].copy()
    meta["width"], meta["height"] = raw["w"], raw["h"]
    return frame, meta


# ─── Ground truth ──────────────────────────────────────────────────────────────

def to_mercator(lng: float, lat: float) -> tuple[float, float]:
    s = math.sin(math.radians(lat))
    return (lng + 180.0) / 360.0, 0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)


def inside_ring(ring: np.ndarray, pts: np.ndarray) -> np.ndarray:
    """Even-odd point-in-polygon, one ring against many points."""
    x, y = pts[:, 0], pts[:, 1]
    result = np.zeros(len(pts), bool)
    for i in range(len(ring)):
        ax, ay = ring[i]
        bx, by = ring[(i + 1) % len(ring)]
        straddles = (ay > y) != (by > y)
        with np.errstate(divide="ignore", invalid="ignore"):
            crossing = (bx - ax) * (y - ay) / (by - ay) + ax
        result ^= straddles & (x < crossing)
    return result


def raytrace(meta: dict, step: int) -> tuple[np.ndarray, np.ndarray]:
    """Trace the renderer's own prisms. Returns (surface, shaded) rasters.

    Mercator is conformal, so one metre is the same number of units on all three
    axes at the centre latitude — the same scale MapLibre gives a custom layer's z.
    That lets the whole trace run in mercator without rescaling anything.
    """
    width, height = meta["width"], meta["height"]
    metres = 1.0 / (EARTH_CIRCUMFERENCE_M * math.cos(math.radians(meta["center"][1])))
    cx, cy = meta["centerMerc"]
    az, alt = meta["sunAzRad"], meta["sunAltRad"]
    # SunCalc's azimuth runs south -> west and mercator y runs north -> south, so
    # this is the same "toward the sun" the building pass builds.
    sun = np.array([-math.sin(az) * math.cos(alt),
                    math.cos(az) * math.cos(alt),
                    math.sin(alt)])

    prisms = []
    for prism in meta["prisms"]:
        ring = [to_mercator(*c) for c in prism["r"]]
        ring = [(x - cx, y - cy) for x, y in ring]
        if ring[0] == ring[-1]:
            ring = ring[:-1]
        if len(ring) >= 3:
            prisms.append((np.array(ring), prism["h"] * metres))

    matrix = np.array(meta["matrix"], np.float64).reshape(4, 4).T
    inverse = np.linalg.inv(matrix)
    xs = np.arange(0, width, step)
    ys = np.arange(0, height, step)
    w, h = len(xs), len(ys)
    gx, gy = np.meshgrid(xs, ys)
    ndc_x = (2.0 * (gx + 0.5) / width - 1.0).ravel()
    ndc_y = (1.0 - 2.0 * (gy + 0.5) / height).ravel()
    ones = np.ones_like(ndc_x)

    def unproject(ndc_z: float) -> np.ndarray:
        p = inverse @ np.stack([ndc_x, ndc_y, np.full_like(ndc_x, ndc_z), ones])
        return (p[:3] / p[3]).T

    origin = unproject(-1.0)
    direction = unproject(1.0) - origin
    direction /= np.linalg.norm(direction, axis=1, keepdims=True)

    def project(points: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        v = np.concatenate([points, np.ones((len(points), 1))], 1) @ matrix.T
        return v[:, :3] / v[:, 3:4], v[:, 3]

    far = np.float64(1e30)
    depth = np.full(ndc_x.shape, far)
    surface = np.zeros(ndc_x.shape, np.uint8)
    with np.errstate(divide="ignore", invalid="ignore"):
        t = -origin[:, 2] / direction[:, 2]
    on_ground = np.isfinite(t) & (t > 0)
    depth[on_ground] = t[on_ground]
    surface[on_ground] = GROUND

    # Camera rays, culled to each prism's screen bounding box. Without this the
    # trace is prisms x pixels and a real city block never finishes.
    grid = np.arange(w * h).reshape(h, w)
    for ring, top_z in prisms:
        corners = np.concatenate([np.c_[ring, np.zeros(len(ring))],
                                  np.c_[ring, np.full(len(ring), top_z)]])
        ndc, clip_w = project(corners)
        if (clip_w <= 1e-9).any():
            chosen = grid.ravel()          # straddles the camera plane: cannot cull
        else:
            sx = (ndc[:, 0] * 0.5 + 0.5) * width
            sy = (0.5 - ndc[:, 1] * 0.5) * height
            x0 = max(0, int(sx.min()) // step - 1)
            x1 = min(w, int(sx.max()) // step + 2)
            y0 = max(0, int(sy.min()) // step - 1)
            y1 = min(h, int(sy.max()) // step + 2)
            if x0 >= x1 or y0 >= y1:
                continue
            chosen = grid[y0:y1, x0:x1].ravel()
        o, d = origin[chosen], direction[chosen]
        near, kind = depth[chosen], surface[chosen]

        with np.errstate(divide="ignore", invalid="ignore"):
            t = (top_z - o[:, 2]) / d[:, 2]
        cand = np.isfinite(t) & (t > 0) & (t < near)
        if cand.any():
            hit = o[cand] + d[cand] * t[cand][:, None]
            idx = np.where(cand)[0][inside_ring(ring, hit[:, :2])]
            near[idx], kind[idx] = t[idx], ROOF

        for i in range(len(ring)):
            a, b = ring[i], ring[(i + 1) % len(ring)]
            edge = b - a
            det = d[:, 0] * (-edge[1]) - d[:, 1] * (-edge[0])
            rx, ry = a[0] - o[:, 0], a[1] - o[:, 1]
            with np.errstate(divide="ignore", invalid="ignore"):
                t = (rx * (-edge[1]) - ry * (-edge[0])) / det
                s = (d[:, 0] * ry - d[:, 1] * rx) / det
            z = o[:, 2] + d[:, 2] * t
            cand = (np.isfinite(t) & (t > 0) & (t < near)
                    & (s >= 0) & (s <= 1) & (z >= 0) & (z <= top_z))
            near[cand], kind[cand] = t[cand], WALL
        depth[chosen], surface[chosen] = near, kind

    hit = origin + direction * np.where(depth < far, depth, 0)[:, None]
    # Leave the surface we are standing on before looking for the sun.
    start = hit + sun * (0.02 * metres)
    shaded = np.zeros(ndc_x.shape, bool)
    lit = surface > 0

    # Sun rays all share one direction, so each prism reduces to "does the 2D ray
    # enter this ring before it has climbed past the roof".
    for ring, top_z in prisms:
        tip = ring - sun[None, :2] * (top_z / sun[2])   # the shadow falls away
        span = np.concatenate([ring, tip])
        lo, hi = span.min(0), span.max(0)
        cand = (lit & ~shaded & (start[:, 2] < top_z)
                & (start[:, 0] >= lo[0]) & (start[:, 0] <= hi[0])
                & (start[:, 1] >= lo[1]) & (start[:, 1] <= hi[1]))
        if not cand.any():
            continue
        idx = np.where(cand)[0]
        q = start[idx]
        entry = np.where(inside_ring(ring, q[:, :2]), 0.0, np.inf)
        for i in range(len(ring)):
            a, b = ring[i], ring[(i + 1) % len(ring)]
            edge = b - a
            det = sun[0] * (-edge[1]) - sun[1] * (-edge[0])
            if abs(det) < 1e-18:
                continue
            rx, ry = a[0] - q[:, 0], a[1] - q[:, 1]
            t = (rx * (-edge[1]) - ry * (-edge[0])) / det
            s = (sun[0] * ry - sun[1] * rx) / det
            entry = np.where((t > 0) & (s >= 0) & (s <= 1) & (t < entry), t, entry)
        shaded[idx[entry < (top_z - q[:, 2]) / sun[2]]] = True

    return surface.reshape(h, w), shaded.reshape(h, w)


# ─── Comparison ────────────────────────────────────────────────────────────────

def classify_render(frame: np.ndarray, step: int) -> tuple[np.ndarray, np.ndarray]:
    """Read the renderer's own decision out of the instrumented frame."""
    frame = frame[::step, ::step]
    alpha = frame[..., 3]
    rgb = frame[..., :3].astype(int)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    # isBlueDominantShadowPixel, invariant #5 — the ground has no flag of its own.
    blue = (r + g + b < 600) & (b - (r + g) / 2 > 18) & (b > (r + g) / 2 * 1.15)

    surface = np.zeros(alpha.shape, np.uint8)
    shaded = np.zeros(alpha.shape, bool)
    ground = alpha == 255
    surface[ground] = GROUND
    shaded[ground] = blue[ground]
    for code, (kind, is_shaded) in PASS_E_CODES.items():
        hit = alpha == code
        surface[hit] = kind
        shaded[hit] = is_shaded
    return surface, shaded


def report(render, truth, out: Path, tag: str) -> dict:
    """Count the disagreements and draw them."""
    r_surface, r_shaded = render
    t_surface, t_shaded = truth
    known = (r_surface > 0) & (t_surface > 0)
    agreed = known & (r_surface == t_surface)
    wrong = agreed & (r_shaded != t_shaded)

    result = {"surfaceMismatch": int((known & ~agreed).sum()), "comparable": int(agreed.sum())}
    for kind, name in SURFACE_NAMES.items():
        compared = agreed & (t_surface == kind)
        missed = wrong & (t_surface == kind)
        result[name] = {
            "compared": int(compared.sum()),
            "wrong": int(missed.sum()),
            "wrongFraction": float(missed.sum() / compared.sum()) if compared.any() else 0.0,
            "litWhereShaded": int((missed & ~r_shaded).sum()),
            "shadedWhereLit": int((missed & r_shaded).sum()),
        }

    h, w = r_surface.shape
    image = np.zeros((h, w, 3), np.uint8)
    image[agreed & (t_surface == GROUND)] = (24, 24, 24)
    image[agreed & (t_surface == WALL)] = (44, 44, 44)
    image[agreed & (t_surface == ROOF)] = (68, 68, 68)
    image[known & ~agreed] = (0, 60, 0)              # geometry differs; not judged
    image[wrong & ~r_shaded] = (255, 0, 255)         # drawn lit, truth says shaded
    image[wrong & r_shaded] = (255, 220, 0)          # drawn shaded, truth says lit
    Image.fromarray(image).save(out / f"{tag}-mismatch.png")

    palette = {(GROUND, False): (245, 245, 245), (GROUND, True): (70, 110, 230),
               (WALL, False): (255, 225, 150), (WALL, True): (160, 40, 0),
               (ROOF, False): (190, 255, 150), (ROOF, True): (0, 110, 60)}
    for name, (surface, shaded) in (("truth", truth), ("render", render)):
        picture = np.zeros((h, w, 3), np.uint8)
        for (kind, is_shaded), colour in palette.items():
            picture[(surface == kind) & (shaded == is_shaded)] = colour
        Image.fromarray(picture).save(out / f"{tag}-{name}.png")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://localhost:5173")
    parser.add_argument("--out", type=Path, default=Path("out"))
    parser.add_argument("--tag", default="shadow-truth")
    parser.add_argument("--baseline", type=Path,
                        help="a previous run's JSON, to print the change")
    parser.add_argument("--step", type=int, default=1,
                        help="pixel stride; 2 is ~4x faster and still shows the shape")
    parser.add_argument("--settle-ms", type=int, default=14000)
    for name, value in DEFAULTS.items():
        parser.add_argument(f"--{name}", type=type(value), default=value)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(args=CHROME_FLAGS)
        context = browser.new_context(viewport=VIEWPORT, device_scale_factor=1,
                                      timezone_id=TIMEZONE)
        page = context.new_page()
        frame, meta = capture(page, args.url.rstrip("/"), args)
        page.screenshot(path=str(args.out / f"{args.tag}-frame.png"))
        browser.close()

    print(f"  {len(meta['prisms'])} prisms, pitch {meta['pitch']:.0f}, "
          f"zoom {meta['zoom']:.1f}; tracing", file=sys.stderr)
    truth = raytrace(meta, args.step)
    render = classify_render(frame, args.step)
    result = report(render, truth, args.out, args.tag)
    result["scene"] = {k: meta[k] for k in
                       ("center", "zoom", "pitch", "bearing", "sunAzRad", "sunAltRad", "maxH")}
    result["step"] = args.step
    (args.out / f"{args.tag}.json").write_text(json.dumps(result, indent=2))

    print(f"comparable {result['comparable']}  "
          f"(surface mismatch, not judged: {result['surfaceMismatch']})")
    for name in SURFACE_NAMES.values():
        row = result[name]
        print(f"  {name:7s} compared {row['compared']:8d}  wrong {row['wrong']:7d}"
              f"  ({100 * row['wrongFraction']:.3f}%)"
              f"  lit-where-shaded {row['litWhereShaded']:6d}"
              f"  shaded-where-lit {row['shadedWhereLit']:6d}")

    if args.baseline:
        before = json.loads(args.baseline.read_text())
        print(f"\nagainst {args.baseline}:")
        for name in SURFACE_NAMES.values():
            was, now = before[name]["wrongFraction"], result[name]["wrongFraction"]
            print(f"  {name:7s} {100 * was:.3f}% -> {100 * now:.3f}%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
