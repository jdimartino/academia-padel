# Academia Pádel — AGENTS.md

Permanent instructions for any AI agent working in this folder.
Read this file completely before touching any code.

## What this project is

Multi-tenant SaaS for padel academies. Every academy is a **tenant** and pays a
monthly subscription. A tenant has venues, courts, coaches, classes, attendance,
billing and coach payroll.

## THE COST RULE (non-negotiable)

This project runs on the Firebase **Blaze** plan, but everything must stay
inside the free quota.

- Only the **default** Firestore database qualifies for the free quota.
  **Never create a named database.** `src/firebase/config.js` uses
  `getFirestore(app)` (default) and nothing else.
- Never enable anything that costs money without explicit instruction from the
  owner. That currently means: **no Cloud Functions, no Cloud Storage, no
  backups, no PITR, no TTL policies.**
- Do not add a `"functions"` key or a `functions/` folder, and do not add a
  `"storage"` key to `firebase.json`.
- Every Firestore query must be bounded — by tenant, by venue, by date range,
  with `limit()`/pagination. Unbounded reads burn the free read quota.
- If a feature seems to require a paid service, stop and ask first.

## THE UI RULE (non-negotiable)

Every screen, now and in the future, must be responsive for mobile and desktop.

- Write mobile-first CSS. Start from the small breakpoint and add
  `@media (min-width: ...)` rules. Never design desktop-only and then patch it.
- No fixed pixel widths on layout containers. Use `max-width`, flex/grid and
  fluid units.
- Touch targets should stay usable on a phone (roughly 44px minimum height).
- No UI libraries or CSS frameworks without asking first.

## Firestore access

- **All** Firestore access goes through `src/firebase/db.js`. It is the single
  data access layer. No page, component, hook or service may import
  `firebase/firestore` directly — add the function to `db.js` instead.
- All data is rooted at `academias/{tenantId}/...`. Every read and write must be
  scoped to a tenant. Never write a query that can cross tenant boundaries.
- Prefer one-time reads (`getDoc` / `getDocs`). Use realtime listeners
  (`onSnapshot`) only when a screen genuinely needs live data, and always with
  the same bounds.
- Composite indexes go in `firestore.indexes.json` before the query ships.

## Dependencies

- Do not add a new dependency without asking. The approved set today is:
  `react`, `react-dom`, `react-router-dom`, `firebase`, plus the Vite toolchain
  in `devDependencies`.
- Plain JavaScript only. This project is **not** TypeScript. Do not add
  TypeScript, `.ts`/`.tsx` files, or a `tsconfig.json`.

## Firebase project

- Project ID: `academia-padel-jdm` (permanent)
- Firestore location: `us-east1` (permanent)
- Hosting site: `academia-padel-jdm`
- `.firebaserc` pins this project. Do not point it at another project.
- Deploys go through the workspace tooling (`jdm`), never a bare
  `firebase deploy` from this folder.

## Secrets

- Never commit `.env.local`. It is gitignored. Only `.env.example` (empty
  values) is committed.
- Never commit `serviceAccount*.json` or `credentials*.json`, and never print
  the contents of `.env.local` into a report, a commit message or a log.

## Repo hygiene

- Do not commit `node_modules`, `dist` or `.firebase/`.
- Do not use `--force` flags, and do not bypass
  `/Users/jdimartino/Desktop/Antigravity/jdm/scripts/firebase-guard.sh`.
- Run `npm run build` (and `npm run lint`) before proposing a commit.
