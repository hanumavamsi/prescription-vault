# Data API on Cloudflare (POC)

The app's data and files, moved from Supabase Postgres + Storage to a Cloudflare Worker with
**D1** (SQLite) and **R2** (files). Sign-in stays on **Supabase Auth**: the app sends its Supabase
access token, and the Worker verifies it (JWKS, or the HS256 secret on legacy/local projects).

```
app (src/lib/api.ts) ──Bearer <supabase token>──▶ Worker (src/index.ts) ──▶ D1  profiles, documents, pages, grants, invites
                                                                       └──▶ R2  page images / PDFs
img/pdf viewer ──signed /files/<path>?exp&sig────▶ Worker ──▶ R2
```

- `migrations/0001_init.sql`: SQLite port of `supabase/migrations/`.
- `src/index.ts`: every RLS policy and RPC from the Supabase schema, as code. There is no RLS in
  D1, so this file is the only access check.
- `scripts/import-from-supabase.mjs`: one-time copy of existing rows + files (checked by `test/import.mjs`).
- `test/smoke.mjs`: 42 checks of those rules (strangers, viewers, claims, revokes, account delete)
  against local D1 + R2. Runs in CI.

## Run locally

```bash
cd cloudflare
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev          # http://127.0.0.1:8787
npm test             # in another terminal
```

To point the app at it: `EXPO_PUBLIC_API_URL=http://127.0.0.1:8787` in the root `.env`. Local
tokens must then come from a project whose JWT secret is in `.dev.vars` (e.g. `supabase start`).

## Deploy (one time)

```bash
cd cloudflare
npx wrangler login
npx wrangler d1 create rx-vault                 # copy database_id into wrangler.jsonc
npx wrangler r2 bucket create rx-vault-files
# set SUPABASE_URL in wrangler.jsonc to the real project URL
npx wrangler secret put FILE_SIGNING_SECRET     # any long random string
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npm run db:migrate
npm run deploy                                  # prints https://rx-vault-api.<you>.workers.dev
```

Then copy the existing data and files over (safe to re-run; `--dry-run` writes them to
`import-out/` without uploading):

```bash
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... npm run import
```

Last, set the repo Actions variable `EXPO_PUBLIC_API_URL` to the Worker URL (the web deploy requires
it) and merge. Run the import once more right before merging to pick up anything added in between.

## Not done in this POC

- Deploying the Worker from CI (it is `npm run deploy` by hand).
- Rate limiting.
