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
- AI Pipeline: rembg (background removal) → TRELLIS via Replicate (image → .glb 3D model) → Three.js (client-side .glb → isometric sprites)
- Hosting: Vercel (frontend) + Supabase Cloud (backend)
- Icons: Lucide React (included with shadcn/ui)

## Current Phase
Phase 5: Templates + Cost Summary
<!-- Phase 1: Foundation — COMPLETE (schema + storage buckets in supabase/migrations/20240101000000_full_schema.sql) -->
<!-- Phase 2: Room Builder — COMPLETE -->
<!-- Phase 4: Isometric Canvas — COMPLETE (furniture placement, drag, rotate, variant switch, room rotation, right panel properties) -->
<!-- Phase 3: Furniture Catalog + AI Pipeline — COMPLETE (seed migration, useCatalogStore, CatalogPanel, AddFurnitureModal, ImageApprovalModal, 4 edge functions) -->
<!-- Update this line as you progress through phases. See docs/implementation-plan.md for phase details. -->

## Phase 2 Completion Notes
All Phase 2 verification steps pass. Key implementation details for future reference:

### Schema additions (beyond original plan)
- `rooms.ceiling_height_cm integer NOT NULL DEFAULT 260` — added via migration, controls isometric wall height

### IsometricCanvas (src/components/editor/IsometricCanvas.tsx)
- PixiJS 8 async init with race condition fix: room/materials stored in refs so init callback can draw immediately
- Always mounted by parent (EditorPage) only when selectedRoom is non-null — never mounts with null room
- 2:1 isometric projection: Width axis (+T, -T/2) per metre, Depth axis (-T, -T/2) per metre, T=64px/m
- Wall height: `Math.round((ceiling_height_cm / 100) * T * 0.6)` — fully dynamic from room data
- Renders: left wall (darker), right wall (lighter), floor, doors/windows from geometry, lighting fixture (glow + dot at ceiling center)
- Door/window placement: click-to-place on walls. Stored in `room.geometry.doors[]` / `room.geometry.windows[]` with `PhysicalWall` ('north'|'east'|'south'|'west') and position (0-1). `WALL_SCREEN_MAP` handles rotation mapping between 4 physical walls and 2 visible screen walls.

### finish_materials table
- All 32 preset materials have hex colors in thumbnail_path (wall: already hex; floor/door/window/lighting: updated from preset:xxx keys)
- Canvas reads finish color via getFinishColor() for all 5 types

### UIStore sidebar tabs
- SidebarTab type: 'rooms' | 'finishes' | 'catalog' | 'templates'

## Phase 3 Completion Notes
Full AI pipeline verified end-to-end. Key implementation details:

### Supabase Client Concurrency
The Supabase JS client hangs when multiple operations run concurrently through the same instance (DB queries, auth calls, function invocations). Workarounds used throughout Phase 3:
- **`invokeEdgeFunction` helper** (`useCatalogStore.ts`): Uses raw `fetch` + localStorage auth token instead of `supabase.functions.invoke`. Also returns parsed response `data` (used to get `glb_path` from `generate-3d-model`).
- **Local Zustand `set()` instead of DB writes** for status updates where the DB already has the correct state (e.g. `triggerBackgroundRemoval`, `approveImage`, `rejectImage`).
- **Sequential flow in `handleSaveVariants`** (`AddFurnitureModal.tsx`): Create variants → load variants → close modal → THEN trigger background removal. No concurrent Supabase operations.
- **`navigator.locks` bypass** in `src/lib/supabase.ts`: `lock` option set to immediately execute the callback.
- **Never reload variants from DB when edge function response contains needed data** (e.g. `glb_path` comes from `generate-3d-model` response, not from re-querying DB).

### Client-Side Sprite Rendering
- `src/lib/renderSprites.ts` — Downloads .glb from `glb-models` bucket, renders 4 isometric angles (512x512, OrthographicCamera, 35.264° elevation) on offscreen canvas using Three.js, uploads PNGs to `sprites` bucket, upserts `furniture_sprites` rows.
- Replaces the deprecated `render-sprites` Edge Function (which failed because `npm:canvas` needs native binaries unavailable in Deno).
- Triggered from `approveImage` in `useCatalogStore.ts` after `generate-3d-model` returns.

### Edge Functions
- `scrape-product` — Shopee API + IKEA HTML + generic JSON-LD fallback
- `remove-background` — Replicate `cjwbw/rembg`, polls for completion, uploads to `clean-images` bucket
- `generate-3d-model` — Replicate TRELLIS (`firtoz/trellis`), polls for completion, uploads .glb to `glb-models` bucket. Returns `{ success: true, glb_path }` in response.
- `render-sprites` — DEPRECATED (kept for reference). Use client-side `src/lib/renderSprites.ts` instead.

### RLS Policies Added (migration: `20240103000000_client_sprite_upload_policies.sql`)
- Storage: authenticated users can INSERT/UPDATE in `sprites` bucket
- Table: designers can INSERT/UPDATE `furniture_sprites` for variants belonging to their own items

### CatalogPanel Polling
`CatalogPanel.tsx` has a 5-second polling interval that reloads variants for items with `image_status === 'processing'` or `render_status === 'processing'`. This can conflict with concurrent Supabase operations — avoid calling `loadVariantsForItem` from async callbacks that may overlap with polling.

## Phase 4 Completion Notes
Full isometric canvas with furniture placement, drag, rotation, and variant switching.

### Canvas Store (`src/stores/useCanvasStore.ts`)
- Full CRUD for `placed_furniture` table: load, place, move, rotate, remove, variant switch
- Optimistic local updates with background DB writes for move/rotate/switchVariant
- `placeItem` reads price from Catalog Store for `price_at_placement`
- `savePlacedFurniture()` batch-updates all positions/directions sequentially (avoids concurrency)

### IsometricCanvas (`src/components/editor/IsometricCanvas.tsx`)
- Two PixiJS Container layers: `roomLayer` (walls/floor/fixtures) + `furnitureLayer` (sprites)
- Furniture sprites loaded via `Assets.load()` with texture caching (`textureCache` Map)
- Sprite sizing: `scale = (maxDimCm / 100) * T / 512` where 512 is sprite render size
- Sprite anchor: `(0.5, 0.85)` — bottom-center so furniture sits on floor
- Depth sorting: items sorted by `(u + v)` in rotated space (back-to-front)
- Selection: teal ellipse drawn under selected item, pointerdown on sprite selects + starts drag
- Drag: pointermove updates room coords via `screenToRoomRotated`, clamped to room bounds
- Placement mode: ghost sprite at 50% alpha follows cursor, click places item
- Keyboard: Escape cancels placement, Delete/Backspace removes selected item
- ResizeObserver for canvas resize
- Store subscription triggers full redraw on any canvas state change

### Room Rotation
- `transformForRotation(u, v, W, D, rotation)` maps room coords to default projection space
- `screenToRoomRotated()` inverts screen coords back to room coords accounting for rotation
- `apparentDirection()` combines item direction + room rotation for correct sprite selection
- Room shell redraws with swapped W/D for 90°/270° rotations
- `RotationControls.tsx` — floating frosted-glass bar with NW/NE/SE/SW buttons

### RightPanel (`src/components/editor/RightPanel.tsx`)
- Context switching: selected furniture → `FurnitureProperties` | selected room → `RoomProperties` | nothing → empty state
- `FurnitureProperties`: item name, category, variant swatches (32px with images), price, dimensions, direction, source link, rotate + remove buttons
- Variant swatches call `canvasStore.switchVariant()` for instant color switching

### CatalogPanel Changes
- "Place on Canvas" button in expanded item section (prefers variant with completed sprites)
- Triggers `canvasStore.setPlacementMode(true, itemId, variantId)`

### EditorPage Wiring
- Loads placed furniture on `selectedRoomId` change, preloads variants + sprites
- `handleSave` also calls `canvasStore.savePlacedFurniture()`
- Placement mode badge in header ("Click on canvas to place — Esc to cancel")
- Canvas cursor: `crosshair` in placement mode, `grabbing` when dragging

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
7. **Three.js sprite rendering runs client-side.** After TRELLIS generates a .glb, the browser renders 4 isometric sprites using Three.js (src/lib/renderSprites.ts) and uploads them to Supabase Storage. PixiJS handles all canvas rendering. Three.js is used server-side only for room perspective previews.

## API Keys Required
- **Supabase:** Project URL + anon key + service role key (from Supabase dashboard)
- **Replicate:** API token (from replicate.com — for TRELLIS model)

## Database
- All tables defined in docs/schema.md
- Row-Level Security (RLS) on all tables
- Designers see own drafts + approved items; admins see everything
