# Contributing

## Workflow

1. Branch from `master` (`feat/...`, `fix/...`). Direct pushes to `master` are blocked.
2. Open a pull request. CI runs typecheck, lint, Jest, database tests (pgTAP), API tests and Playwright browser tests, and deploys a preview.
3. A merge to `master` applies database migrations and deploys production.

## Local setup

```bash
npm install
npx supabase start          # local Postgres, Auth, Storage and a mail catcher (needs Docker)
npx expo start --web        # uses .env, which points at the local stack
```

Before opening a PR:

```bash
npx tsc --noEmit
npx expo lint
npm test
npm run e2e                 # browser tests against the local stack
```

## Database migrations

- **Additive only.** Users keep an old web build open for a while, so a migration must not break the previous version of the app: add columns and tables, don't rename or drop them in the same release.
- **Name it after the newest migration on `master`.** Production refuses a migration dated earlier than the last one it applied. Create it with `npx supabase migration new <name>` on an up-to-date branch, and rename it if `master` gets a newer one before you merge.
- Every table has row-level security. New tables need policies and a pgTAP test in `supabase/tests/`.
