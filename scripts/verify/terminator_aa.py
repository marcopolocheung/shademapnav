#!/usr/bin/env python3
"""
Browser verification for the 3D shadow terminator (Pass E antialiasing).

`npm test` runs in `environment: "node"` and has never executed a shader, so the
only way to see whether the lit/shaded boundary painted across walls and roofs is
still a staircase is to render it. This script captures the same scene twice —
once flat, once tilted — and then compares two capture directories.

What it measures, beyond the screenshots themselves:

* **pitch 0 must not move.** Pass E is gated on `map.getPitch() > 0`, so the flat
  canvas the shade sampler reads (invariant #5) has to come back byte-identical.
  Asserted with a pixel diff, not by reasoning about the gate.
* **Intermediate tones on the terminator.** A hard `step()` paints only the two
  endpoint tones; averaging four thresholded taps paints the values between them.
  Counting pixels in the valley between the two dominant tones of a wall crop is
  what "the staircase is gone" looks like as a number.
* **`isBlueDominantShadowPixel` over the crop.** The new in-between tones are the
  part of this change that touches invariant #5, so the fraction of crop pixels
  the routing predicate calls shaded is reported for both captures.

Usage
-----
    npm run dev &
    LD_LIBRARY_PATH=$HOME/miniconda3/lib \
      ~/miniconda3/bin/python scripts/verify/terminator_aa.py --out out/after
    git stash && \
      LD_LIBRARY_PATH=$HOME/miniconda3/lib \
      ~/miniconda3/bin/python scripts/verify/terminator_aa.py --out out/before
    ~/miniconda3/bin/python scripts/verify/terminator_aa.py \
      --compare out/before out/after

See docs/notes/browser-verification.md for why the environment line is needed.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

# Midtown Manhattan, the scene every visual check in this repo has used. Noon
# gives short shadows and a terminator high on the towers; late afternoon throws
# long ones across many facades, which is where the 8-bit height field would show
# as horizontal terracing if the quantization — not the thresholding — were the
# thing making the edge rough.
TIMES = ["12:30", "15:30"]
SCENE = "?lat=40.75810&lng=-73.98550&z=16.30&date=2026-08-16&time={time}"

# WebGL needs a software rasteriser; there is no GPU in WSL. PCF is shader-level,
# so SwiftShader resolves it exactly as a GPU would.
CHROME_FLAGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]

TILT_ON = "Tilt to 3D map"
TILT_OFF = "Return to 2D map"

VIEWPORT = {"width": 1280, "height": 900}
# A window onto the towers left of centre. The original central crop mostly caught
# one uniformly-lit facade at noon; this one includes the terminator that crosses
# the neighbouring walls at both 12:30 and 15:30. Fixed so captures line up.
CROP = (350, 300, 650, 600)


def tilted(page) -> bool:
    """The 3D toggle renders `pitch > 0`, so it reports the camera's pitch state."""
    return page.get_by_role("button", name=TILT_OFF).count() > 0


def stable_screenshot(page, path: Path) -> None:
    """Write a frame only after the asynchronous map canvas has settled."""
    previous: bytes | None = None
    for _ in range(12):
        page.screenshot(path=str(path), timeout=0)
        current = path.read_bytes()
        if current == previous:
            return
        previous = current
        page.wait_for_timeout(1000)
    raise AssertionError(f"{path.stem}: map canvas did not settle")


def capture(page, url: str, out: Path, tag: str) -> None:
    page.goto(url, wait_until="load")
    page.wait_for_timeout(9000)  # style, tiles, buildings, first shadow render
    assert not tilted(page), f"{tag}: the map did not start flat"
    stable_screenshot(page, out / f"{tag}-pitch0.png")

    toggle = page.get_by_role("button", name=TILT_ON)
    for _ in range(20):
        if tilted(page):
            break
        if toggle.count():
            # Map controls can arrive one frame behind the map canvas. Keep this
            # retry bounded instead of letting Playwright's default 30 s click
            # timeout turn one late React render into a failed capture.
            toggle.click(timeout=1000)
        page.wait_for_timeout(1000)
    assert tilted(page), f"{tag}: could not tilt the camera"
    page.wait_for_timeout(4000)  # the tilt eases, then Pass E draws
    stable_screenshot(page, out / f"{tag}-pitch55.png")

    full = Image.open(out / f"{tag}-pitch55.png").convert("RGB")
    crop = full.crop(CROP)
    crop.save(out / f"{tag}-crop.png")
    # 3× nearest-neighbour: the evidence for this change is one wall's boundary,
    # and at 1× a reviewer cannot see whether it staircases.
    crop.resize((crop.width * 3, crop.height * 3), Image.NEAREST).save(
        out / f"{tag}-crop-3x.png"
    )


def shot(page, url: str, out: Path, tag: str) -> None:
    try:
        capture(page, url, out, tag)
    except AssertionError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        raise


def blue_dominant(rgb: np.ndarray) -> np.ndarray:
    """`isBlueDominantShadowPixel` from app/lib/shadeSampling.ts, vectorised."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    rg = (r + g) / 2
    return (r + g + b < 600) & (b - rg > 18) & (b > rg * 1.15)


def dominant_modes(lum: np.ndarray) -> tuple[int, int]:
    """The two most-populated luminance levels at least 20 apart."""
    hist = np.bincount(lum.ravel(), minlength=256)
    first = int(np.argmax(hist))
    masked = hist.copy()
    masked[max(0, first - 20) : first + 21] = 0
    second = int(np.argmax(masked))
    return (min(first, second), max(first, second))


def crop_stats(path: Path) -> dict:
    rgb = np.asarray(Image.open(path).convert("RGB"), dtype=np.int32)
    lum = (0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2])
    lum = lum.round().astype(np.int32)
    lo, hi = dominant_modes(lum)
    # Everything between the two endpoint tones, with a 5-level guard so ordinary
    # dither around a mode is not counted as a PCF blend.
    between = int(((lum > lo + 5) & (lum < hi - 5)).sum())
    return {
        "modes": [lo, hi],
        "intermediatePixels": between,
        "intermediateFraction": round(between / lum.size, 4),
        "uniqueColors": int(len(np.unique(rgb.reshape(-1, 3), axis=0))),
        "shadePredicateFraction": round(float(blue_dominant(rgb).mean()), 4),
    }


def diff(a: Path, b: Path, out: Path | None = None) -> dict:
    ia = np.asarray(Image.open(a).convert("RGB"), dtype=np.int32)
    ib = np.asarray(Image.open(b).convert("RGB"), dtype=np.int32)
    if ia.shape != ib.shape:
        return {"error": f"size mismatch {ia.shape} vs {ib.shape}"}
    delta = np.abs(ia - ib)
    changed = (delta.max(axis=2) > 0)
    if out is not None:
        heat = np.zeros(ia.shape[:2] + (3,), dtype=np.uint8)
        heat[..., 0] = np.clip(delta.max(axis=2) * 4, 0, 255)
        Image.fromarray(heat).save(out)
    return {
        "changedPixels": int(changed.sum()),
        "changedFraction": round(float(changed.mean()), 5),
        "maxChannelDelta": int(delta.max()),
    }


def compare(before: Path, after: Path) -> int:
    report: dict = {}
    failures: list[str] = []

    for time in TIMES:
        tag = f"t{time.replace(':', '')}"
        entry: dict = {}
        for view in ("pitch0", "pitch55"):
            a, b = before / f"{tag}-{view}.png", after / f"{tag}-{view}.png"
            if not (a.exists() and b.exists()):
                failures.append(f"{tag}-{view}: missing capture")
                continue
            entry[view] = diff(a, b, after / f"{tag}-{view}-diff.png")
        for name, d in (("before", before), ("after", after)):
            crop = d / f"{tag}-crop.png"
            if crop.exists():
                entry[f"crop.{name}"] = crop_stats(crop)
        report[tag] = entry

        flat = entry.get("pitch0", {})
        if flat.get("changedPixels", -1) != 0:
            failures.append(
                f"{tag}: the flat view moved ({flat.get('changedPixels')} px) — "
                "Pass E is supposed to be gated off at pitch 0"
            )
        cb, ca = entry.get("crop.before"), entry.get("crop.after")
        if cb and ca and ca["intermediatePixels"] <= cb["intermediatePixels"]:
            failures.append(
                f"{tag}: no new intermediate tones on the terminator "
                f"({cb['intermediatePixels']} → {ca['intermediatePixels']})"
            )

    print(json.dumps(report, indent=2))
    (after / "terminator_aa.json").write_text(json.dumps(report, indent=2))
    for f in failures:
        print(f"FAIL: {f}")
    if failures:
        return 1
    print("PASS: flat view unchanged; the tilted terminator gained blended tones.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:5173")
    ap.add_argument("--out", default="out", type=Path)
    ap.add_argument(
        "--compare", nargs=2, type=Path, metavar=("BEFORE", "AFTER"),
        help="compare two capture directories instead of capturing",
    )
    args = ap.parse_args()

    if args.compare:
        return compare(*args.compare)

    args.out.mkdir(parents=True, exist_ok=True)
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=CHROME_FLAGS)
        page = browser.new_page(viewport=VIEWPORT)
        page.on("console", lambda m: print(f"  [console] {m.text}", file=sys.stderr))
        for time in TIMES:
            url = args.url.rstrip("/") + "/" + SCENE.format(time=time)
            shot(page, url, args.out, f"t{time.replace(':', '')}")
        browser.close()

    print(f"captured to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
