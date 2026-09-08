/**
 * The honesty scenarios: what the loop must do when a tool fails, returns
 * nothing, or returns more than fits on the map. Each declares the place names
 * the tools genuinely produced (`grounded`) and, where relevant, a name no tool
 * ever returned (`decoys`) that must never reach the answer.
 */
import type { Scenario } from "../harness";

const MADISON = { name: "Madison Square Park", lat: 40.7414, lng: -73.9882 };

export const toolErrorStaysHonest: Scenario = {
  id: "tool-error-stays-honest",
  intent: "a failed shade probe is fed back as an error and still ends in a plotted answer",
  userText: "Is Madison Square Park shaded right now?",
  tools: {
    geocode_place: { results: [MADISON] },
    check_shade: { error: "No building geometry loaded for that area." },
    plot_points: { ok: true, plotted: 1 },
  },
  script: [
    { calls: [{ name: "geocode_place", args: { query: "Madison Square Park" } }] },
    { calls: [{ name: "check_shade", args: { lat: MADISON.lat, lng: MADISON.lng } }] },
    {
      calls: [
        {
          name: "plot_points",
          args: { points: [{ lat: MADISON.lat, lng: MADISON.lng, label: MADISON.name }] },
        },
      ],
    },
    { text: "draft answer from the research model" },
    { text: "I couldn't measure shade at Madison Square Park — it's pinned so you can look." },
  ],
  grounded: [MADISON.name],
  decoys: ["Willow Court Café"],
  maxLlmCalls: 5,
  maxToolCalls: 3,
  expect: {
    toolOrder: ["geocode_place", "check_shade", "plot_points"],
    plotsBeforeWrite: true,
    pinLabels: [MADISON.name],
    answer: "I couldn't measure shade at Madison Square Park — it's pinned so you can look.",
  },
};

export const emptySearchInventsNothing: Scenario = {
  id: "empty-search-invents-nothing",
  intent: "an empty search result plots nothing and names nothing",
  userText: "Find me a shaded café around here",
  tools: {
    search_places: { results: [], note: "No matches found." },
  },
  script: [
    { calls: [{ name: "search_places", args: { query: "café" } }] },
    { text: "draft answer from the research model" },
    { text: "I couldn't find any cafés near there — try naming a neighbourhood." },
  ],
  decoys: ["Willow Court Café"],
  maxLlmCalls: 3,
  maxToolCalls: 1,
  expect: {
    toolOrder: ["search_places"],
    plotsBeforeWrite: false,
    pinLabels: [],
    answer: "I couldn't find any cafés near there — try naming a neighbourhood.",
  },
};

export const noResearchNoPins: Scenario = {
  id: "no-research-no-pins",
  intent: "an off-topic turn costs no tools and plots nothing",
  userText: "What's the capital of France?",
  script: [
    { text: "draft answer from the research model" },
    { text: "I only help plan a day around shade and sun." },
  ],
  decoys: ["Bryant Park"],
  maxLlmCalls: 2,
  maxToolCalls: 0,
  expect: {
    toolOrder: [],
    plotsBeforeWrite: false,
    pinLabels: [],
    answer: "I only help plan a day around shade and sun.",
  },
};

export const unknownLocationAsksInstead: Scenario = {
  id: "unknown-location-asks-instead",
  intent: "with no located map the loop asks for an area rather than inventing one",
  userText: "Somewhere shaded, please",
  context: { locationKnown: false, zoom: 2, center: { lat: 0, lng: 0 } },
  script: [
    { text: "draft answer from the research model" },
    { text: "Which city or neighbourhood should I plan around?" },
  ],
  decoys: ["Bryant Park"],
  maxLlmCalls: 2,
  maxToolCalls: 0,
  expect: {
    toolOrder: [],
    plotsBeforeWrite: false,
    pinLabels: [],
    answer: "Which city or neighbourhood should I plan around?",
  },
};

const MANY = Array.from({ length: 12 }, (_, i) => ({
  name: `Park ${i + 1}`,
  lat: 40.75 + i * 0.001,
  lng: -73.98 - i * 0.001,
}));

export const fallbackPinsCapAtEight: Scenario = {
  id: "fallback-pins-cap-at-eight",
  intent: "twelve search hits become at most eight pins",
  userText: "Show me every shaded park nearby",
  tools: {
    search_places: { results: MANY },
    plot_points: { ok: true, plotted: 8 },
  },
  script: [
    { calls: [{ name: "search_places", args: { query: "parks" } }] },
    { text: "draft answer from the research model" },
    { text: "Start at Park 1, finish at Park 8 — eight in all, pinned." },
  ],
  grounded: MANY.slice(0, 8).map((p) => p.name),
  // Returned by the search but dropped by the 8-pin cap, so naming it would be
  // a claim the map can't back.
  decoys: [MANY[11].name],
  maxLlmCalls: 3,
  maxToolCalls: 2,
  expect: {
    toolOrder: ["search_places", "plot_points"],
    plotsBeforeWrite: true,
    pinLabels: MANY.slice(0, 8).map((p) => p.name),
    answer: "Start at Park 1, finish at Park 8 — eight in all, pinned.",
  },
};

const BRYANT = { name: "Bryant Park", lat: 40.7536, lng: -73.9832 };

export const duplicateHitsBecomeOnePin: Scenario = {
  id: "duplicate-hits-become-one-pin",
  intent: "two search hits at the same coordinate become a single pin",
  userText: "Shaded parks around Midtown",
  tools: {
    search_places: {
      results: [
        BRYANT,
        // Same coordinate, different name — one place, listed twice.
        { name: "Bryant Park north entrance", lat: BRYANT.lat, lng: BRYANT.lng },
        { name: "Grace Plaza", lat: 40.752, lng: -73.985 },
      ],
    },
    plot_points: { ok: true, plotted: 2 },
  },
  script: [
    { calls: [{ name: "search_places", args: { query: "parks" } }] },
    { text: "draft answer from the research model" },
    { text: "Bryant Park, then Grace Plaza." },
  ],
  grounded: [BRYANT.name, "Grace Plaza"],
  maxLlmCalls: 3,
  maxToolCalls: 2,
  expect: {
    toolOrder: ["search_places", "plot_points"],
    plotsBeforeWrite: true,
    pinLabels: [BRYANT.name, "Grace Plaza"],
    answer: "Bryant Park, then Grace Plaza.",
  },
};
