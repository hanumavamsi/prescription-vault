## What and why

## Checks
- [ ] `npx tsc --noEmit` and `npx expo lint` pass
- [ ] `npm test` passes (and `npm run e2e` if the change touches sign-in, adding or sharing records)
- [ ] Migration? It is additive (old web builds keep working) and its timestamp is later than every migration on `master`
- [ ] Screenshots for UI changes (phone width)
