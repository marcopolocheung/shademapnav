# Browser verification

`npm test` runs under `environment: "node"` and has never executed a browser. Shadow
rendering, timeline drag, end-to-end route calculation, the streaming preview and the
GeoTIFF export are untested by the four gates and always have been. Issue #121 recorded
that as impossible on this machine. **It is not.**

## Running Chromium here

Playwright's cached Chromium fails to start because `libnss3`, `libnspr4`, `libnssutil3`,
`libsmime3` and `libasound.so.2` are missing, and there is no passwordless sudo. Every one
of those ships inside the miniconda install that is already present, so pointing the loader
at it is enough — no downloads, no root:

```bash
LD_LIBRARY_PATH=$HOME/miniconda3/lib \
  ~/.cache/ms-playwright/chromium_headless_shell-1169/chrome-linux/headless_shell --version
# Chromium 136.0.7103.25
```

WebGL needs a software rasteriser, since WSL exposes no GPU:

```
--use-angle=swiftshader --enable-unsafe-swiftshader
```

## Why Python, and why not in CI

The working toolchain here is `~/miniconda3/bin/playwright`, not npm — `node_modules` has no
Playwright at all. Adding one would pull a package into `npm ci` on every CI run and pin a
Chromium revision that has to match the local cache, risking the four gates for no gain:
these checks will never run in CI, which has no GPU and no MapTiler key.

So `scripts/verify/` is deliberately outside `vitest.config.ts`'s glob and outside Biome's
targets. It is a tool you run by hand, before a PR that changes what the map draws.

## The scripts

- **`scripts/verify/shade_readback.py`** — proves route shade does not depend on camera
  pitch (#154). Calculates the same route flat and tilted and compares the shade percentages
  the route cards report; also checks the camera went flat for the readback and got its tilt
  back afterwards.
- **`scripts/verify/terminator_aa.py`** — captures Midtown at 12:30 and 15:30 using the
  public 3D toggle's fixed 55° pitch. Compare `main` and the change with
  `--compare before after`: flat frames must be pixel-identical, while the fixed wall crops
  must gain intermediate terminator tones. The report also records the blue-dominant routing
  predicate fraction; the fractional PCF band is expected to be classified sunlit.

Run them against a dev server:

```bash
npm run dev &
LD_LIBRARY_PATH=$HOME/miniconda3/lib \
  ~/miniconda3/bin/python scripts/verify/shade_readback.py --out out/

# Capture the candidate and main on separate dev-server ports, then compare them.
LD_LIBRARY_PATH=$HOME/miniconda3/lib \
  ~/miniconda3/bin/python scripts/verify/terminator_aa.py --out out/after
LD_LIBRARY_PATH=$HOME/miniconda3/lib \
  ~/miniconda3/bin/python scripts/verify/terminator_aa.py \
  --compare out/before out/after
```

Screenshots and a JSON report land in `--out` (gitignored). Put the numbers in the PR body;
do not commit the PNGs.

## What still cannot be checked

Nothing here measures whether the shade numbers are *right* — only whether they are
self-consistent. Real accuracy needs the pixel sampler's answer recorded over real cities
against ground truth, which no fixture in this repo has.
