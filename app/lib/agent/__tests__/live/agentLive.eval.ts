/**
 * The live eval — the C1 scenarios against a real model. `npm run eval:agent`.
 *
 * Each scenario keeps its world (stubbed tools, map context) and drops its
 * script: every model turn comes from the real `callModel`, through the real
 * OpenAI translation, tool-call salvage and retry logic in llmClient.ts. Only
 * the network hop is redirected here, to Cerebras or to one pinned Fireworks
 * model. The hermetic suite proves the loop handles the turns we scripted; this
 * proves the turns we scripted are the turns a model actually takes.
 *
 * A grounding violation fails the scenario. Everything else — did the model
 * follow the scripted tool path, stay in budget, hit a tool the scenario never
 * stubbed — is measured and reported, because a real model is allowed to take
 * another route to a grounded answer.
 */
import { writeFileSync } from "node:fs";
import { afterAll, describe, expect, it, vi } from "vitest";
import { runAgent } from "../../agentLoop";
import { callModel, rolesShareConfig } from "../../llmClient";
import { executeTool } from "../../tools";
import {
  groundingViolations,
  runLiveScenario,
  type HarnessMocks,
  type Scenario,
  type Trace,
} from "../harness";
import { scenarios } from "../scenarios";

vi.mock("../../llmClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../llmClient")>()),
  callModel: vi.fn(),
  rolesShareConfig: vi.fn(),
}));

vi.mock("../../tools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../tools")>()),
  executeTool: vi.fn(),
}));

const real = await vi.importActual<typeof import("../../llmClient")>("../../llmClient");

const mocks: HarnessMocks = {
  callModel: vi.mocked(callModel),
  rolesShareConfig: vi.mocked(rolesShareConfig),
  executeTool: vi.mocked(executeTool),
};

// ---------------------------------------------------------------------------
// Transport: llmClient posts to the dev proxy path; send it upstream instead.
// ---------------------------------------------------------------------------

const PROVIDER = process.env.AGENT_EVAL_PROVIDER === "fireworks" ? "fireworks" : "cerebras";
/** The only Fireworks model this eval may call. */
const FIREWORKS_MODEL = "accounts/fireworks/models/deepseek-v4-flash-0731";
/** USD per 1M tokens — about 4× the listed $0.14 / $0.28, so the cap trips early, not late. */
const PRICE_PER_M = { input: 0.6, output: 1.2 };
const SPEND_CAP_USD = 1;
/** Cerebras allows 5 requests/minute per key; spacing calls spares the 429 retries. */
const MIN_GAP_MS = PROVIDER === "cerebras" ? 4000 : 0;

const usage = { requests: 0, input: 0, output: 0, models: new Set<string>() };
const spentUsd = () => (usage.input * PRICE_PER_M.input + usage.output * PRICE_PER_M.output) / 1e6;

if (PROVIDER === "fireworks") {
  if (!process.env.FIREWORKS_KEY) throw new Error("live eval: FIREWORKS_KEY is not set in .env");
  // llmClient refuses to run without a Cerebras key; none leaves this process.
  vi.stubEnv("VITE_CEREBRAS_API_KEY", "unused-fireworks-eval");
}

// Compare models without touching .env: override either role for this run.
if (process.env.AGENT_EVAL_RESEARCH_MODEL) {
  vi.stubEnv("VITE_CEREBRAS_RESEARCH_MODEL", process.env.AGENT_EVAL_RESEARCH_MODEL);
}
if (process.env.AGENT_EVAL_RESPONSE_MODEL) {
  vi.stubEnv("VITE_CEREBRAS_RESPONSE_MODEL", process.env.AGENT_EVAL_RESPONSE_MODEL);
}
const MODELS =
  PROVIDER === "fireworks"
    ? `both roles ${FIREWORKS_MODEL}`
    : `research ${import.meta.env.VITE_CEREBRAS_RESEARCH_MODEL ?? import.meta.env.VITE_CEREBRAS_MODEL ?? "gpt-oss-120b"}, ` +
      `response ${import.meta.env.VITE_CEREBRAS_RESPONSE_MODEL ?? import.meta.env.VITE_CEREBRAS_MODEL ?? "gpt-oss-120b"}`;

/** Non-2xx provider replies, with the model asked for — never the key. */
const providerErrors: string[] = [];
const realFetch = globalThis.fetch;
let lastRequestAt = 0;

vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (!url.startsWith("/__cerebras/")) throw new Error(`live eval: unexpected fetch to ${url}`);

  const wait = lastRequestAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();

  let res: Response;
  if (PROVIDER === "fireworks") {
    if (spentUsd() >= SPEND_CAP_USD) {
      throw new Error(`live eval: spend cap of $${SPEND_CAP_USD} reached`);
    }
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    body.model = FIREWORKS_MODEL;
    res = await realFetch("https://api.fireworks.ai/inference/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.FIREWORKS_KEY}`,
      },
      body: JSON.stringify(body),
    });
  } else {
    res = await realFetch(`https://api.cerebras.ai${url.slice("/__cerebras".length)}`, init);
  }

  usage.requests++;
  if (!res.ok) {
    const requested = (JSON.parse(String(init?.body)) as { model?: string }).model;
    const detail = (
      await res
        .clone()
        .text()
        .catch(() => "")
    ).slice(0, 300);
    providerErrors.push(
      `HTTP ${res.status} for ${PROVIDER === "fireworks" ? FIREWORKS_MODEL : requested}: ${detail}`,
    );
  }
  const data = (await res
    .clone()
    .json()
    .catch(() => ({}))) as {
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  usage.input += data.usage?.prompt_tokens ?? 0;
  usage.output += data.usage?.completion_tokens ?? 0;
  if (data.model) usage.models.add(data.model);
  return res;
});

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

/** Premised on a provider failure — no real model can be asked to produce one. */
const SCRIPT_ONLY = new Set([
  "blocked-prompt-degrades",
  "empty-research-falls-through-to-write",
  "empty-write-says-so",
]);

const only = (process.env.AGENT_EVAL_ONLY ?? "").split(",").filter(Boolean);
const liveScenarios = scenarios.filter(
  (s) => !SCRIPT_ONLY.has(s.id) && (only.length === 0 || only.includes(s.id)),
);

/**
 * A real model fills gaps a script never has to: it calls tools the scenario
 * didn't stub. An unstubbed tool returning an error sends it into retries that
 * say more about the fixture than the model, so live runs get a neutral world
 * for the rest — one that never invents a place (searches come back empty).
 * The scenario's own stubs win.
 */
const DEFAULT_WORLD: Scenario["tools"] = {
  locate_user: { lat: 40.7536, lng: -73.9832, note: "Centered the map on the user's location." },
  geocode_place: { results: [], note: "No matches found." },
  search_places: {
    results: [],
    note: "No matches in that area. Try a broader query or a different anchor.",
  },
  check_shadow: { shadowFraction: 0.5, status: "partial sun", atLocalTime: "2:00 PM" },
  set_time: (args) => ({ ok: true, newLocalTime: String(args.time ?? "2:00 PM") }),
  plot_points: (args) => ({
    ok: true,
    plotted: Array.isArray(args.points) ? args.points.length : 0,
  }),
  plan_shadowed_route: { ok: true, note: "Route calculation started and will draw on the map." },
};

/**
 * Places a model knows are near the default map centre (Midtown Manhattan)
 * without any tool telling it. A script never names one unprompted; a real
 * model does — the pre-C2 loop answered an empty café search with "head to
 * Bryant Park". Naming one that isn't pinned is the invention the name check
 * exists to catch, so every live scenario watches for them.
 */
const NEARBY_LANDMARKS = [
  "Bryant Park",
  "Grace Plaza",
  "Madison Square Park",
  "Times Square",
  "Herald Square",
  "Grand Central",
  "New York Public Library",
  "Empire State Building",
  "Greeley Square",
  "Paley Park",
  "Rockefeller Center",
];

function forLive(scenario: Scenario): Scenario {
  return {
    ...scenario,
    tools: { ...DEFAULT_WORLD, ...scenario.tools },
    // Echoing a place the user named ("I couldn't find X") is not an invention.
    decoys: [
      ...(scenario.decoys ?? []),
      ...NEARBY_LANDMARKS.filter((name) => !scenario.userText.includes(name)),
    ],
  };
}

interface Row {
  id: string;
  sharedModel: boolean;
  violations: string[];
  /** plot_points calls the model made, and ones the loop made for it (fallback, reconcile). */
  modelPlots: number;
  loopPlots: number;
  followedScript: boolean;
  expectedTools: string[];
  actualTools: string[];
  llmCalls: number;
  llmBudget: number;
  toolCalls: number;
  toolBudget: number;
  /** Tools the model called that the scenario never stubbed — answered by DEFAULT_WORLD. */
  stubMisses: string[];
  /** Tool-call markup that leaked into the user-facing answer. */
  narratedToolSyntax: boolean;
  pins: string[];
  answer: string;
  error?: string;
}

const rows: Row[] = [];

/** Whether any call produced a place the loop could pin — the live condition for requiring a plot. */
function gatheredAPlace(trace: Trace): boolean {
  return trace.toolCalls.some((c) => {
    if (c.name === "check_shadow") return typeof c.args.lat === "number";
    if (c.name === "plan_shadowed_route") return typeof c.args.fromLat === "number";
    return Array.isArray(c.result.results) && c.result.results.length > 0;
  });
}

function summarize(scenario: Scenario, trace: Trace | undefined, error?: string): Row {
  const actualTools = trace?.toolCalls.map((c) => c.name) ?? [];
  const answer = trace?.answer ?? "";
  const plots = actualTools.filter((n) => n === "plot_points").length;
  const modelPlots = (trace?.history ?? [])
    .flatMap((c) => c.parts)
    .filter((p) => p.functionCall?.name === "plot_points").length;
  return {
    id: scenario.id,
    sharedModel: scenario.sharedModel === true,
    // A scripted scenario knows whether its path gathers anything; a live one
    // doesn't, so the plot is required exactly when a place was gathered.
    violations: trace
      ? groundingViolations(trace, {
          ...forLive(scenario),
          expect: { ...scenario.expect, plotsBeforeWrite: gatheredAPlace(trace) },
        })
      : [],
    modelPlots,
    loopPlots: plots - modelPlots,
    followedScript: JSON.stringify(actualTools) === JSON.stringify(scenario.expect.toolOrder),
    expectedTools: scenario.expect.toolOrder,
    actualTools,
    llmCalls: trace?.llmRequests.length ?? 0,
    llmBudget: scenario.maxLlmCalls,
    toolCalls: actualTools.length,
    toolBudget: scenario.maxToolCalls,
    stubMisses: actualTools.filter((name) => !(name in (scenario.tools ?? {}))),
    narratedToolSyntax: /<\/?function|<tool_call>|"name"\s*:|functionCall/.test(answer),
    pins: trace?.plottedPins.map((p) => p.label ?? "·") ?? [],
    answer,
    error,
  };
}

describe(`live agent eval — ${PROVIDER}`, () => {
  it.each(liveScenarios.map((s) => [s.id, s] as const))("%s", async (_id, scenario) => {
    let trace: Trace | undefined;
    let error: string | undefined;
    try {
      trace = await runLiveScenario(forLive(scenario), runAgent, mocks, real.callModel);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    const row = summarize(scenario, trace, error);
    rows.push(row);
    expect(row.error, "the turn threw").toBeUndefined();
    expect(row.violations).toEqual([]);
  });
});

afterAll(() => {
  const n = rows.length;
  const count = (f: (r: Row) => boolean) => rows.filter(f).length;
  const lines = [
    `## Live agent eval — ${PROVIDER}: ${MODELS}`,
    "",
    "| scenario | grounded | followed script | LLM calls / budget | tools / budget | default-world calls | plots model/loop | pins | answer |",
    "|---|---|---|---|---|---|---|---|---|",
    ...rows
      .map((r) =>
        [
          r.id + (r.sharedModel ? " (shared)" : ""),
          r.error
            ? `error: ${r.error.slice(0, 80)}`
            : r.violations.length
              ? r.violations.join("; ")
              : "yes",
          r.followedScript ? "yes" : `no: ${r.actualTools.join(" → ") || "(none)"}`,
          `${r.llmCalls} / ${r.llmBudget}`,
          `${r.toolCalls} / ${r.toolBudget}`,
          r.stubMisses.join(", ") || "—",
          `${r.modelPlots}/${r.loopPlots}`,
          r.pins.join(", ") || "—",
          r.answer.replace(/\s+/g, " ").replace(/\|/g, "/").slice(0, 160),
        ].join(" | "),
      )
      .map((l) => `| ${l} |`),
    "",
    `Grounded: ${count((r) => !r.error && r.violations.length === 0)}/${n} · ` +
      `errors: ${count((r) => !!r.error)} · followed script: ${count((r) => r.followedScript)}/${n} · ` +
      `over LLM budget: ${count((r) => r.llmCalls > r.llmBudget)} · ` +
      `tool markup in answer: ${count((r) => r.narratedToolSyntax)} · ` +
      `needed default world: ${count((r) => r.stubMisses.length > 0)}`,
    `Requests: ${usage.requests} · tokens in/out: ${usage.input}/${usage.output}` +
      (PROVIDER === "fireworks" ? ` · est. spend ≤ $${spentUsd().toFixed(4)}` : ""),
  ];
  if (providerErrors.length) {
    lines.push(
      "",
      `Provider errors (${providerErrors.length}):`,
      ...[...new Set(providerErrors)].map((e) => `- ${e}`),
    );
  }
  const report = `${lines.join("\n")}\n`;
  // Straight to stdout: vitest swallows console output on a green run.
  process.stdout.write(`\n${report}`);
  const out = process.env.AGENT_EVAL_OUT;
  if (out) {
    writeFileSync(`${out}.md`, report);
    writeFileSync(
      `${out}.json`,
      JSON.stringify(
        {
          provider: PROVIDER,
          models: MODELS,
          served: [...usage.models],
          usage: { ...usage, models: undefined },
          rows,
        },
        null,
        2,
      ),
    );
  }
});
