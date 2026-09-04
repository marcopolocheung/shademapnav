#!/usr/bin/env python3
"""
Browser verification for the flat shade readback (#154).

`npm test` runs in `environment: "node"` and has never executed a browser, so the
one claim that matters here cannot be checked by the four gates: that route shade
no longer depends on camera pitch. This script checks it.

It drives the real app through the real controls — no test hook in production code
— calculating the same route twice, once flat and once tilted, and comparing the
shade percentages the route cards report. Before this fix they diverge, because the
shadow layer paints buildings with the same blue field the sampler reads as shade.
After it they must match, because the readback happens flat either way.

The 3D toggle's `aria-pressed` doubles as a pitch probe: it renders `pitch > 0`, so
polling it during the calculation shows whether the camera really went flat.

Usage
-----
    npm run dev &
    LD_LIBRARY_PATH=$HOME/miniconda3/lib \
      ~/miniconda3/bin/python scripts/verify/shade_readback.py --out out/

See docs/notes/browser-verification.md for why the environment line is needed.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

# Midtown Manhattan at a low sun angle: dense, tall, and the scene the previous
# visual checks in this repo used, so screenshots stay comparable across PRs.
# Pick a time when shade is *partial*. Late afternoon in Midtown saturates every
# route at 100%, and two numbers that are both pinned at the ceiling agree for
# reasons that have nothing to do with the camera.
DEFAULT_TIME = "12:30"


def scene(time: str) -> str:
    return (
        "?lat=40.75810&lng=-73.98550&z=16.30"
        f"&date=2026-08-16&time={time}"
        "&a=-73.98900,40.75600&b=-73.98100,40.76050"
    )

# WebGL needs a software rasteriser; there is no GPU in WSL.
CHROME_FLAGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]

TILT_ON = "Tilt to 3D map"
TILT_OFF = "Return to 2D map"
CALCULATE = "Find Shaded Route"

SHADE_RE = re.compile(r"^\d+% shade$")


def shade_labels(page) -> list[str]:
    """Every distinct '42% shade' the route cards are showing."""
    texts = page.eval_on_selector_all(
        "*", "els => els.map(e => (e.textContent || '').trim())"
    )
    return sorted({t for t in texts if SHADE_RE.match(t)})


def tilted(page) -> bool:
    """The 3D toggle renders `pitch > 0`, so it reports the camera's pitch state."""
    return page.get_by_role("button", name=TILT_OFF).count() > 0


def run_case(page, url: str, tilt: bool, out: Path, tag: str) -> dict:
    page.goto(url, wait_until="load")
    page.wait_for_timeout(7000)  # style, tiles, and the first shadow render

    if tilt:
        # The toggle is inert until the map instance exists, and a warm second load
        # can render the control before the map is ready — so click until it takes.
        for _ in range(20):
            if tilted(page):
                break
            page.get_by_role("button", name=TILT_ON).click()
            page.wait_for_timeout(1000)
    assert tilted(page) is tilt, f"{tag}: could not reach the requested camera"
    page.screenshot(path=str(out / f"{tag}-before.png"))

    page.get_by_role("button", name=CALCULATE).click()

    # Poll the toggle while the calculation runs. If the camera ever goes flat, the
    # readback saw a flat canvas; if it never does, the fix is not in effect.
    went_flat = False
    shot = False
    for _ in range(60):
        if not tilted(page):
            if not went_flat and not shot:
                page.screenshot(path=str(out / f"{tag}-readback.png"))
                shot = True
            went_flat = True
        if page.get_by_role("button", name=CALCULATE).count() > 0 and went_flat:
            break
        page.wait_for_timeout(250)

    page.wait_for_selector(f"text={CALCULATE}", timeout=30000)
    page.wait_for_timeout(1500)  # let the restore ease finish
    page.screenshot(path=str(out / f"{tag}-after.png"))

    return {
        "requestedTilt": tilt,
        "wentFlatDuringCalculation": went_flat,
        "tiltedAfter": tilted(page),
        "shadeLabels": shade_labels(page),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:5173")
    ap.add_argument("--out", default="out", type=Path)
    ap.add_argument("--time", default=DEFAULT_TIME)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    url = args.url.rstrip("/") + "/" + scene(args.time)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=CHROME_FLAGS)
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        page.on("console", lambda m: print(f"  [console] {m.text}", file=sys.stderr))

        flat = run_case(page, url, False, args.out, "pitch0")
        tilt = run_case(page, url, True, args.out, "pitch55")

        browser.close()

    report = {"flat": flat, "tilted": tilt}
    (args.out / "shade_readback.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))

    failures = []
    if not tilt["wentFlatDuringCalculation"]:
        failures.append("camera never went flat during a tilted calculation")
    if not tilt["tiltedAfter"]:
        failures.append("the tilt was not handed back after the calculation")
    if flat["shadeLabels"] != tilt["shadeLabels"]:
        failures.append(
            f"shade depends on pitch: flat {flat['shadeLabels']} "
            f"vs tilted {tilt['shadeLabels']}"
        )
    if not flat["shadeLabels"]:
        failures.append("no route cards rendered — the scene or selectors are stale")
    if flat["shadeLabels"] == ["100% shade"]:
        failures.append(
            "shade is saturated at 100%, so the flat/tilted comparison proves "
            "nothing — pick a --time with partial shade"
        )

    for f in failures:
        print(f"FAIL: {f}")
    if failures:
        return 1
    print("PASS: shade is identical flat and tilted, and the tilt came back.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
