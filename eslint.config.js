import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["**/dist/**", "**/node_modules/**", "apps/web/vite.config.ts.timestamp-*"],
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        URL: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly",
      },
    },
  },
);
