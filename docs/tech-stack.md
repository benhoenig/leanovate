# Tech Stack — LEANOVATE

> **Document scope:** All technology choices, libraries, versions, and rationale.
>
> **Out of scope (covered in other docs):**
>
> | File | Owns |
> |---|---|
> | `product-spec.md` | App name, problem statement, target users, MVP vs post-MVP features, user stories, success metrics |
> | `design.md` | Visual system — colors, typography, component styling |
> | `schema.md` | Supabase table structures, fields, and relationships |
> | `state-map.md` | Zustand store breakdown and state ownership |
> | `implementation-plan.md` | Build order, phases, and timeline |
> | `integration-contracts.md` | Shopee Affiliate API, Supabase auth, external service shapes |

---

## Stack Overview

LEANOVATE is an internal design tool for a team of 3–10 designers. The stack is optimized for:

- **Fast MVP delivery** — minimal infrastructure, managed services over self-hosted
- **Canva-level UX** — GPU-accelerated canvas rendering with responsive UI
- **Low operational cost** — free tiers and pay-per-use services suitable for small team scale
- **Future scalability** — every choice has a clear upgrade path when volume grows

---

## Frontend

### React + TypeScript

- **What:** UI framework + type system
- **Version:** React 18+, TypeScript 5+
- **Why React:** Industry standard, massive ecosystem, easy to hire for later. Component-based architecture maps cleanly to the app's UI panels (canvas, catalog sidebar, properties panel, cost summary).
- **Why TypeScript:** Catches type errors at development time instead of in production. Critical for a canvas app where state objects (furniture items, room layouts, templates) are complex and deeply nested.

### Vite

- **What:** Build tool and development server
- **Version:** Vite 5+
- **Why:** Fastest development experience for React. Hot module replacement (changes appear instantly in browser during development). Modern default — no reason to use anything else for a new React project in 2025.
- **Not using:** Create React App (deprecated), Next.js (server-side rendering adds complexity we don't need for an internal tool).

### PixiJS

- **What:** GPU-accelerated 2D rendering engine for the isometric canvas
- **Version:** PixiJS 8+
- **Why:** Purpose-built for sprite-based 2D rendering. Handles hundreds of furniture sprites on screen with smooth performance. Supports:
  - Sprite rendering (furniture images at isometric angles)
  - Click and drag interactions (placing and repositioning furniture)
  - Layer management (floor, walls, furniture, UI overlays)
  - Camera rotation (4-corner room view rotation)
- **Why not full 3D (Three.js for live rendering):** Full 3D adds massive complexity (lighting, camera controls, model loading) for marginal visual improvement in an isometric view. PixiJS achieves the visual quality needed for client presentations without the engineering overhead.
- **Note:** Three.js is used client-side for sprite rendering (offscreen canvas, not visible in the UI) and server-side for room perspective previews. PixiJS handles all visible canvas rendering.

### Zustand

- **What:** State management library
- **Version:** Zustand 4+
- **Why:** Lightweight, minimal boilerplate, works naturally with React. The app has multiple state domains (canvas state, catalog state, project state, UI state) — Zustand's store-slicing pattern keeps these cleanly separated without the ceremony of Redux.
- **Not using:** Redux (too much boilerplate for team size), Jotai/Recoil (atomic state is harder to reason about for canvas apps with interconnected state).

### Tailwind CSS + shadcn/ui

- **What:** Utility-first CSS framework + pre-built UI component library
- **Version:** Tailwind 3+, shadcn/ui latest
- **Why Tailwind:** Rapid styling without writing custom CSS files. Consistent spacing, colors, and responsive breakpoints out of the box.
- **Why shadcn/ui:** High-quality, accessible UI components (buttons, dialogs, dropdowns, tables, forms) that are copy-pasted into the codebase (not installed as a dependency). Full control over styling — no "fighting the library" to match the design system.
- **Not using:** Material UI (opinionated design that's hard to customize), Ant Design (heavy bundle size, enterprise-oriented aesthetics).

### React Router

- **What:** Client-side page routing
- **Version:** React Router 6+
- **Why:** Standard routing for React single-page apps. Handles navigation between views (dashboard, project editor, catalog manager, admin panel) without full page reloads.

---

## Backend

### Supabase (Database + Auth + Storage + Real-time)

- **What:** Backend-as-a-service built on PostgreSQL
- **Why one platform:** Eliminates the need to wire together separate auth, database, storage, and API services. For a small team building fast, this reduces infrastructure decisions from dozens to one.

#### Supabase Auth

- **What:** User authentication and role management
- **Why:** Built-in email/password auth, magic links, and row-level security (RLS) policies. RLS lets us enforce role-based access (admin vs designer) at the database level — even if frontend code has a bug, the database won't return unauthorized data.

#### Supabase Database (PostgreSQL)

- **What:** Relational database for all app data
- **Why PostgreSQL:** Robust relational model for interconnected data (projects → rooms → placed furniture → catalog items → templates). JSON column support for flexible schema where needed (e.g. room layout configuration, furniture position coordinates).

#### Supabase Storage

- **What:** File storage for images and assets
- **Use cases:**
  - AI-rendered isometric sprites (4 angles per product)
  - TRELLIS-generated .glb 3D model files (reusable for future re-renders or full 3D view)
  - Designer-uploaded original product photos (before background removal)
  - Designer-uploaded custom textures
  - Project thumbnails
- **Why:** Built-in CDN for fast global image loading. Integrates directly with Supabase Auth for access control (e.g. personal draft sprites only visible to the uploading designer until admin-approved).

#### Supabase Realtime (Post-MVP consideration)

- **What:** WebSocket-based real-time data sync
- **Why deferred:** Not needed for MVP (single designer per project). Useful later if multi-user collaboration is added.

### Supabase Edge Functions

- **What:** Serverless functions running on Deno (JavaScript/TypeScript runtime)
- **Use cases:**
  - Product link validation and scraping (when designer submits an external furniture link)
  - Triggering AI sprite generation via Replicate API
  - Admin operations (bulk catalog actions, template promotion)
  - Daily furniture link validity recheck (see below)
  - Scheduled price refresh for catalog items
- **Why Edge Functions over a separate server:** Same ecosystem as the rest of the backend. No additional infrastructure to deploy, monitor, or pay for. Auto-scales with usage.
- **Limitation:** Cannot run GPU-heavy workloads — those are offloaded to Replicate (see AI pipeline).

#### Daily Furniture Link Validity Recheck (Scheduled Job)

- **What:** A scheduled Edge Function that runs daily (e.g. 3:00 AM Bangkok time) to verify that all product source links in the shared catalog are still active
- **Why:** Shopee listings frequently go inactive — sellers delist products, listings expire, or items go permanently out of stock. A sofa in a client proposal shouldn't link to a dead page.
- **How it works:**
  1. Each day, the job picks a batch of catalog items to check (round-robin, so every item gets rechecked every few days depending on catalog size)
  2. For each item, it sends a lightweight HTTP request to the source URL to check if the page is still live and the product is still available
  3. Results update the furniture item record:
     - **Still active:** Update `last_checked_at` timestamp and refresh price if changed
     - **Inactive / delisted:** Flag the item with a `link_status: inactive` status. Item remains in the catalog but is visually flagged for designers so they know the product may no longer be purchasable
     - **Price changed:** Update `price_thb` and optionally flag if the change exceeds a threshold (e.g. >20% increase) so designers are aware
  4. Admin receives a summary notification (or dashboard view) of newly flagged items so they can find replacements
- **Batch size:** Configurable. Start with ~100 items per run to stay within Edge Function execution limits. For a 500-item catalog, every item gets rechecked every 5 days.
- **Cost:** Free (HTTP requests only, no GPU or AI involved)

---

## AI / Rendering Pipeline

### Overview

The pipeline has two stages: (1) scrape product data from a link, and (2) process designer-uploaded color variant images into isometric sprites. Separating data scraping from image handling makes the system more reliable — the scraper handles text data (which is consistent), while designers control which product images enter the pipeline.

```
STAGE 1 — Product Data (once per furniture item)
  Designer pastes product link
    → System scrapes product details (name, dimensions, description)
    → Designer reviews and can override/fill in additional details
    → Furniture item (parent) created as personal draft

STAGE 2 — Color Variants (once per color, per item)
  Designer uploads a cropped product image + color name
    → Optionally provides: separate price, product link, or size overrides
    → [rembg: remove background — 1-2 seconds]
    → Designer reviews clean image (hard gate)
        → Approve: proceeds to TRELLIS
        → Reject: designer uploads a better photo and retries
    → [TRELLIS via Replicate: generate .glb 3D model — ~1 minute]
    → [Three.js: render 4 isometric angles from .glb]
    → Store sprites + .glb in Supabase Storage
    → Replace placeholder in UI

RESULT: One furniture item with multiple color variants,
        each with its own 4 isometric sprites, price, and optional link.
        Designer switches colors on canvas via swatches.
```

**Note:** The approval gate only blocks AI sprite generation. The designer can use the item on the canvas immediately with the original product photo as a placeholder while sprites generate for each variant.

### rembg (Background Removal)

- **What:** Open-source AI model for removing image backgrounds
- **Runs on:** Supabase Edge Function (CPU only, no GPU needed)
- **Speed:** 1–2 seconds per image
- **Cost:** Free (open source, CPU-only)
- **Why:** Every product photo from Shopee/IKEA has a background that needs to be removed before angle generation. This is a fast preprocessing step.

### Replicate API — TRELLIS Model (Image → 3D Model)

- **What:** Cloud API running TRELLIS (`firtoz/trellis` on Replicate) — Microsoft's open-source AI model that generates a complete 3D model (.glb file) from a single product photo
- **Runs on:** Replicate's infrastructure (called from Supabase Edge Function)
- **Speed:** Under 1 minute per product (single API call generates the full 3D model)
- **Cost:** ~$0.05 per product ($0.049 per run, 1 run per product)
- **Output:** A .glb 3D file with textures — can be rendered from any angle using Three.js
- **License:** MIT (free for commercial use)
- **Why TRELLIS over alternatives (Zero123++, TripoSR):**
  - **6x cheaper** — one API call produces a full 3D model vs 4+ calls for multi-view image generators
  - **Higher quality** — generates actual 3D geometry, not flat angle guesses
  - **Future-proof** — stored .glb file can be re-rendered for additional angles, animations, or full 3D view without re-running AI
  - **Furniture is its sweet spot** — hard-surface objects (tables, sofas, shelves) produce the best results
- **Why Replicate for MVP:**
  - Pay-per-use — no idle GPU costs
  - No infrastructure to manage
  - At MVP volume (200–500 products initially, 20–50 new per month), total cost is negligible (<$15/month)
- **Migration path:**
  - 2,000+ new products/month → migrate to **Modal** (serverless GPU, ~50% cheaper)
  - 5,000+ new products/month → consider **own GPU server** (AWS/GCP, ~$800/month fixed)
- **Quality limitations:** Transparent/glass objects and highly reflective surfaces (chrome, mirrors) may produce artifacts. For ~90% of typical furniture (sofas, beds, tables, shelves, lamps), quality is production-ready. Strategy: auto-approve all renders, fix bad ones reactively.

### Three.js (3D → Isometric Sprite Rendering + Room Preview)

- **What:** 3D rendering library used to render .glb 3D model files into images
- **Runs on:** Client-side (browser) for sprite rendering, server-side for room perspective previews
- **Three use cases:**
  1. **TRELLIS output rendering (client-side):** Takes the .glb file generated by TRELLIS and renders 4 isometric angle sprites from it in the browser using an offscreen canvas. This runs automatically after TRELLIS completes. Implementation: `src/lib/renderSprites.ts`.
  2. **IKEA catalog rendering:** IKEA provides actual 3D model files (.glb format) extractable from their AR app. These can be rendered perfectly from any angle — no AI guessing needed. Higher quality than AI-generated models.
  3. **Room perspective preview (eye-level interior vignette):** Loads all placed furniture .glb files into a 3D room shell (built from room geometry + finishes), renders a single realistic perspective image from human eye level. Used for client presentations to show mood and atmosphere.
- **Workflow (sprites):** .glb file (from TRELLIS or IKEA) → browser downloads .glb → Three.js renders 4 isometric angles on offscreen canvas → uploads sprite PNGs to Supabase Storage → upserts furniture_sprites rows
- **Workflow (room preview):** Room geometry + finishes + all placed .glb files → Three.js renders one eye-level interior vignette → display in modal + save to Supabase Storage (`rooms.preview_image_url`)
- **Why client-side for sprites:** Server-side rendering via Supabase Edge Functions (Deno) failed because headless canvas libraries (npm:canvas) require native binaries unavailable in Edge Functions. Browser WebGL rendering works reliably and has zero infrastructure cost.
- **Cost:** Free (open source, uses browser's GPU)

---

## Hosting & Deployment

### Vercel (Frontend Hosting)

- **What:** Cloud platform for hosting web applications
- **Why:** Best-in-class for React + Vite apps. Automatic deployments from GitHub (push code → live in ~60 seconds). Free tier comfortably supports a small internal team. Built-in:
  - SSL/HTTPS
  - Global CDN (fast loading from Thailand)
  - Preview deployments for testing changes before going live
  - Mobile-responsive serving

### Supabase Cloud (Backend Hosting)

- **What:** Managed Supabase instance
- **Why:** Included with Supabase. Free tier includes 500MB database, 1GB storage, 50,000 auth users — more than enough for MVP. Paid plan ($25/month) when you need more storage or bandwidth.

### Domain

- **What:** Custom domain for the app (e.g. app.leanovate.com)
- **Setup:** Purchase domain → point to Vercel → automatic SSL

---

## Developer Tools

### GitHub

- **What:** Code repository and version control
- **Why:** Industry standard. Integrates directly with Vercel for automatic deployments. Free for private repositories.

### ESLint + Prettier

- **What:** Code linting (catches common mistakes) + code formatting (consistent style)
- **Why:** Ensures code quality stays high as the team grows. Auto-formats on save so developers never argue about code style.

---

## Folder Structure

```
src/
  components/    → Reusable UI components (buttons, cards, panels, etc.)
  pages/         → Route-level page components (one per screen)
  stores/        → Zustand stores (one file per store from state-map.md)
  lib/           → Utilities, helpers, Supabase client, API functions
  hooks/         → Custom React hooks
  types/         → TypeScript type definitions
  assets/        → Static images, fonts
```

**Rules:**
- One Zustand store per file, named to match `state-map.md` (e.g. `useCanvasStore.ts`)
- Components used by only one page live inside that page's folder, not in shared `components/`
- Supabase client setup lives in `lib/supabase.ts`

---

## Deployment Target

- **MVP:** Web app (responsive — works on desktop, tablet, and mobile browsers)
- **Primary use:** Desktop browser (designers working on projects)
- **Secondary use:** Tablet/mobile browser (presenting to clients during meetings)
- **Post-MVP consideration:** Progressive Web App (PWA) for offline access or native-like mobile experience if needed. No native mobile app planned.

---

## Technology NOT Used (and Why)

| Technology | Why not |
|---|---|
| **Next.js** | Server-side rendering adds complexity with no benefit for an internal tool. Vite + React is simpler and faster to develop. |
| **Redux** | Too much boilerplate for a small team. Zustand achieves the same result with 80% less code. |
| **Three.js (in live app for canvas)** | Full 3D rendering in the browser is overkill for the isometric canvas UI. PixiJS handles 2D sprites more efficiently. Three.js is used client-side only for offscreen sprite rendering (not visible in UI) and server-side for room perspective previews. |
| **Zero123++ / TripoSR** | Multi-view image generators that produce flat 2D angle images. TRELLIS is 6x cheaper (1 API call vs 4), produces a reusable 3D model, and delivers higher quality for furniture. |
| **Firebase** | Supabase provides the same features with PostgreSQL (relational) instead of Firestore (document). Relational data model is a better fit for interconnected design/catalog data. |
| **AWS / GCP (direct)** | Managed services (Supabase, Vercel, Replicate) eliminate infrastructure management. Direct cloud provider only needed later for dedicated GPU servers at scale. |
| **React Native** | Building a native mobile app doubles the codebase and maintenance. Responsive web covers mobile use cases for MVP. |
| **Electron** | Desktop app wrapper adds distribution complexity with no benefit over a web app for this use case. |

---

## Cost Estimate (MVP — Monthly)

| Service | Tier | Monthly Cost |
|---|---|---|
| Vercel | Free (Hobby) | $0 |
| Supabase | Free → Pro ($25) | $0–$25 |
| Replicate (TRELLIS) | Pay-per-use (~$0.05/color variant) | ~$3–$45 (depends on new products × variants) |
| GitHub | Free (private repos) | $0 |
| Domain | Annual (~$12/year) | ~$1 |
| **Total** | | **~$4–$71/month** |

*Note: Costs scale with color variants, not just products. A sofa with 3 colors = 3 TRELLIS runs = ~$0.15. If you add 100 products averaging 3 colors each = 300 variants = ~$15. Existing .glb models and sprites are stored for free in Supabase Storage — you only pay for new renders.*
