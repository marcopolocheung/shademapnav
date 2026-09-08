/**
 * Budget scenarios. The free tier allows 5 requests/minute, so the number of
 * LLM round-trips a turn spends is a product constraint, not a detail — and the
 * step cap must never strand the loop before the pins reach the map.
 */
import type { Scenario } from "../harness";

const BRYANT = { name: "Bryant Park", lat: 40.7536, lng: -73.9832 };

/** Eight distinct probes, so candidate de-duplication doesn't collapse them. */
const PROBES = Array.from({ length: 8 }, (_, i) => ({
  lat: 40.75 + i * 0.002,
  lng: -73.98 - i * 0.002,
}));

export const stepBudgetExhaustedStillPlots: Scenario = {
  id: "step-budget-exhausted-still-plots",
  intent: "a loop that burns all 8 research steps still plots before the write call",
  userText: "Check every corner of the block for shade",
  tools: {
    check_shade: { shadeFraction: 0.5, status: "partial sun" },
    plot_points: { ok: true, plotted: 8 },
  },
  script: [
    ...PROBES.map((p) => ({ calls: [{ name: "check_shade", args: { ...p } }] })),
    { text: "The block is half shaded; the probes are pinned." },
  ],
  maxLlmCalls: 9,
  maxToolCalls: 9,
  expect: {
    toolOrder: [...PROBES.map(() => "check_shade"), "plot_points"],
    plotsBeforeWrite: true,
    pinCount: 8,
    answer: "The block is half shaded; the probes are pinned.",
  },
};

export const sharedModelSkipsWriteCall: Scenario = {
  id: "shared-model-skips-write-call",
  intent: "when both roles resolve to one model the research answer is the answer",
  userText: "Plan a shaded walk",
  sharedModel: true,
  tools: {
    search_places: { results: [BRYANT] },
    plot_points: { ok: true, plotted: 1 },
  },
  script: [
    { calls: [{ name: "search_places", args: { query: "shaded plazas" } }] },
    { text: "Use Bryant Park first." },
  ],
  grounded: [BRYANT.name],
  maxLlmCalls: 2,
  maxToolCalls: 2,
  expect: {
    toolOrder: ["search_places", "plot_points"],
    plotsBeforeWrite: true,
    pinLabels: [BRYANT.name],
    answer: "Use Bryant Park first.",
  },
};

/**
 * `check_shade` and `plan_shaded_route` candidates have no per-call cap of their
 * own, so this is the case where the overall `slice(0, 8)` is the only thing
 * standing between ten gathered candidates and ten pins.
 */
const LEGS = [
  { from: "Ainsworth Green", to: "Beckett Yard" },
  { from: "Cordell Walk", to: "Delaney Court" },
  { from: "Elmore Steps", to: "Fenner Lane" },
];

export const candidatesOverflowCapAtEightPins: Scenario = {
  id: "candidates-overflow-cap-at-eight-pins",
  intent: "ten gathered candidates still plot as eight pins, in gathering order",
  userText: "Check four corners then route me through three legs",
  tools: {
    check_shade: { shadeFraction: 0.4, status: "partial sun" },
    plan_shaded_route: { ok: true },
    plot_points: { ok: true, plotted: 8 },
  },
  script: [
    ...PROBES.slice(0, 4).map((p) => ({ calls: [{ name: "check_shade", args: { ...p } }] })),
    ...LEGS.map((leg, i) => ({
      calls: [
        {
          name: "plan_shaded_route",
          args: {
            fromLat: 41 + i * 0.01,
            fromLng: -74 - i * 0.01,
            fromLabel: leg.from,
            toLat: 41.005 + i * 0.01,
            toLng: -74.005 - i * 0.01,
            toLabel: leg.to,
          },
        },
      ],
    })),
    { text: "draft answer from the research model" },
    { text: "Eight of the ten spots are pinned." },
  ],
  maxLlmCalls: 9,
  maxToolCalls: 8,
  expect: {
    toolOrder: [
      "check_shade",
      "check_shade",
      "check_shade",
      "check_shade",
      "plan_shaded_route",
      "plan_shaded_route",
      "plan_shaded_route",
      "plot_points",
    ],
    plotsBeforeWrite: true,
    // Four unlabelled probes, then the first two legs — the third leg overflows.
    pinLabels: [
      undefined,
      undefined,
      undefined,
      undefined,
      LEGS[0].from,
      LEGS[0].to,
      LEGS[1].from,
      LEGS[1].to,
    ],
    answer: "Eight of the ten spots are pinned.",
  },
};
