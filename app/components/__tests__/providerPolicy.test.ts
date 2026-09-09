import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Invariant #6, as a check rather than a paragraph.
 *
 * `User-Agent` is a forbidden header name, so a browser silently drops it —
 * which is why it sat in three client files for months looking like compliance.
 * Only the `api/` proxies can send it, and every Nominatim call has to go
 * through one. Both halves regress silently, so both are asserted here.
 */
const ROOT = join(__dirname, "..", "..", "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const offenders = (files: string[], needle: RegExp) =>
  files
    .filter((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        // A comment may name the host — app/lib/nominatim.ts explains why it no
        // longer fetches it. Code may not.
        .some((line) => needle.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line))
    )
    .map((f) => f.slice(ROOT.length + 1));

describe("provider policy", () => {
  it("has no client code fetching Nominatim directly", () => {
    // All of app/, not just components: app/lib/nominatim.ts is the file that
    // actually issues the request, so it is the likeliest place for a direct
    // URL to come back.
    const files = sourceFiles(join(ROOT, "app"));
    expect(files.length).toBeGreaterThan(0);
    expect(offenders(files, /nominatim\.openstreetmap\.org/)).toEqual([]);
  });

  it("has no client code setting the User-Agent header", () => {
    const files = sourceFiles(join(ROOT, "app"));
    expect(files.length).toBeGreaterThan(0);
    expect(offenders(files, /["']User-Agent["']\s*:/)).toEqual([]);
  });

  it("has both OSM proxies identifying themselves upstream", () => {
    for (const proxy of ["api/nominatim.js", "api/overpass.js"]) {
      const src = readFileSync(join(ROOT, proxy), "utf8");
      expect(src, proxy).toMatch(/["']User-Agent["']\s*:\s*["']ShadeMapNav\//);
    }
  });
});
