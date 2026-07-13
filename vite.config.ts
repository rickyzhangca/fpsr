import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    semi: true,
    singleQuote: false,
    printWidth: 100,
    ignorePatterns: [
      "**/dist/**",
      "**/node_modules/**",
      "assets-out/**",
      ".cursor-tmp/**",
      "fixtures/**",
      "**/tmp-*.ts",
      "**/tmp-*.mts",
    ],
  },
  lint: {
    ignorePatterns: [
      "**/dist/**",
      "**/node_modules/**",
      "**/*.tsbuildinfo",
      "assets-out/**",
      ".cursor-tmp/**",
      "**/tmp-*.ts",
      "**/tmp-*.mts",
    ],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: false },
    overrides: [
      {
        files: ["apps/viewer/**"],
        plugins: ["typescript", "react"],
      },
      {
        files: ["**/*.test.ts", "**/*.spec.ts"],
        plugins: ["typescript", "vitest"],
      },
    ],
  },
});
