# ARIT — Akaldeep Risk Intelligence Terminal

## Project Overview
Indian equity risk analytics terminal. React + TypeScript frontend, Node.js/Express backend.
Deployed on Railway, Yahoo Finance data fetched through Cloudflare Worker proxy.

## Key Architecture Rules
- ALL Yahoo Finance calls go through Cloudflare proxy (CF_WORKER constant in server/routes.ts)
- Never use yahoo-finance2 library directly — it's in package.json but unused
- Peer discovery is 100% Excel-based (Damodaran classification) — no Yahoo classification
- No database — uses in-memory MemStorage only
- server/db.ts, server/precompute.ts, server/replit_integrations/ are ALL dead code — do not use

## Key Files
- server/routes.ts — ALL backend logic (Yahoo calls, beta calc, peers, routes)
- client/src/pages/Home.tsx — Main UI
- client/src/components/ResultsSection.tsx — Results display
- client/src/components/WorldMap.tsx — Interactive map
- attached_assets/INDIAN_COMPANIES_LIST_INDUSTRY_WISE_1767863645829.xlsx — Damodaran Excel

## Commands
- `npm run dev` — Start dev server
- `npm run build` — Production build
- `node test-arit.js` — Basic health test (8 tickers)
- `node stress-test.js` — Full stress test (20 tickers, gives % score)

## Deployment
Railway auto-deploys from GitHub master branch.
Cloudflare Worker: https://gentle-mud-b38b.sethi-adisingh11.workers.dev
