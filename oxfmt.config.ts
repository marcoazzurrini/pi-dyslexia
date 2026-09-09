import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  ignorePatterns: [
    ...(ultracite.ignorePatterns ?? []),
    "docs/**",
    "scripts/benchmarks/**",
    "**/*.md",
    "**/*.py",
    "**/*.sh",
    "**/*.txt",
    "package-lock.json",
  ],
});
