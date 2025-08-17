import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "tests/**/*.{test,spec}.ts",
    ],
    reporters: "default",
    coverage: {
      all: true,
      reporter: "text",
      lines: 80,
      functions: 80,
      branches: 80,
      statements: 80,
    },
  },
});


