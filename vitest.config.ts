import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["app/{lib,services,hooks}/__tests__/**/*.test.ts"],
  },
});
