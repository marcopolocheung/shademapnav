# Resume Tailoring CLI — Design Spec

## Context

The user is a linguistics major / CS minor graduating in ~1.5 months, with 2 SWE internships, 2 research positions, a published COLM 2025 paper, and this project (ShadeMap Navigator). They're targeting PM, SWE, and analyst new-grad roles. After 50-100 cold applications with ~0 callbacks and no referral applications, the core problem is resume conversion — resumes are role-specific but not tailored per job posting, likely failing ATS keyword matching and the first human scan.

**Goal:** A local CLI tool that takes a base LaTeX resume + a job posting and outputs a tailored `.tex` file optimized for that specific posting, plus a structured gap analysis report. Fast to run (under 30 seconds per application), no manual rewriting.

---

## Architecture

```
tools/tailor/
  cli.ts          # Entry point — commander, arg parsing, orchestration
  provider.ts     # Only file that imports AI SDKs; exports analyzeWithTools(), rewrite()
  scrape.ts       # Job posting fetch via Jina Reader + content validation
  analyze.ts      # Prompt construction for gap analysis (no SDK imports)
  rewrite.ts      # Prompt construction for .tex rewrite (no SDK imports)
  validate.ts     # LaTeX structural checks + optional pdflatex compile
  schema.ts       # GapReport Zod schema + raw JSON Schema export
  index.ts        # applications.json read/write for tracking history
```

**Dependencies:** `@anthropic-ai/sdk`, `openai`, `zod`, `commander`

---

## CLI Interface

```bash
npx tsx tools/tailor/cli.ts \
  --resume resumes/swe.tex \
  --posting "https://boards.greenhouse.io/acme/jobs/123" \
  [--provider anthropic|openai] \
  [--reorder] \
  [--no-compile]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--resume` | required | Path to base `.tex` resume |
| `--posting` | required | URL or local file path to job posting |
| `--provider` | auto-detect | Force Anthropic or OpenAI |
| `--reorder` | off | Allow bullet reordering within positions |
| `--no-compile` | off | Skip pdflatex validation even if available |

---

## Provider Abstraction (`provider.ts`)

The **only** file that imports `@anthropic-ai/sdk` or `openai`. Exposes two functions:

```typescript
export async function analyzeWithTools(systemPrompt: string, userMessage: string): Promise<GapReport>
export async function rewrite(systemPrompt: string, userMessage: string): Promise<string>
```

**Provider selection** (priority order):
1. `--provider` CLI flag
2. `TAILOR_PROVIDER` env var
3. Auto-detect: `ANTHROPIC_API_KEY` present → Anthropic; only `OPENAI_API_KEY` → OpenAI
4. Neither key → throw: `"No API key found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY."`

**Startup log:** `[tailor] Using provider: anthropic (claude-sonnet-4-5)` or `[tailor] Using provider: openai (gpt-4o)`

### analyzeWithTools — provider differences

- **Anthropic:** `tool_use` with `input_schema` set to `GapReportJsonSchema`; extract from `response.content.find(b => b.type === 'tool_use')?.input`
- **OpenAI:** `response_format: { type: "json_schema", json_schema: GapReportJsonSchema }`; extract from `JSON.parse(response.choices[0].message.content)`
- **Both:** Validate parsed output through Zod `GapReportSchema.parse()` before returning

### rewrite — provider differences

- **Anthropic:** `messages.create()` → `response.content[0].text`
- **OpenAI:** `chat.completions.create()` → `response.choices[0].message.content`
- **Both:** If response is empty or errors, throw with provider name in message

---

## Job Posting Scraping (`scrape.ts`)

**Input:** URL or local file path.

**URL path:**
1. Fetch via Jina Reader: `https://r.jina.ai/<url>` → clean markdown
2. If result is <200 words after stripping → warn user, show first 300 chars, ask to confirm or abort
3. Always show user first ~300 chars of scraped content before proceeding

**Local file path:** Read directly. Same content length check.

No headless browser needed — Jina Reader handles JS-rendered pages (Greenhouse, Lever, Workday, LinkedIn, etc.).

---

## Gap Analysis (`analyze.ts` + `schema.ts`)

### GapReport Schema

```typescript
// schema.ts — Zod schema
export const GapReportSchema = z.object({
  matched_keywords:     z.array(z.string()),
  missing_keywords:     z.array(z.string()),
  missing_requirements: z.array(z.string()),
  changes_planned: z.array(z.object({
    section:  z.string(),
    original: z.string(),
    revised:  z.string(),
    reason:   z.string(),
  })),
  confidence: z.enum(["high", "medium", "low"]),
})

// Also exported as raw JSON Schema object for OpenAI/Anthropic
export const GapReportJsonSchema = { name: "gap_report", strict: true, schema: { ... } }
```

### Prompt (constructed in `analyze.ts`)

System prompt instructs the model to:
- Compare the resume content against the job posting requirements
- Identify matched keywords, missing keywords, and unmet requirements
- Distinguish between: (a) skills you have but didn't mention, (b) requirements you partially meet, (c) requirements you genuinely lack
- Plan specific bullet rewrites with before/after and reason
- Return confidence level based on overall fit

`analyze.ts` constructs the prompt and calls `provider.analyzeWithTools()`. No SDK imports.

---

## Resume Rewrite (`rewrite.ts`)

### Prompt constraints (non-negotiable)

1. **NEVER fabricate** experience, degrees, skills, or metrics
2. **Reword and reframe** only what already exists in the resume
3. **Do not reorder** job entries, education entries, or top-level sections
4. Bullet reordering within a single position: **only if `--reorder` flag** is set
5. **Preserve all LaTeX** commands, environments, `\begin`/`\end` pairs, custom macros exactly

### Input to the prompt

- The full base `.tex` file
- The cleaned job posting text
- The gap report from step 3 (so the model knows exactly what changes to make)

### Output

The complete modified `.tex` file — nothing else. No JSON, no commentary, no markdown fences.

`rewrite.ts` constructs the prompt and calls `provider.rewrite()`. No SDK imports.

---

## Validation (`validate.ts`)

After receiving the rewritten `.tex`:

1. **Never modify the original file.** Write only to `tailored/` directory.
2. **Structural check:** Count `\begin{...}` and `\end{...}` pairs in input vs output. Mismatch → error.
3. **Diff size guard:** If character diff exceeds 20% of the original document → warn user that changes are unusually large.
4. **Compile check** (unless `--no-compile`): If `pdflatex` or `xelatex` is on PATH, attempt compilation. Surface errors clearly. This is validation, not just a convenience PDF export.

---

## Output & File Naming (`index.ts`)

**Output file:** `tailored/<base>-<company-slug>-<YYYYMMDD>.tex`

Slug derivation:
- URL input: extract domain + path keywords (e.g., `greenhouse-acme-senior-eng`)
- Local file: use filename without extension

**Terminal output:**
- Colored diff (original vs tailored)
- Gap report summary (matched/missing keywords, unmet requirements)
- Provider and confidence level

**History tracking:** Append to `tailored/applications.json`:
```json
{
  "file": "swe-acme-corp-20260401.tex",
  "source_posting": "https://boards.greenhouse.io/acme/jobs/123",
  "date": "2026-04-01",
  "provider": "anthropic",
  "gap_summary": {
    "matched": 8,
    "missing_keywords": 3,
    "missing_requirements": 1,
    "confidence": "high"
  }
}
```

---

## Environment Configuration

`.env.example`:
```bash
# Provider (auto-detected from keys if not set)
TAILOR_PROVIDER=anthropic

# Anthropic — https://console.anthropic.com/
ANTHROPIC_API_KEY=sk-ant-...

# OpenAI fallback — https://platform.openai.com/api-keys
OPENAI_API_KEY=sk-...
```

---

## Verification Plan

1. **Unit test:** `schema.ts` — validate a known-good GapReport object passes Zod, a malformed one fails
2. **Unit test:** `scrape.ts` — mock Jina Reader response, verify content length check triggers on short content
3. **Unit test:** `validate.ts` — verify `\begin`/`\end` mismatch detection, diff size warning threshold
4. **Integration test:** Run the full CLI against a sample `.tex` resume + a saved job posting text file; verify output `.tex` compiles, gap report is valid JSON, `applications.json` is updated
5. **Manual smoke test:** Run against a real job posting URL, inspect the tailored resume for fabricated content, verify LaTeX compiles cleanly
