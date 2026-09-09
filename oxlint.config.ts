import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";

export default defineConfig({
  env: { node: true },
  extends: [core, antiSlop],
  // Benchmark relocation does not change the existing research-tooling scope.
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    "docs/**",
    "scripts/benchmarks/**",
    "**/*.py",
  ],
});
