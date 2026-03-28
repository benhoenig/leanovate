# LEANOVATE

Internal isometric room planner for an interior design team serving condo investors in Thailand. Designers use this tool to place real purchasable furniture into isometric room layouts, generate cost summaries, and present proposals to clients.

## Reference Docs (read before making changes)
- @docs/product-spec.md — Features, user stories, MVP scope, roles
- @docs/tech-stack.md — Technology choices, folder structure, AI pipeline, cost estimates
- @docs/schema.md — Database tables, fields, relationships, data flows
- @docs/design.md — Visual system (colors, typography, spacing, component styling)
- @docs/state-map.md — Zustand store domains and ownership rules
- @docs/integration-contracts.md — External API contracts (Supabase, Replicate, scraping, rembg, Three.js)
- @docs/implementation-plan.md — Build phases, dependencies, what to test

## Tech Stack
- Frontend: React 18+ / TypeScript 5+ / Vite 5+ / PixiJS 8+ / Zustand 4+ / shadcn/ui / Tailwind 3+
- Backend: Supabase (auth, PostgreSQL, storage, edge functions)
- AI Pipeline: rembg (background removal) → TRELLIS via Replicate (image → .glb 3D model) → Three.js (server-side .glb → isometric sprites)
- Hosting: Vercel (frontend) + Supabase Cloud (backend)
- Icons: Lucide React (included with shadcn/ui)

## Current Phase
Phase 1: Foundation
<!-- Update this line as you progress through phases. See docs/implementation-plan.md for phase details. -->

## Code Style
- TypeScript strict mode
- Functional components with hooks
- One Zustand store per file in src/stores/ (6 stores — see state-map.md)
- Supabase client in src/lib/supabase.ts
- Use Tailwind utility classes + CSS variables from design.md
- Use shadcn/ui components as the base UI library
- Use Lucide React for all icons

## Commands
- `npm run dev` — start dev server
- `npm run build` — production build
- `npm run lint` — ESLint + Prettier

## Key Rules
1. **Read the relevant doc before implementing any feature.** Each doc owns a specific domain — check the scope table at the top of each file.
2. **Never duplicate state across Zustand stores.** Catalog Store is the single source of truth for all product data. Other stores reference by ID only. See state-map.md.
3. **Cost summary is always computed live, never stored.** Derive from placed furniture variant prices (Catalog Store) + manual costs (Project Store).
4. **Furniture uses a parent + variants model.** Parent item holds shared details. Each color variant has its own image, price, link, .glb, and sprites. See schema.md.
5. **Image approval is a hard gate.** Designer must approve background-removed images before TRELLIS runs. See integration-contracts.md.
6. **Designer uploads images manually.** The scraper only extracts text data (name, description, dimensions). It does NOT download product images.
7. **Three.js runs server-side only.** PixiJS handles all browser-side canvas rendering. Three.js is used in Edge Functions for sprite rendering and room perspective previews.

## API Keys Required
- **Supabase:** Project URL + anon key + service role key (from Supabase dashboard)
- **Replicate:** API token (from replicate.com — for TRELLIS model)

## Database
- All tables defined in docs/schema.md
- Row-Level Security (RLS) on all tables
- Designers see own drafts + approved items; admins see everything
