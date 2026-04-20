# LEANOVATE

Internal isometric room planner for an interior design team serving condo investors in Thailand. Designers use this tool to place real purchasable furniture into isometric room layouts, generate cost summaries, and present proposals to clients.

## Reference Docs (read before making changes)
- @docs/product-spec.md — Features, user stories, MVP scope, roles
- @docs/tech-stack.md — Technology choices, folder structure, AI pipeline, cost estimates
- @docs/schema.md — Database tables, fields, relationships, data flows
- @docs/design.md — Visual system (colors, typography, spacing, component styling)
- @docs/state-map.md — Zustand store domains and ownership rules
- @docs/integration-contracts.md — External API contracts (Supabase, Replicate, screenshot extraction, Three.js)
- @docs/implementation-plan.md — Build phases, dependencies, what to test
- @docs/designer-workflow.md — External photo preprocessing (Nano Banana) before upload (Phase 7+)

## Tech Stack
- Frontend: React 18+ / TypeScript 5+ / Vite 5+ / Three.js / Zustand 4+ / shadcn/ui / Tailwind 3+
- Backend: Supabase (auth, PostgreSQL, storage, edge functions)
- AI Pipeline: TRELLIS via Replicate (multi-image → .glb 3D model, does its own background removal). .glb files are rendered directly in the Three.js canvas (no sprite generation). Flat items (rugs, etc.) bypass TRELLIS entirely and render as textured floor planes.
- Hosting: Vercel (frontend) + Supabase Cloud (backend)
- Icons: Lucide React (included with shadcn/ui)

## Current Phase
V1 COMPLETE (Phases 1–6) + Phase 7 COMPLETE + Phase 8 COMPLETE. All MVP functionality shipped against the new 3D canvas.

## Phase 8 Completion Notes
Sims-style 3D canvas rebuild. PixiJS retired; Three.js is now the primary renderer for both the live editor canvas and the room perspective preview.

### Schema changes (migration 20260420010000_phase8a_canvas_data_model.sql)
- **Dropped:** `furniture_sprites` table (direct `.glb` rendering replaces 4-angle sprites)
- **Dropped:** `direction` enum (no longer referenced by any column)
- **placed_furniture coordinate rework:**
  - `x → x_cm` (horizontal, room-local)
  - `y → z_cm` (depth; Three.js Y is up)
  - Added `y_cm float` (vertical offset — 0 for floor items, nonzero for wall-mounted art)
  - `direction` enum → `rotation_deg float` (continuous rotation)
- **New enum:** `block_size ('big' | 'small')`
- **Added:** `furniture_categories.default_block_size` (seeded Small for Chair/Lamp/Side Table/Coffee Table; Big for the rest)
- **Added:** `furniture_items.block_size_override` (nullable per-item override)
- **Clean slate:** truncated `projects` (CASCADE wipes rooms + placed_furniture) + all 3 template tables. Retained categories, styles, profiles, finish_materials, furniture_items, furniture_variants, `.glb` files.

### Block grid constants (`src/lib/blockGrid.ts`)
- `BIG_BLOCK_CM = 50` — main furniture (sofa, bed, dining table, wardrobe, desk, TV stand, shelf, rug)
- `SMALL_BLOCK_CM = 25` — accents (chair, lamp, side table, coffee table)
- Single source of truth — tune by editing this file.

### Canvas (`src/components/editor/RoomCanvas.tsx` — replaces `IsometricCanvas.tsx`)
- Three.js scene with persistent layers (shell, furniture, handles, world grid)
- **Design mode** (default): OrbitControls, mouse-drag rotates, wheel zooms, right-drag pans. Walls render BackSide (dollhouse) so the camera always sees in from outside.
- **Roam mode**: PointerLockControls + WASD (Shift sprint), 160cm eye height, camera clamped inside room polygon. Walls render solid when in roam.
- **Click-to-place** with ghost preview, grid snap (effective block size), Ctrl bypasses snap.
- **Drag-to-move** selected furniture; **scroll-wheel rotate** 15°/1° (Ctrl); Delete/Backspace removes.
- **Edit Shape** mode: teal sphere vertex handles + hollow ring midpoint handles + clickable wall push/pull. 10cm snap (Ctrl bypasses). Delete removes vertex (min 3).
- **World grid toggle** (bottom-left) — 1m majors + 50cm minors, persists to localStorage.
- **Camera presets** — RotationControls (NW/NE/SE/SW) move the orbit camera to room corners in design mode; hidden in roam.

### Furniture rendering (`src/lib/roomScene.ts`)
- `loadGlb(path)` — downloads + parses .glb, caches per path, brightens dark TRELLIS materials.
- `createFurnitureGroup({ placed, variant, item, isFlat })` — returns a group positioned + rotated for the placed instance. Fills with cloned .glb (independent materials so ghost previews don't leak transparency), flat texture plane, or translucent placeholder box.
- Group materials are always deep-cloned when building — no shared-material mutation bugs.

### Construction drawings (`src/lib/renderConstructionDrawings.ts`)
- Floor plan + elevations stay 2D (clean line-drawn aesthetic)
- Now overlays furniture: rotated rectangles on the floor plan, silhouettes projected onto each elevation (depth-sorted back-to-front, flat items skipped)

### Files deleted
- `src/components/editor/IsometricCanvas.tsx` (1346 lines of PixiJS)
- `src/lib/renderSprites.ts` (Three.js sprite renderer — sprites no longer used)
- `pixi.js` removed from `package.json`

### UI state (`src/stores/useUIStore.ts`)
- `canvasGrid` — grid visibility, persisted to localStorage
- `cameraMode` — 'design' | 'roam', session-local

## Phase 7 Completion Notes
Pipeline simplification — dropped rembg, added multi-image TRELLIS input, added flat-item bypass, moved approval gate from pre-TRELLIS (image review) to post-TRELLIS (.glb review).

## Phase 7 Completion Notes
Pipeline simplification — dropped rembg, added multi-image TRELLIS input, added flat-item bypass, moved approval gate from pre-TRELLIS (image review) to post-TRELLIS (.glb review).

### Schema changes (migration 20240105000000_phase7_pipeline.sql)
- **Dropped:** `furniture_variants.clean_image_url`, `furniture_variants.image_status`, `image_status` enum
- **Replaced:** `original_image_url text` → `original_image_urls text[]` (1+ images per variant, first is primary/fallback)
- **Added:** `render_approval_status` enum (pending|approved|rejected) + column on variants
- **Added:** `furniture_categories.is_flat boolean` (seeded true for `Rug`), `furniture_items.is_flat_override boolean` (nullable per-item override)
- **Clean slate:** truncated `furniture_items` (CASCADE wipes variants/sprites/placed) + templates that referenced them. Preserved categories, styles, profiles, finish_materials.

### Pipeline flow
```
Variant created with original_image_urls[]
  ↓
Flat? (category.is_flat OR item.is_flat_override)
  ├── YES: render_status='completed', render_approval_status='approved'
  │        No TRELLIS. First image = canvas asset. No .glb, no sprites.
  └── NO:  runRenderPipeline() fires:
           1. render_status='processing'
           2. generate-3d-model Edge Function (multi-image → .glb)
           3. client-side renderSprites() → 4 PNGs → sprites bucket
           4. render_status='completed'
           render_approval_status stays 'pending' until designer reviews
```
Designer reviews .glb in ModelApprovalModal (spinning 3D preview) → Approve / Reject / Retry (re-runs TRELLIS with same images).

### Key files
- `supabase/functions/generate-3d-model/index.ts` — accepts `variant_id`, reads `original_image_urls[]`, signs URLs, passes `images: [...]` to TRELLIS. No pre-approval check.
- `supabase/functions/remove-background/` — **DELETED**.
- `src/stores/useCatalogStore.ts` — rewritten:
  - `createVariant` writes array + kicks off pipeline (or skips for flat)
  - `approveRender` / `rejectRender` / `retryRender` — post-TRELLIS gate actions
  - `runRenderPipeline()` — fire-and-forget TRELLIS → sprites helper, updates state via `useCatalogStore.setState`
  - `isItemFlat(itemId)` — effective flat check
  - `getPendingRenderApprovalVariants()` — variants awaiting review
  - **Removed:** `triggerBackgroundRemoval`, `approveImage`, `rejectImage`, `getPendingApprovalVariants`
- `src/components/editor/AddFurnitureModal.tsx` — multi-image upload per variant (add/remove/reorder thumbs, sequential upload with progress).
- `src/components/editor/ModelApprovalModal.tsx` — NEW. Auto-rotating Three.js .glb preview + source photo panel + Approve/Reject/Retry.
- `src/components/editor/ImageApprovalModal.tsx` — **DELETED**.
- `src/components/editor/IsometricCanvas.tsx` — `getFallbackUrl` uses `original_image_urls[0]`. Flat items render via this fallback at all 4 rotations (no sprite rows needed — throwaway bridge, Phase 8 drops sprites entirely).
- `src/components/admin/CatalogOverview.tsx` — dropped "Re-run BG" action. "Regen Sprites" reuses existing .glb if present.

### Designer workflow (external)
`docs/designer-workflow.md` — designers prep messy source photos via Nano Banana (Google Gemini) before uploading. Template prompt: *"Isolate only the [item type]. Generate [N] separate clean product shots on pure white background: front, 3/4, side. Output as separate images."* No built-in preprocessing for v1.

## Phase 2 Completion Notes
All Phase 2 verification steps pass. Key implementation details for future reference:

### Schema additions (beyond original plan)
- `rooms.ceiling_height_cm integer NOT NULL DEFAULT 260` — added via migration, controls isometric wall height

### IsometricCanvas (src/components/editor/IsometricCanvas.tsx)
- PixiJS 8 async init with race condition fix: room/materials stored in refs so init callback can draw immediately
- Always mounted by parent (EditorPage) only when selectedRoom is non-null — never mounts with null room
- 2:1 isometric projection: Width axis (+T, -T/2) per metre, Depth axis (-T, -T/2) per metre, T=64px/m
- Wall height: `Math.round((ceiling_height_cm / 100) * T * 0.6)` — fully dynamic from room data
- Renders: N visible walls (back-to-front sorted), N-vertex floor polygon, doors/windows from geometry, lighting fixture (glow + dot at centroid)
- Door/window placement: click-to-place on visible walls. Stored in `room.geometry.doors[]` / `room.geometry.windows[]` with `wall_index` (segment index into vertices) and position (0-1). Legacy `PhysicalWall` field migrated via `migrateFixtureWallIndex()` in roomGeometry.ts.

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
- Three PixiJS Container layers: `roomLayer` (walls/floor/fixtures) + `furnitureLayer` (sprites) + `shapeLayer` (edit handles)
- Furniture sprites loaded via `Assets.load()` with texture caching (`textureCache` Map)
- Sprite sizing: `scale = (maxDimCm / 100) * T / 512` where 512 is sprite render size
- Sprite anchor: `(0.5, 0.85)` — bottom-center so furniture sits on floor
- Depth sorting: items sorted by `(u + v)` in rotated space (back-to-front)
- Selection: teal ellipse drawn under selected item, pointerdown on sprite selects + starts drag
- Drag: pointermove updates room coords via `screenToRoom` + `unrotatePoint`, clamped to polygon bounds via `nearestPointOnPolygon`
- Placement mode: ghost sprite at 50% alpha follows cursor, click places item
- Keyboard: Escape cancels placement, Delete/Backspace removes selected item
- ResizeObserver for canvas resize
- Store subscription triggers full redraw on any canvas state change

### Room Rotation
- `rotateVertices()` / `rotatePoint()` / `unrotatePoint()` in `src/lib/roomGeometry.ts` handle all rotation transforms
- `apparentDirection()` combines item direction + room rotation for correct sprite selection
- `RotationControls.tsx` — floating frosted-glass bar with NW/NE/SE/SW buttons

### Polygon Room Shapes
- Rooms support arbitrary polygon shapes (N vertices, CCW winding) stored in `room.geometry.vertices`
- `src/lib/roomGeometry.ts` — centralized polygon math (getVertices, pointInPolygon, nearestPointOnPolygon, rotateVertices, isWallVisible, etc.)
- Wall visibility: outward normal dot camera direction > 0. Visible walls sorted by midpoint depth (back-to-front)
- Furniture placement: `pointInPolygon` test rejects outside polygon, `nearestPointOnPolygon` clamps drag
- Fixtures use `wall_index` (segment index) instead of `PhysicalWall` enum. Legacy data migrated via `migrateFixtureWallIndex()`
- Shape edit mode: vertex handles (drag, 10cm snap), midpoint handles (click to add vertex), Delete to remove (min 4)
- RightPanel: "Edit Shape" toggle, vertex count, "Reset to Rectangle", read-only dims when custom vertices exist
- Canvas store: `shapeEditMode`, `selectedVertexIndex` state + actions

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

## Phase 5 Completion Notes
Full template system (3 layers) + cost summary panel with staleness alerts.

### Template Store (`src/stores/useTemplateStore.ts`)
- Full CRUD for all 3 template types: unit layout, furniture layout, design style
- Save: snapshots current rooms/furniture from Project/Canvas/Catalog stores
- Apply unit: deletes existing rooms, creates from template `rooms_data` snapshot
- Apply furniture: auto-fills category slots with first approved item per category
- Apply style: checks staleness first (price_at_save vs current price_thb, link_status), returns alerts array. If `force=true`, applies regardless
- Regenerate: picks random approved items tagged with the style's style_id per category slot
- Admin promote: `is_global = true, promoted_by = profile.id`
- Cross-store access via `useXxxStore.getState()` (same pattern as Canvas Store)
- Sequential Supabase operations (avoids concurrency issues)

### Canvas Store Additions (`src/stores/useCanvasStore.ts`)
- `placeItems(items[])` — batch `.insert([...])` to `placed_furniture` for template apply
- `clearRoomFurniture(roomId)` — single `.delete().eq('room_id', roomId)` for regenerate

### Cost Panel (`src/components/editor/CostPanel.tsx`)
- Computed at render time from 3 stores (Canvas + Catalog + Project), never stored
- Grand total card (gradient), furniture breakdown (per item), manual costs (editable key-value pairs)
- Staleness detection: compares `price_at_placement` vs current variant `price_thb`
- "Acknowledge All" button updates all stale items' `price_at_placement` via `switchVariant`

### RightPanel Tab Switcher
- Properties | Cost tabs at top, controlled by `useUIStore.rightPanelTab`
- Properties tab: existing FurnitureProperties/RoomProperties content
- Cost tab: CostPanel component

### Template Panel (`src/components/editor/TemplatePanel.tsx`)
- Left sidebar "Templates" tab (4th tab added to LeftSidebar)
- Sub-tab pills: Unit | Furniture | Style (local state)
- Template cards: name, personal/global badge, Apply button, admin Promote, Delete
- Save form: inline name input + style picker (for design style templates)
- Staleness Dialog (`StalenessDialog.tsx`): modal shown before applying stale style templates

### Project-Open Staleness Check
- EditorPage loads templates on mount via `useTemplateStore.getState().loadAllTemplates()`
- After `loadPlacedFurniture`, compares prices and shows toast if stale items found

### Project Store Update
- `updateProject` type expanded to include `unit_width_cm | unit_height_cm` (needed by unit template apply)

## Phase 6 Completion Notes
Admin catalog management, team management, room perspective preview, daily link recheck, and construction drawing export — all implemented.

### Admin Page (`src/pages/AdminPage.tsx`)
- 4-tab navigation: Pending | Catalog | Link Health | Team
- Route-protected: `AdminRoute` wrapper in App.tsx checks `profile?.role !== 'admin'`, redirects to `/`
- Header: back button → dashboard, LEANOVATE logo, ADMIN badge, user name
- Tab state is component-local (no UIStore changes)

### Admin Components (`src/components/admin/`)
- **PendingApprovalQueue.tsx** — Direct Supabase queries (not catalog store) to avoid clobbering main `items` list. Expandable cards with item name, category pill, submitter, variants with thumbnails/prices/statuses. Approve/Reject buttons call `catalogStore.approveItem()`/`rejectItem()`.
- **CatalogOverview.tsx** — Summary count cards (total/draft/pending/approved/rejected). Search + status filter pills. Scrollable item list with status dots.
- **LinkHealthOverview.tsx** — Summary cards (active/inactive/unchecked/price changed counts). Flagged variants list with badges.
- **TeamManagement.tsx** — Team member list with role badges, invite form (email + display name + role picker), role toggle (Promote/Demote), remove with confirmation. Uses local `invokeEdgeFunction` helper (same raw fetch + localStorage token pattern as useCatalogStore).

### Team Management Edge Function (`supabase/functions/manage-team/index.ts`)
- 3 actions: `invite` (createUser + set profile), `change-role` (update profile), `remove` (deleteUser)
- Uses `service_role_key` for `supabase.auth.admin` operations
- Security: verifies caller is admin via auth token + profiles table check
- Self-protection: cannot change own role or remove self

### Room Perspective Preview
- **`src/lib/renderRoomPreview.ts`** — Client-side Three.js renderer (same offscreen canvas pattern as renderSprites.ts)
  - Builds room shell: floor (ShapeGeometry from vertices), walls (PlaneGeometry or ShapeGeometry with door/window cutouts), ceiling
  - Doors: rectangular cutout holes + brown door panel meshes
  - Windows: rectangular cutout holes + semi-transparent glass panes + grey frames
  - Applies finish colors from finish_materials table via `getFinishHex()` helper
  - Loads placed furniture .glb models via GLTFLoader, positions at (u, 0, v), scales by dimensions
  - PerspectiveCamera at 160cm height, positioned 0.4m inward from user-selected wall midpoint, looking perpendicular across room
  - `cameraWallIdx` parameter: caller controls which wall the camera stands at (default 0)
  - Lighting: ambient + warm directional + cool fill + point light at centroid
  - Output: 1920×1080 PNG blob, horizontally mirrored to correct Three.js camera handedness for CCW-wound rooms
  - Returns `{ blob, error, warnings }` — warnings list items with missing .glb files
- **`src/components/editor/RoomPreviewModal.tsx`** — Modal overlay with wall selector, loading spinner, rendered image, warning banner, Download PNG + Save to Project buttons
  - Wall selector button bar: N buttons (one per wall from `getVertices(room).length`), labeled "Wall 1" through "Wall N"
  - Re-renders on wall selection change with loading spinner
  - "Save to Project" uploads to `thumbnails` bucket, updates `rooms.preview_image_url`
- **EditorPage changes** — "Preview" button in header (Eye icon), disabled when no room selected

### Daily Link Recheck
- **`supabase/functions/recheck-links/index.ts`** — Scheduled Edge Function for batch URL checking
  - Domain-specific checking: Shopee API, IKEA HTML, generic JSON-LD fallback
  - Updates `link_status`, `last_checked_at`, `price_thb`, `price_changed` (>20% threshold)
  - Batch size ~50, 8s timeout per URL, 500ms delay between requests
- **`src/components/admin/LinkHealthOverview.tsx`** — "Run Recheck Now" button + result summary + flagged items list

### Construction Drawing Export
- **`src/lib/renderConstructionDrawings.ts`** — Client-side Canvas 2D renderer
  - `renderFloorPlan()`: top-down orthographic view with door swing arcs, window marks, dimension lines on all walls
  - `renderElevation()`: head-on wall-face view per wall with door/window cutouts and dimension lines
  - `exportConstructionPDF()`: multi-page PDF via jsPDF (page 1: floor plan landscape, pages 2+: elevations portrait)
  - Auto-selects scale (1:25/1:50/1:100), includes title blocks with room name, project name, date
- **`src/components/editor/ConstructionDrawingModal.tsx`** — Modal with rendering progress, preview grid, Download PDF button
- **EditorPage** — "Drawings" button (FileText icon) in header next to Preview button

### Route & Navigation Changes
- `src/App.tsx` — Added `AdminRoute` wrapper + `/admin` route
- `src/pages/DashboardPage.tsx` — Added "Admin" button (Shield icon) visible to admin role only
- `src/stores/useProjectStore.ts` — Added `preview_image_url` to `updateRoom` accepted fields

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
4. **Furniture uses a parent + variants model.** Parent item holds shared details. Each color variant has its own `original_image_urls[]` (1+ photos), price, link, .glb, and sprites. See schema.md.
5. **Approval is post-TRELLIS, not pre-TRELLIS.** Variants start with `render_approval_status='pending'`. After TRELLIS generates a .glb, designer reviews it in ModelApprovalModal and approves/rejects/retries. Approval is a quality signal — it does NOT gate canvas placement. Flat items (category.is_flat or item.is_flat_override) skip TRELLIS entirely and auto-approve.
6. **Designer uploads images manually.** The scraper only extracts text data (name, description, dimensions). It does NOT download product images.
7. **Three.js sprite rendering runs client-side.** After TRELLIS generates a .glb, the browser renders 4 isometric sprites using Three.js (src/lib/renderSprites.ts) and uploads them to Supabase Storage. PixiJS handles all canvas rendering. Three.js is used server-side only for room perspective previews.
8. **NEVER use `supabase.from()`, `supabase.storage`, or `supabase.auth` for write operations, OR call any store `load*` function from action callbacks while CatalogPanel is mounted.** The Supabase JS client deadlocks when two async operations run concurrently through the same instance — no error, no timeout, just a permanent hang. CatalogPanel polls `loadVariantsForItem` every 5 seconds, so ANY other Supabase client call (including reads!) can collide with it. **Use raw fetch helpers from `@/lib/supabase` instead:** `rawInsert`, `rawInsertMany`, `rawUpdate`, `rawUpdateWhere`, `rawDelete`, `rawDeleteWhere`, `rawStorageUpload`, `rawStorageDownload`, `getPublicStorageUrl`, plus `getAuthToken` and `invokeEdgeFunction` (in `useCatalogStore.ts`). Read-only queries inside store `load*` methods themselves may still use the client (they're the only thing running on initial mount), but action callbacks must NOT trigger re-fetches via `load*` — trust the local Zustand state updates instead. The only safe Supabase client uses are: (a) read-only `.select()` queries inside `load*` methods, (b) `supabase.auth.*` calls in `useAuthStore.ts` (login/signup/signout never run concurrently with polling).

## API Keys Required
- **Supabase:** Project URL + anon key + service role key (from Supabase dashboard)
- **Replicate:** API token (from replicate.com — for TRELLIS model)

## Database
- All tables defined in docs/schema.md
- Row-Level Security (RLS) on all tables
- Designers see own drafts + approved items; admins see everything
