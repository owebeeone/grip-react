import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: [
      "tests/**/*.{test,spec}.ts",
      "tests/**/*.{test,spec}.tsx",
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


