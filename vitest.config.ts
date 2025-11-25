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
      include: ["src/react/**/*.{ts,tsx}"],
      all: true,
      reporter: "text",
    },
  },
});
