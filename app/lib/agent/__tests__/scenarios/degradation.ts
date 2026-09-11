/**
 * What a turn looks like when the model gives back nothing usable. None of
 * these may throw, and none may end in a fabricated itinerary.
 */
import type { Scenario } from "../harness";

export const blockedPromptDegrades: Scenario = {
  id: "blocked-prompt-degrades",
  intent: "a safety block ends the turn immediately, with no tools and no pins",
  userText: "something the provider refuses",
  script: [{ blocked: "SAFETY" }],
  maxLlmCalls: 1,
  maxToolCalls: 0,
  expect: {
    toolOrder: [],
    plotsBeforeWrite: false,
    pinLabels: [],
    answer: "I couldn't respond to that (SAFETY).",
  },
};

export const emptyResearchFallsThroughToWrite: Scenario = {
  id: "empty-research-falls-through-to-write",
  intent: "an empty research candidate still reaches the write call",
  userText: "Plan my afternoon in the shadow",
  script: [{ empty: true }, { text: "Stay on the north side of the street after 4 PM." }],
  maxLlmCalls: 2,
  maxToolCalls: 0,
  expect: {
    toolOrder: [],
    plotsBeforeWrite: false,
    pinLabels: [],
    answer: "Stay on the north side of the street after 4 PM.",
  },
};

export const emptyWriteSaysSo: Scenario = {
  id: "empty-write-says-so",
  intent: "a write call that returns nothing produces a plain retry message",
  userText: "Plan my afternoon in the shadow",
  // Research has to call a tool first — a tool-free research answer never
  // reaches the write call at all.
  tools: { set_time: { ok: true, newLocalTime: "3:00 PM" } },
  script: [
    { calls: [{ name: "set_time", args: { time: "3:00 PM" } }] },
    { text: "draft answer from the research model" },
    { empty: true },
  ],
  maxLlmCalls: 3,
  maxToolCalls: 1,
  expect: {
    toolOrder: ["set_time"],
    plotsBeforeWrite: false,
    pinLabels: [],
    answer: "I didn't get a response from the model. Try rephrasing.",
  },
};

export const writeCallThatToolCallsStaysAnAnswer: Scenario = {
  id: "write-call-that-tool-calls-stays-an-answer",
  intent: "a write call answering with a tool call, not text, still returns an answer and clean history",
  userText: "Plan a shadowed afternoon",
  tools: {
    search_places: { results: [{ name: "Bryant Park", lat: 40.7536, lng: -73.9832 }] },
    plot_points: { ok: true },
  },
  script: [
    { calls: [{ name: "search_places", args: { query: "parks" } }] },
    { text: "draft answer from the research model" },
    // Seen live: offered no tools, the model still emitted a call and no text.
    { calls: [{ name: "check_shadow", args: { lat: 40.7536, lng: -73.9832 } }] },
  ],
  grounded: ["Bryant Park"],
  maxLlmCalls: 3,
  maxToolCalls: 2,
  expect: {
    toolOrder: ["search_places", "plot_points"],
    plotsBeforeWrite: true,
    pinLabels: ["Bryant Park"],
    answer:
      "I didn't get a written plan back, but these are on the map: Bryant Park. Ask again and I'll pick up from here.",
  },
};
