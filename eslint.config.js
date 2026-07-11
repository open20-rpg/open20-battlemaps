import js from "@eslint/js"
import tseslint from "typescript-eslint"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"
import prettier from "eslint-config-prettier"

export default tseslint.config(
  { ignores: ["dist", "src-tauri/target", "docs"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs.flat["recommended-latest"],
      reactRefresh.configs.vite,
      prettier,
    ],
    rules: {
      // The param system passes discriminated unions around; unused vars in
      // exhaustive switches are bugs, not style.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
    },
  },
  {
    // Chakra CLI snippets — vendored code, keep diffable against upstream.
    files: ["src/ui/chakra/**", "src/components/ui/**"],
    rules: {
      "react-refresh/only-export-components": "off",
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
  {
    files: ["*.config.{js,ts}", "vite.config.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
  },
)
