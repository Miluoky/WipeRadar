import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

const config = [
  { ignores: ["**/node_modules/**", "**/.next/**", "**/next-env.d.ts", "services/**", "**/data/**"] },
  // Next + React rules only where React lives
  ...[...nextVitals, ...nextTs].map((c) => ({ ...c, files: c.files ?? ["apps/web/**/*.{ts,tsx,js,mjs}"] })),
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    settings: { next: { rootDir: "apps/web" } },
    rules: {
      // React Compiler rules. Date.now() in server components renders once per request, and the two
      // client effects that set state on mount are intentional; keep them visible, don't fail CI.
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // plain TypeScript rules for the worker, packages and scripts
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ["apps/worker/**/*.ts", "packages/**/*.ts", "scripts/**/*.mjs"] })),
];

export default config;
