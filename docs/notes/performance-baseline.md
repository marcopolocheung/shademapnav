# Performance Baseline

Measured on 2026-08-15 from branch `perf/baseline-metrics` at commit `dca020d`
after `npm run build`.

Environment:
- OS: WSL2 Linux `6.18.33.2-microsoft-standard-WSL2`
- Node: `v20.20.1`
- npm: `10.8.2`
- Browser tooling: no local Chromium, Playwright, or Lighthouse binary available

## Build Artifacts

| Artifact | Raw bytes | Gzip bytes |
|---|---:|---:|
| `dist/assets/maplibre-EPPFnYTc.js` | 953234 | 256181 |
| `dist/assets/react-vendor-BE91f6Ds.js` | 229914 | 73158 |
| `dist/assets/index-BuiovaZN.js` | 156946 | 47483 |
| `dist/assets/MapView-BAZp6Pgx.js` | 48378 | 14638 |
| `dist/assets/agentLoop-BvVIQobA.js` | 18033 | 7239 |
| `dist/assets/earcut-Dbb6WtNR.js` | 9492 | 4155 |
| `dist/assets/sunPosition.worker-Cacf_Fkb.js` | 3587 | 1826 |
| `dist/assets/maplibre-B4QYLKPJ.css` | 69367 | 10003 |
| `dist/assets/index-Dl5krxH_.css` | 50098 | 9434 |
| `dist/index.html` | 1119 | 587 |
| `dist/sw.js` | 1772 | 652 |
| `dist/manifest.webmanifest` | 441 | 289 |

Total `dist/`: 1.6 MiB.

## Missing Measurements

The backlog asks for throttled-4G time-to-interactive and representative 2-point
and 5-point route calculation timings. Those are not recorded here because this
workspace has no browser automation binary and no interactive browser available
for route calculation. The existing runtime route instrumentation is exposed at
`window.__shadeMapMetrics`, so the next baseline slice should capture those
numbers from a real browser session or add a repo-owned browser automation setup.
