/* @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import type { FoursquarePlaceInfo } from "../../services/foursquare";
import { renderPlaceInfoHtml } from "../placePopup";

function place(overrides: Partial<FoursquarePlaceInfo>): FoursquarePlaceInfo {
  return { name: "Test Place", ...overrides };
}

/**
 * Foursquare values land in URL position, where an entity escape is no defence:
 * `javascript:alert(1)` contains no HTML-special character and survives it intact.
 */
describe("renderPlaceInfoHtml — URL position", () => {
  it("drops a website whose scheme is not http(s)", () => {
    const rejected = [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "  javascript:alert(1)",
      "java\nscript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "//evil.example",
    ];
    for (const website of rejected) {
      const html = renderPlaceInfoHtml(place({ website }), "");
      expect(html).not.toContain("href=");
      expect(html).not.toContain("Website");
      expect(html.toLowerCase()).not.toContain("javascript:");
    }
  });

  it("drops a photo whose scheme is not http(s)", () => {
    for (const photo of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "//evil.example/x.png"]) {
      const html = renderPlaceInfoHtml(place({ photo }), "");
      expect(html).not.toContain("<img");
      expect(html).not.toContain("src=");
    }
  });

  it("keeps an http(s) website and photo", () => {
    const html = renderPlaceInfoHtml(
      place({ website: "https://example.com/cafe", photo: "http://example.com/p.jpg" }),
      ""
    );
    expect(html).toContain('href="https://example.com/cafe"');
    expect(html).toContain('src="http://example.com/p.jpg"');
  });

  it("builds the tel: URI from dialable characters only", () => {
    const html = renderPlaceInfoHtml(place({ phone: '+65 6123 4567" onclick="alert(1)' }), "");
    expect(html).toContain('href="tel:+65 6123 4567 (1)"');
    expect(html).not.toContain('onclick="');
  });

  it("cannot break out of the photo alt attribute", () => {
    const html = renderPlaceInfoHtml(
      place({ name: 'Cafe" onerror="alert(1)', photo: "https://example.com/p.jpg" }),
      ""
    );
    expect(html).not.toContain('onerror="');
    expect(html).toContain('alt="Cafe&quot; onerror=&quot;alert(1)"');
  });

  it("drops a phone with nothing dialable in it", () => {
    const html = renderPlaceInfoHtml(place({ phone: "call us" }), "");
    expect(html).not.toContain("tel:");
  });
});

describe("renderPlaceInfoHtml — text position", () => {
  it("entity-escapes the place name", () => {
    const html = renderPlaceInfoHtml(place({ name: "<script>alert(1)</script>" }), "");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("falls back to the supplied address when the place has none", () => {
    const html = renderPlaceInfoHtml(place({}), "1 Test Road");
    expect(html).toContain("1 Test Road");
  });
});
