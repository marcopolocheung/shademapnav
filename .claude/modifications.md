# OpenAI Fallback Provider — Implementation TODO

The goal is to support seamless fallback from Anthropic to OpenAI when credits run out, without changing the behavior of `analyze.ts` or `rewrite.ts`. All provider-specific logic lives in one place.

---

## 1. Add `provider.ts` — The Core Abstraction

**Create `tools/tailor/provider.ts`.**

This file is the only place that imports from `@anthropic-ai/sdk` or `openai`. Everything else in the codebase calls through it.

It must expose two functions with identical signatures regardless of which provider is active:

```typescript
export async function analyzeWithTools(systemPrompt: string, userMessage: string): Promise<GapReport>
export async function rewrite(systemPrompt: string, userMessage: string): Promise<string>
```

Provider selection logic (in priority order):
1. `--provider anthropic|openai` CLI flag (highest priority, explicit override)
2. `TAILOR_PROVIDER` env var (`anthropic` or `openai`)
3. Auto-detect: if `ANTHROPIC_API_KEY` is set, use Anthropic. If only `OPENAI_API_KEY` is set, use OpenAI.
4. If neither key is present, throw a clear error: `"No API key found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY."`

---

## 2. Add Dependencies

Install the OpenAI SDK alongside the existing Anthropic one:

```bash
npm install openai
```

`package.json` should end up with both:
```json
"@anthropic-ai/sdk": "...",
"openai": "..."
```

---

## 3. Implement `analyzeWithTools` for Both Providers

This is the highest-complexity function because tool use / structured output works differently between providers.

### Anthropic path
Use the existing tool_use approach already designed in `analyze.ts`. Move it here verbatim. The response shape is:
```typescript
response.content.find(block => block.type === 'tool_use')?.input
```

### OpenAI path
Use `response_format: { type: "json_schema", json_schema: { ... } }` with the same schema defined in `schema.ts`. This is OpenAI's structured output mechanism (available on `gpt-4o` and later). The response shape is:
```typescript
JSON.parse(response.choices[0].message.content)
```

### Normalization
Both paths must return the same `GapReport` type defined in `schema.ts`. Validate the parsed output against the schema before returning it — don't trust either provider to always return a perfectly conformant object.

```typescript
// After parsing from either provider:
const validated = GapReportSchema.parse(parsed) // zod or equivalent
return validated
```

---

## 4. Implement `rewrite` for Both Providers

This is simpler — both providers return plain text.

### Anthropic path
```typescript
const response = await anthropic.messages.create({
  model: 'claude-opus-4-5',
  max_tokens: 4096,
  messages: [{ role: 'user', content: userMessage }],
  system: systemPrompt,
})
return response.content[0].text
```

### OpenAI path
```typescript
const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  max_tokens: 4096,
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ],
})
return response.choices[0].message.content ?? ''
```

Both paths: if the response is empty or the provider returns an error, throw a descriptive error that includes the provider name so the user knows which one failed.

---

## 5. Update `schema.ts` to Export a JSON Schema (Not Just TypeScript Types)

`schema.ts` currently defines TypeScript types. It needs to also export a raw JSON Schema object that can be passed directly to OpenAI's `json_schema` response format param — OpenAI does not accept Zod schemas or TypeScript types, it needs a plain JSON Schema object.

Add to `schema.ts`:

```typescript
export const GapReportJsonSchema = {
  name: "gap_report",
  strict: true,
  schema: {
    type: "object",
    properties: {
      matched_keywords:      { type: "array", items: { type: "string" } },
      missing_keywords:      { type: "array", items: { type: "string" } },
      missing_requirements:  { type: "array", items: { type: "string" } },
      changes_planned: {
        type: "array",
        items: {
          type: "object",
          properties: {
            section:  { type: "string" },
            original: { type: "string" },
            revised:  { type: "string" },
            reason:   { type: "string" },
          },
          required: ["section", "original", "revised", "reason"],
          additionalProperties: false,
        }
      },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
    required: [
      "matched_keywords", "missing_keywords", "missing_requirements",
      "changes_planned", "confidence"
    ],
    additionalProperties: false,
  }
}
```

The Anthropic tool definition in `provider.ts` uses the same schema shape (Anthropic's tool `input_schema` is also JSON Schema).

---

## 6. Update `cli.ts` to Accept `--provider` Flag

Add to the Commander option definitions:

```typescript
.option('--provider <name>', 'API provider to use: anthropic or openai', '')
```

Pass the value into `provider.ts` at initialization (before any API calls are made). If an invalid value is passed, fail fast with a clear error listing valid options.

Also update the startup log line so the user always knows which provider is active:

```
[tailor] Using provider: anthropic (claude-opus-4-5)
[tailor] Using provider: openai (gpt-4o)
```

---

## 7. Update `analyze.ts` and `rewrite.ts`

Both files should be simplified — they no longer call the Anthropic SDK directly.

- Remove all `@anthropic-ai/sdk` imports from both files.
- Replace direct SDK calls with calls to `analyzeWithTools(...)` and `rewrite(...)` from `provider.ts`.
- These files become pure prompt construction + result handling. No provider logic lives here.

---

## 8. Update `.env.example`

Add both keys and the provider selector so users know what's available:

```bash
# Primary provider (anthropic or openai). Auto-detected from keys if not set.
TAILOR_PROVIDER=anthropic

# Anthropic — https://console.anthropic.com/
ANTHROPIC_API_KEY=sk-ant-...

# OpenAI fallback — https://platform.openai.com/api-keys
OPENAI_API_KEY=sk-...
```

---

## 9. Add a Note to `README` About Quality Parity

Both providers will work, but results are not identical. Add a brief note:

> **Provider note:** GPT-4o is a capable fallback for the rewrite step. The gap analysis step relies on strict schema adherence, where Claude tends to be more consistent. If you notice the gap report missing fields or returning unexpected values when using OpenAI, this is the likely cause. Both providers are production-ready for general use.

---

## Summary of File Changes

| File | Change |
|------|--------|
| `tools/tailor/provider.ts` | **New file** — all provider logic lives here |
| `tools/tailor/schema.ts` | Add `GapReportJsonSchema` export for OpenAI compatibility |
| `tools/tailor/analyze.ts` | Remove SDK import, call `provider.analyzeWithTools` instead |
| `tools/tailor/rewrite.ts` | Remove SDK import, call `provider.rewrite` instead |
| `tools/tailor/cli.ts` | Add `--provider` flag, log active provider on startup |
| `.env.example` | Add `OPENAI_API_KEY` and `TAILOR_PROVIDER` entries |
| `README.md` | Add provider quality parity note |
| `package.json` | Add `openai` dependency |