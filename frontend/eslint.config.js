import js from "@eslint/js";
import globals from "globals";
import prettier from "eslint-config-prettier";

// Local plugin enforcing kebab-case filenames for frontend source modules.
// Keeps snake_case out of the frontend (it is reserved for the Python backend
// and BIDS data files). Single-word names (app.js, dom.js) and digits
// are allowed.
const filenamesPlugin = {
  rules: {
    "kebab-case": {
      meta: { type: "problem", schema: [] },
      create(context) {
        return {
          Program(node) {
            const filename = context.filename;
            if (!filename) return;
            const stem = filename.split("/").pop().replace(/\.js$/, "");
            if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(stem)) {
              context.report({
                node,
                message:
                  "Filename '{{name}}.js' must be kebab-case (lowercase letters, digits and hyphens only).",
                data: { name: stem },
              });
            }
          },
        };
      },
    },
  },
};

export default [
  { ignores: ["node_modules/**", "dist/**"] },
  js.configs.recommended,
  prettier,
  {
    files: ["src/**/*.js", "app.js"],
    plugins: { filenames: filenamesPlugin },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser },
    },
    rules: {
      "no-duplicate-imports": "error",
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "filenames/kebab-case": "error",
    },
  },
];
