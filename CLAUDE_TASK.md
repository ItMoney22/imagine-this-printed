# Claude Task Brief

## Request
- Watchtower task `2d1f871a-a2bb-4362-8365-dcf9b1e446a4`: strip backend-only dependencies from the root Vite/Vercel package, remove the obsolete static Express server, refresh the lockfile/install, and prove the frontend still builds.

## Repo detection
- Root is a React 19 + TypeScript + Vite client deployed by Vercel; `vercel.json` serves `dist/` and routes supported bot metadata through `api/`.
- `backend/` is an independent Express/TypeScript package with its own manifest and lockfile.
- `server-static.mjs` is a legacy Railway/VPS static server reached only by the root `start` script; Vercel does not run it.

## Relevant files
- `package.json`
- `package-lock.json`
- `backend/package.json` (comparison only)
- `server-static.mjs`
- `vercel.json` (deployment confirmation only)
- `src/utils/storage.ts` (confirms the root AWS SDK packages are client imports)
- `scripts/verify/browser-utils.js` (confirms root Puppeteer is used by verification tooling)

## Files to edit (STRICT)
- `package.json`
- `package-lock.json` (regenerate with npm; do not hand-edit)
- `server-static.mjs` (delete)
- `TASK_NOTES.md` (append concise milestone/result bullets only)
- Do not edit `backend/package.json`, `backend/package-lock.json`, application source, Vercel config, or documentation.

## Plan
1. In root `package.json`, remove the `start` script.
2. Remove confirmed backend-only root dependencies: `@prisma/client`, `bcryptjs`, `compression`, `dotenv`, `express`, `pg`, and `prisma`; remove root dev dependencies `@types/bcryptjs` and `@types/pg`.
3. Confirm the already-absent direct packages stay absent: `jsonwebtoken`, `cookie-parser`, `cors`, `openai`, server-side `stripe`, their server type packages, and `@types/puppeteer`.
4. Keep `@stripe/react-stripe-js` and `@stripe/stripe-js` because the client imports them. Keep both AWS SDK packages because `src/utils/storage.ts` imports them. Keep `puppeteer` because root verification tooling imports it and it supplies its own types.
5. Align the remaining shared runtime dependency `@supabase/supabase-js` in the root to the backend's compatible `^2.87.1`; `axios` is already aligned. Do not force unrelated toolchain versions across the two independent packages.
6. Delete `server-static.mjs`.
7. Run the root install to regenerate `package-lock.json`, then build. Review the manifest and lockfile diff to ensure only intended root dependency/script changes occurred.

## Acceptance criteria
- [ ] Root `package.json` has no `start` script.
- [ ] Root `package.json` has no direct `express`, `pg`, `bcryptjs`, `jsonwebtoken`, `cookie-parser`, `cors`, `compression`, `prisma`, `@prisma/client`, `openai`, server-side `stripe`, or corresponding server `@types` dependencies.
- [ ] Root `package.json` has no `@types/puppeteer`; `puppeteer` remains available for verification scripts.
- [ ] Browser Stripe packages and browser-imported AWS SDK packages remain.
- [ ] Root and backend use compatible `@supabase/supabase-js` versions; other legitimately shared runtime packages are either aligned or explicitly justified.
- [ ] `server-static.mjs` is deleted.
- [ ] `package-lock.json` reflects the cleaned root manifest and was produced by npm.
- [ ] `npm run build` completes successfully without new errors.
- [ ] No out-of-scope files are modified.

## Commands
```powershell
npm install --include=dev
npm run build
git diff --check
git status --short
```

Note: this machine may export `NODE_ENV=production`; `--include=dev` ensures TypeScript and Vite are present for the required build while still performing the requested root install.
