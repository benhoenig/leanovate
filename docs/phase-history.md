# Phase History — LEANOVATE

> **Document scope:** Historical completion notes for shipped phases. Read when touching the subsystem a phase introduced — these notes capture gotchas, file locations, and decisions that don't live in the authoritative specs.
>
> **Authoritative specs** (use these first for data/API/design questions):
>
> | File | Owns |
> |---|---|
> | `product-spec.md` | Features, user stories, MVP scope, roles |
> | `tech-stack.md` | Technology choices, libraries, versions |
> | `schema.md` | Database tables, fields, relationships |
> | `design.md` | Visual system |
> | `state-map.md` | Zustand store domains |
> | `integration-contracts.md` | External API contracts |
> | `implementation-plan.md` | V2 build plan (Phases 7–8) |
> | `designer-workflow.md` | External photo prep (Nano Banana) |

---

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

---

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

Note: step 3 (client-side sprite render) was removed in Phase 8 — `.glb` files now render directly in the Three.js canvas, no sprite PNGs are generated.

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
- `src/components/admin/CatalogOverview.tsx` — dropped "Re-run BG" action. "Regen Sprites" reuses existing .glb if present.

### Designer workflow (external)
`docs/designer-workflow.md` — designers prep messy source photos via Nano Banana (Google Gemini) before uploading. Template prompt: *"Isolate only the [item type]. Generate [N] separate clean product shots on pure white background: front, 3/4, side. Output as separate images."* No built-in preprocessing for v1.

---

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
- **`src/lib/renderRoomPreview.ts`** — Client-side Three.js renderer (same offscreen canvas pattern as the retired renderSprites.ts)
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

---

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
