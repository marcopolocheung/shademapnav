/**
 * The agentic loop: a code-orchestrated tool-use cycle on top of a single
 * stateless model endpoint (Gemini, free tier).
 *
 *   user text → model → (function calls?) → execute tools → feed results back
 *             → model → ... → final text answer
 *
 * History is the Gemini `contents` array, threaded across turns so the
 * conversation (and the agent's earlier tool observations) persist.
 */
import {
  callModel,
  rolesShareConfig,
  type LlmContent,
  type LlmPart,
} from "./llmClient";
import { executeTool, toolDeclarations, type AgentContext, type AssistantPin } from "./tools";

const SYSTEM_PROMPT = `You are the Shade Assistant in a sun/shadow mapping app. You ONLY plan a day or outing around shade and sun comfort: shaded walks, where to sit or eat out of the sun at a given hour, and shade-aware routes. If asked anything else, reply in one sentence that you only help plan around shade, and stop. Do not answer off-topic questions.

The current map context (center, local time, whether the user's location is known) is given to you below — use it directly; do NOT ask for it.

Procedure (follow in order):
1. If locationKnown is false: if the user said "here"/"near me", call locate_user; otherwise ask which area they mean. Never invent a location.
2. If the user gave a time of day (e.g. "afternoon"), call set_time to that hour. Shadows depend on time.
3. Find stops with search_places (anchor to lat/lng or a 'near' name) or geocode_place for named places.
4. Confirm shade at the key stops with check_shade(lat,lng,time) — it returns real building-shade 0..1.
5. Call plot_points with the FULL ordered list of stops (numbered pins, map auto-framed).
6. Optionally plan_shaded_route between two stops.

Rules: stay in the user's area; sequence stops by time of day (shade moves with the sun); keep answers short and concrete.`;

// The happy path needs 6 tool-emitting turns (get_current_context, locate_user,
// set_time, search_places, check_shade×N, plot_points). A lower cap strands the
// loop before plot_points runs — so no pins ever reach the map. Keep headroom
// for an extra check_shade per candidate.
const MAX_STEPS = 8;

// System prompt for the final write call. The write call has NO tools, so it
// must NOT reuse the research procedure (which orders the model to "call X"):
// a reasoning model handed those instructions with no tools available narrates
// the calls it can't make (raw `{"name":...}` JSON) into the answer. This prompt
// keeps the topic guardrail but tells it to synthesize only, never tool-call.
const WRITE_SYSTEM_PROMPT = `You are the Shade Assistant in a sun/shadow mapping app. Using ONLY the information already gathered earlier in this conversation, write the final answer: a short, concrete shade-aware itinerary with specific local times and place names. Do NOT call, mention, narrate, or emit any tools, function calls, or JSON. If little was gathered, give the best brief shade advice you can from what is available. Stay on shade/sun comfort only.`;

export interface ToolEvent {
  name: string;
  args: Record<string, unknown>;
}

export interface RunAgentOptions {
  history: LlmContent[];
  userText: string;
  ctx: AgentContext;
  /** Called when the agent decides to invoke a tool (for UI activity display). */
  onToolEvent?: (e: ToolEvent) => void;
}

export interface RunAgentResult {
  /** Final natural-language answer. */
  text: string;
  /** Updated history to thread into the next turn. */
  history: LlmContent[];
}

function extractText(content: LlmContent | undefined): string {
  if (!content) return "";
  return content.parts
    .map((p) => p.text ?? "")
    .join("")
    .trim();
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function pinKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

function collectPointCandidates(
  toolName: string,
  args: Record<string, unknown>,
  result: Record<string, unknown>,
  candidates: AssistantPin[]
): void {
  const add = (lat: unknown, lng: unknown, label?: unknown) => {
    const nLat = num(lat);
    const nLng = num(lng);
    if (nLat == null || nLng == null) return;
    const key = pinKey(nLat, nLng);
    if (candidates.some((p) => pinKey(p.lat, p.lng) === key)) return;
    candidates.push({ lat: nLat, lng: nLng, label: str(label) });
  };

  if (toolName === "check_shade") {
    add(args.lat, args.lng);
    return;
  }

  if (toolName === "plan_shaded_route") {
    add(args.fromLat, args.fromLng, args.fromLabel);
    add(args.toLat, args.toLng, args.toLabel);
    return;
  }

  if (toolName === "geocode_place" || toolName === "search_places") {
    const results = Array.isArray(result.results) ? result.results : [];
    for (const item of results) {
      const o = (item ?? {}) as Record<string, unknown>;
      add(o.lat, o.lng, o.name);
      if (candidates.length >= 8) break;
    }
  }
}

function plottedPointSummary(pins: AssistantPin[]): string {
  return pins
    .map((p, i) => {
      const label = p.label ? `${p.label} ` : "";
      return `${i + 1}. ${label}(${p.lat.toFixed(5)}, ${p.lng.toFixed(5)})`;
    })
    .join("; ");
}

export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  const { ctx, onToolEvent } = opts;
  const contents: LlmContent[] = [
    ...opts.history,
    { role: "user", parts: [{ text: opts.userText }] },
  ];

  // Deterministic pre-injection: the map center / local time / location-known
  // status is plain app state, so we read it directly instead of spending an LLM
  // round-trip on a get_current_context tool call. Fetched fresh each turn and
  // appended to the system prompt (not the persisted history, so it never goes
  // stale across turns). get_current_context is read-only — no side effects.
  let ctxSnapshot: Record<string, unknown> = {};
  try {
    ctxSnapshot = await executeTool("get_current_context", {}, ctx);
  } catch {
    /* map not ready — fall through with empty context */
  }
  const ctxLine = `\n\nLive map context (already fetched — do NOT ask for it): ${JSON.stringify(
    ctxSnapshot
  )}`;

  // When research/response resolve to the same model, a separate write call is
  // wasted tokens — the research model's own final answer is the answer.
  const separateWrite = !rolesShareConfig();
  const pointCandidates: AssistantPin[] = [];
  let plottedPoints = false;
  let fallbackPlotLine = "";

  const plotFallbackPoints = async (): Promise<string> => {
    if (plottedPoints || pointCandidates.length === 0) return "";
    const pins = pointCandidates.slice(0, 8);
    onToolEvent?.({ name: "plot_points", args: { points: pins } });
    try {
      const result = await executeTool("plot_points", { points: pins }, ctx);
      if (result.error) return "";
      plottedPoints = true;
      return `\n\nMap state guarantee: the app already plotted these itinerary pins before answering: ${plottedPointSummary(pins)}.`;
    } catch {
      return "";
    }
  };

  // --- Research phase: tool-use loop on the "research" model. ---
  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await callModel(
      {
        contents,
        tools: [{ functionDeclarations: toolDeclarations }],
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT + ctxLine }] },
        generationConfig: { temperature: 0 },
      },
      "research"
    );

    const candidate = res.candidates?.[0]?.content;
    if (!candidate) {
      const blocked = res.promptFeedback?.blockReason;
      if (blocked) return { text: `I couldn't respond to that (${blocked}).`, history: contents };
      break; // nothing came back — fall through to the write phase
    }

    const calls = candidate.parts.filter((p) => p.functionCall);
    if (calls.length === 0) {
      // Done researching.
      fallbackPlotLine ||= await plotFallbackPoints();
      if (!separateWrite) {
        // Same config for both roles → research model's answer IS the answer.
        // Returning it here saves a full-context write call (TPD savings).
        contents.push({ role: candidate.role ?? "model", parts: candidate.parts });
        return { text: extractText(candidate) || "(no reply)", history: contents };
      }
      // Roles differ → discard this draft; the response model writes below.
      break;
    }

    // Persist the tool-call turn, execute the calls, feed results back.
    contents.push({ role: candidate.role ?? "model", parts: candidate.parts });
    const responseParts: LlmPart[] = [];
    for (const part of calls) {
      const fc = part.functionCall!;
      onToolEvent?.({ name: fc.name, args: fc.args ?? {} });
      let result: Record<string, unknown>;
      try {
        result = await executeTool(fc.name, fc.args ?? {}, ctx);
      } catch (err) {
        result = { error: err instanceof Error ? err.message : "Tool failed." };
      }
      if (fc.name === "plot_points" && !result.error) plottedPoints = true;
      collectPointCandidates(fc.name, fc.args ?? {}, result, pointCandidates);
      responseParts.push({ functionResponse: { name: fc.name, response: result } });
    }
    contents.push({ role: "user", parts: responseParts });
  }

  fallbackPlotLine ||= await plotFallbackPoints();

  // --- Write phase: final answer on the "response" model, no tools. ---
  const finalRes = await callModel(
    {
      contents,
      systemInstruction: { parts: [{ text: WRITE_SYSTEM_PROMPT + ctxLine + fallbackPlotLine }] },
      generationConfig: { temperature: 0 },
    },
    "response"
  );

  const finalCandidate = finalRes.candidates?.[0]?.content;
  if (!finalCandidate) {
    const blocked = finalRes.promptFeedback?.blockReason;
    return {
      text: blocked
        ? `I couldn't respond to that (${blocked}).`
        : "I didn't get a response from the model. Try rephrasing.",
      history: contents,
    };
  }

  contents.push({ role: finalCandidate.role ?? "model", parts: finalCandidate.parts });
  return { text: extractText(finalCandidate) || "(no reply)", history: contents };
}
