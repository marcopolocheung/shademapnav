import { describe, it, expect } from "vitest";
import { isBlueDominantShadowPixel, sampleBothSidewalks } from "../shadeSampling";

/**
 * Build a uniform ImageData where every pixel is [r,g,b,255].
 * sampleBothSidewalks with a constant projectFn samples this single color,
 * so we can test the shade classifier in isolation.
 */
function uniformImage(r: number, g: number, b: number, w = 8, h = 8): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h, colorSpace: "srgb" } as ImageData;
}

const constProject = (): [number, number] => [4, 4];
const from: [number, number] = [0, 0];
const to: [number, number] = [0.0005, 0];

function shadeOf(r: number, g: number, b: number): number {
  const s = sampleBothSidewalks(constProject, uniformImage(r, g, b), 1, from, to, 4);
  return Math.max(s.left, s.right);
}

describe("sampleBothSidewalks shade classifier", () => {
  it("detects a blue shadow blended over the light outdoor-v2 basemap", () => {
    // #01112f @ 0.7 alpha composited over a light (~white) road ≈ (70,81,102).
    // Blue-dominant but NOT dark (sum=253) — the case the old `r+g+b<200`
    // gate wrongly rejected.
    expect(shadeOf(70, 81, 102)).toBeGreaterThan(0.5);
  });

  it("detects a strong blue shadow over a dark feature", () => {
    expect(shadeOf(10, 21, 42)).toBeGreaterThan(0.5);
  });

  it("does NOT flag an unshaded light road as shaded", () => {
    expect(shadeOf(230, 230, 230)).toBe(0);
  });

  it("does NOT flag a neutral-gray shadow as shaded (gray is undetectable by color)", () => {
    // #6b6b6b @ 0.7 over white ≈ (151,151,151): r≈g≈b, no blue signal.
    expect(shadeOf(151, 151, 151)).toBe(0);
  });

  it("does NOT flag green parkland as shaded", () => {
    expect(shadeOf(180, 200, 160)).toBe(0);
  });
});

describe("isBlueDominantShadowPixel", () => {
  it("keeps routing and assistant shade checks on the same pixel predicate", () => {
    expect(isBlueDominantShadowPixel(70, 81, 102)).toBe(true);
    expect(isBlueDominantShadowPixel(230, 230, 230)).toBe(false);
    expect(isBlueDominantShadowPixel(151, 151, 151)).toBe(false);
  });
});
