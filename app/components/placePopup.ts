import type { FoursquarePlaceInfo } from "../services/foursquare";

/**
 * Entity-escape for text and attribute-value positions.
 *
 * `innerHTML` leaves quotes alone, so they are replaced here as well — a value
 * carrying `"` would otherwise close the attribute it sits in.
 */
export function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * The URL if it is an absolute `http(s)` one, else `null`.
 *
 * Escaping is no defence in URL position: `javascript:alert(1)` holds no
 * HTML-special character, so only the scheme check rejects it. Protocol-relative
 * values (`//evil.example`) have no scheme to check and fail to parse.
 */
export function safeHttpUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** A `tel:` target built from dialable characters only, or `null` if none remain. */
export function safeTelHref(raw: string): string | null {
  const dialable = raw.replace(/[^+0-9 ()-]/g, "").trim();
  return dialable ? `tel:${dialable}` : null;
}

/**
 * The body of a place popup: everything Foursquare told us about one place.
 *
 * Foursquare's response is third-party data the app does not control, and it is
 * interpolated into markup handed to `Popup.setHTML`. Values in URL position are
 * scheme-checked before they get there; `escapeHtml` stays on top of them,
 * because the two defences answer different attacks.
 */
export function renderPlaceInfoHtml(info: FoursquarePlaceInfo, fallbackAddress: string): string {
  const name = info.name ?? "Unknown Place";
  const addr = info.address ?? fallbackAddress;
  const cat  = info.category;
  const hours = info.hours;
  const rating = info.rating;
  const desc = info.description;
  const tel = info.phone ? safeTelHref(info.phone) : null;
  const website = info.website ? safeHttpUrl(info.website) : null;
  const photo = info.photo ? safeHttpUrl(info.photo) : null;

  const rows: string[] = [];
  rows.push(`<div class="nav-place-popup__name">${escapeHtml(name)}</div>`);
  if (cat) rows.push(`<div class="nav-place-popup__meta">${escapeHtml(cat)}</div>`);
  if (addr) rows.push(`<div class="nav-place-popup__addr">${escapeHtml(addr)}</div>`);
  if (hours) rows.push(`<div class="nav-place-popup__row"><span class="nav-place-popup__label">Hours</span> ${escapeHtml(hours)}</div>`);
  if (typeof rating === "number") rows.push(`<div class="nav-place-popup__row"><span class="nav-place-popup__label">Rating</span> ${rating.toFixed(1)} / 10</div>`);
  if (desc) rows.push(`<div class="nav-place-popup__desc">${escapeHtml(desc)}</div>`);
  if (tel && info.phone) rows.push(`<div class="nav-place-popup__row"><a class="nav-place-popup__link" href="${escapeHtml(tel)}">${escapeHtml(info.phone)}</a></div>`);
  if (website) rows.push(`<div class="nav-place-popup__row"><a class="nav-place-popup__link" href="${escapeHtml(website)}" target="_blank" rel="noreferrer">Website</a></div>`);
  if (photo) rows.push(`<img class="nav-place-popup__photo" src="${escapeHtml(photo)}" alt="${escapeHtml(name)}" />`);

  return `<div class="nav-place-popup__wrap">${rows.join("")}</div>`;
}
