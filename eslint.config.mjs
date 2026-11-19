import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", ".cache/**", "solana/target/**", "out/**", "build/**", "next-env.d.ts", "convex/_generated/**", "contracts/**", "brand/**", "scripts/**", "shots/**"]),
]);
