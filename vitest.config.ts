import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const testFiles = ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"];
const packagesDir = fileURLToPath(new URL("./packages/", import.meta.url));

export default defineConfig({
  resolve: {
    // Tests run against each package's source, so no build is needed first.
    alias: [{ find: /^@familiar\/(.*)$/, replacement: `${packagesDir}$1/src/index.ts` }],
  },
  test: {
    include: testFiles,
    passWithNoTests: true,
    typecheck: {
      enabled: true,
      include: testFiles,
      tsconfig: "./tsconfig.test.json",
    },
  },
});
