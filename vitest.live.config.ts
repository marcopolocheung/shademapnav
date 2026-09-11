import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

/**
 * The agent's live eval — `npm run eval:agent`. Never part of `npm test`: it
 * reaches a real model, needs a key, and costs requests. The hermetic suite in
 * vitest.config.ts stays hermetic.
 *
 * AGENT_EVAL_PROVIDER=cerebras (default) uses the app's own key pool from .env;
 * =fireworks uses FIREWORKS_KEY and one pinned model, under a spend cap.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    test: {
      environment: "node",
      include: ["app/lib/agent/__tests__/live/**/*.eval.ts"],
      testTimeout: 10 * 60_000,
      hookTimeout: 60_000,
      env: {
        AGENT_EVAL_PROVIDER: process.env.AGENT_EVAL_PROVIDER ?? "cerebras",
        AGENT_EVAL_ONLY: process.env.AGENT_EVAL_ONLY ?? "",
        AGENT_EVAL_OUT: process.env.AGENT_EVAL_OUT ?? "",
        AGENT_EVAL_RESEARCH_MODEL: process.env.AGENT_EVAL_RESEARCH_MODEL ?? "",
        AGENT_EVAL_RESPONSE_MODEL: process.env.AGENT_EVAL_RESPONSE_MODEL ?? "",
        FIREWORKS_KEY: env.FIREWORKS_KEY ?? "",
      },
    },
  };
});
