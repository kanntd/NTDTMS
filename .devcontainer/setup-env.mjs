import { existsSync, writeFileSync } from "node:fs";

if (existsSync(".env.local")) {
  process.exit(0);
}

const url = process.env.VITE_SUPABASE_URL;
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  console.log(
    "Supabase Codespaces secrets are not set. Demo mode is still available at /?demo=1.",
  );
  process.exit(0);
}

writeFileSync(
  ".env.local",
  `VITE_SUPABASE_URL=${url}\nVITE_SUPABASE_PUBLISHABLE_KEY=${publishableKey}\n`,
  { mode: 0o600 },
);

console.log("Created .env.local from Codespaces secrets.");
