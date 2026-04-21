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
- @docs/phase-history.md — Completion notes per shipped phase (read when touching a subsystem the phase introduced)

## Tech Stack
- Frontend: React 18+ / TypeScript 5+ / Vite 5+ / Three.js / Zustand 4+ / shadcn/ui / Tailwind 3+
- Backend: Supabase (auth, PostgreSQL, storage, edge functions)
- AI Pipeline: TRELLIS via Replicate (multi-image → .glb 3D model, does its own background removal). .glb files are rendered directly in the Three.js canvas (no sprite generation). Flat items (rugs, etc.) bypass TRELLIS entirely and render as textured floor planes.
- Hosting: Vercel (frontend) + Supabase Cloud (backend)
- Icons: Lucide React (included with shadcn/ui)

## Current Phase
V1 COMPLETE (Phases 1–6) + Phase 7 COMPLETE + Phase 8 COMPLETE. All MVP functionality shipped against the new 3D canvas.

## Follow-up Improvements (backlog — not yet scoped into a phase)
Captured during Phase 8 review. Prioritize before first paying customer touches the product.

- **Lighting effect** — current scene lighting (ambient + directional + fill + point at centroid) looks flat. Needs warmer tone, softer shadows, and a global exposure pass so wood/fabric finishes read correctly in both design and roam modes.
- **Ceiling light** — actual ceiling fixture mesh (not just a point light). Should render a visible luminaire that matches the selected `lighting` finish and cast plausible downlight on the floor/walls.
- ~~**Surfaces (walls, floors)**~~ ✅ Shipped 2026-04-21 (commit `09c7bfc`). `finish_materials` gained `texture_url` + `tile_size_cm`. 13 CC0 tileable JPGs from Poly Haven committed to `public/textures/{floors,walls}/` + seeded as presets (7 floors, 6 walls). New helpers in `src/lib/roomScene.ts` — `getFinishAppearance`, `getSharedTexture` (URL-keyed cache — one GPU texture shared across all meshes using it), `setWorldSpaceUVs` (bakes physical tile rate into mesh UVs so the shared texture stays at `repeat=(1,1)` regardless of surface size), `applyFinishTexture`. Wired into `buildRoomShell` floor + both wall paths (PlaneGeometry no-cutout, ShapeGeometry with cutouts) and into `renderRoomPreview.ts`. Finishes tab splits swatches into **Colors** vs **Textures** sub-groups per finish type — plain paints (hex) + tileable textures (URL) coexist. Door/window finish rows + `'door' | 'window'` from `FinishType`/`RoomFinishes` dropped entirely (fixtures handle those now); renderers use hardcoded `#C4B8A8` / `#DDEEFF` fallback panel + glass colors. Lighting kept in schema/enum but hidden from the picker pending the ceiling-light feature. Normal/roughness maps still deferred — today's setup is single-albedo, which is the Sims aesthetic (option 2 PBR is a later upgrade).
- **Flat model background removal** — flat items (rugs, wall art) currently render the uploaded image as-is, so any non-transparent background shows as a visible rectangle on the floor/wall. Need either a preprocessing step (rembg or similar at upload) or strict PNG-with-alpha enforcement with a clearer designer warning.
- **Doors, windows, curtains** — partial progress 2026-04-21 (commit `54be275`):
  - ✅ **TRELLIS bypass** — doors/windows (`mount_type='wall'` categories) never go through the 3D pipeline. `createVariant` and `retryRender` in the catalog store gate on a new `isItemArchitectural` helper. Do NOT re-wire these through TRELLIS — the model distorts framed/glazed geometry badly. Architectural fixtures always render as room-shell primitives.
  - ✅ **Door/window render path** — room shell always uses a cutout + textured panel (from the variant's uploaded photo) or a generic glass+frame fallback. `.glb` loading for these was removed from `roomScene.ts` and `renderRoomPreview.ts`.
  - ✅ **Curtains** — procedural pleated cloth panels in `roomScene.ts` (`buildCurtain` + `buildCurtainPanel` + shared `getFabricNormalTexture`). Reads `RoomWindow.curtain_style` + `curtain_color`. "Closed" = single panel across the full opening + 12cm overhang; "open" = two gathered side panels. Rod-to-floor length, thin dark rod, shared linen-weave normal map. Rendered in both live canvas and perspective preview.
  - ⚠️ **Still backlog** — proper door *leaf* meshes (frames, handles, swing direction indicators) and proper window *mullion* meshes (frames, grids of glazing). Today both are single textured planes. The architectural gate is in place; when modeled, they slot into the same render path as curtains.
- ~~**Show ceiling when camera below ceiling**~~ ✅ Shipped 2026-04-21. RoomCanvas now toggles the ceiling mesh each frame in design mode: `ceiling.visible = camera.position.y < ceilingH`. Roam mode still builds the shell with ceiling always visible. Binary toggle for now — add an opacity fade if the pop is jarring in practice.
- ~~**Catalog UI (left sidebar) — Sims-style shopping feel**~~ ✅ Shipped 2026-04-22. CatalogPanel now renders a 2-column grid of square tiles with cached isometric `.glb` snapshots (migration `20260422000000_variant_thumbnails.sql` adds `furniture_variants.thumbnail_path`; renderer in `src/lib/renderVariantThumbnail.ts`; backfilled lazily on catalog mount). Click tile = place on canvas; ⋯ icon opens a detail drawer for per-variant actions, render review, and admin approval. Hover-to-rotate live preview deliberately deferred.
- **Room Preview mode — remove or upgrade** — with orbit + roam now fluent in the live canvas, the static "Preview Room" modal (single 1920×1080 render from a chosen wall) is strictly worse than just rotating/roaming. Two options: (a) delete the Preview button + `RoomPreviewModal.tsx` + `renderRoomPreview.ts` entirely and lean on in-canvas views for presentations, or (b) upgrade it into a render-quality export (higher-res, better lighting/materials, optional post-processing) that's genuinely distinct from the live canvas. Decide before launch — don't ship both.
- ~~**Image upload → 3D render waiting UX**~~ ✅ Shipped 2026-04-21. AddFurnitureModal now enqueues variants into `useRenderQueueStore` and closes immediately. A global `RenderQueueTray` (mounted in `App.tsx`, bottom-right) shows per-variant stage (`uploading → creating → trellis → ready | failed`), upload progress bar, elapsed time, and a Review CTA that opens `ModelApprovalModal` inline. Ready-stage entries auto-dismiss when the designer approves or rejects (subscribes to catalog store's `render_approval_status`). TRELLIS observation uses Zustand subscribe — zero new polling. `generate-3d-model` now propagates the real Replicate error text on prediction start failure so 500s are self-diagnosing.
- **Furniture styles & templates regenerate/redesign button** — when a furniture layout or design style template is applied, designers need a "Regenerate" / "Redesign" button that swaps the picked products for alternates *within the same constraints*: same category, same style tag(s), same effective block size (so placement and grid snap stay valid). Should randomize per-slot (not a full re-roll of the whole room) so designers can lock the picks they like and reshuffle only the slots they don't. Useful as the core of the "one-click generate with regenerate/shuffle" story from product-spec.md user story #7.
- ~~**Project selection page canvas thumbnails**~~ ✅ Shipped 2026-04-25. DashboardPage cards now show a 16:10 isometric dollhouse snapshot of the project's primary room (first by `sort_order`). Renderer in `src/lib/renderProjectThumbnail.ts` (640×400 PNG, 45°/35.264° ortho camera, frustum fit to room AABB + 12% pad); migration `20260425000000_project_thumbnails.sql` adds `projects.thumbnail_path`. Auto-refresh fires from EditorPage Save (fire-and-forget after `saveProject` + `savePlacedFurniture` so it doesn't block the toast); manual refresh via hover-reveal button on each card calls `refreshProjectThumbnailFromDb` (loads fresh DB data, safe because CatalogPanel isn't mounted on dashboard). Wall-side picked per winding (CCW → `FrontSide`, CW → `BackSide`) so near walls cull for both default rectangles and shape-edited polygons. `LayoutGrid` icon placeholder when no thumbnail yet; `updated_at` query param busts the cache after refresh.

## Phase Completion Notes
Historical implementation details for shipped phases (5, 6, 7, 8) have moved to `docs/phase-history.md`. Read that file when touching a subsystem a phase introduced.

## Code Style
- TypeScript strict mode. **Verify with `npm run build`, not `tsc --noEmit`** — the project's `tsc -b` respects `verbatimModuleSyntax` (so `import type` is required for type-only imports); `--noEmit` is more permissive and will let broken code through.
- Functional components with hooks.
- One Zustand store per file in src/stores/ (6 stores — see state-map.md). For stores that grow past ~500 lines, compose from slices under `src/stores/<domain>/` — see `src/stores/catalog/` as the reference (slices + `pipeline.ts` + a shared `SliceCreator<T>` alias so cross-slice `get()` type-checks).
- Zustand v5: use `create<T>(fn)` (single-paren). The curried `create<T>()(fn)` form can behave surprisingly when composing slices.
- Supabase client in src/lib/supabase.ts.
- Use Tailwind utility classes + CSS variables from design.md.
- Use shadcn/ui components as the base UI library.
- Use Lucide React for all icons.

## File Structure — Large Components

When a component passes ~600 lines, split it. Reference implementations: `src/components/editor/RightPanel/`, `AddFurnitureModal/`, `RoomCanvas/`.

- **Directory + `index.tsx`**: Vite resolves the directory automatically so call-site imports don't change. Shared CSS goes in `styles.ts`; component-local CSS stays inline in the owning file.
- **Three.js / canvas components** (`RoomCanvas/`): one `useThreeScene` hook owns mount + render loop and returns a `SceneContext` holding every scene ref. Downstream hooks (`useRoomShell`, `useFurnitureLayer`, etc.) **destructure the refs they need into local vars at the top of the hook** — required by `react-hooks/immutability`. Pure helpers (raycasters, grid math, geometry commands) live in `lib/`.
- **Ordered event handlers**: when the priority of checks matters on a single event (e.g. `pointerdown` → shape-edit handle → fixture placement → furniture placement → fixture pickup → furniture raycast → deselect), keep them in ONE dispatcher function. Don't split listeners by concern — you'll silently break the order.
- **Cross-cutting state**: if handlers span multiple "steps" (like `AddFurnitureModal`'s screenshot extract touching both step-1 fields and step-2 variant 0), keep state + handlers in `index.tsx` and make step files purely presentational. Don't introduce context or lift to hooks just to split files.

## Commands
- `npm run dev` — start dev server
- `npm run build` — production build
- `npm run lint` — ESLint + Prettier

## Key Rules
1. **Read the relevant doc before implementing any feature.** Each doc owns a specific domain — check the scope table at the top of each file.
2. **Never duplicate state across Zustand stores.** Catalog Store is the single source of truth for all product data. Other stores reference by ID only. See state-map.md.
3. **Cost summary is always computed live, never stored.** Derive from placed furniture variant prices (Catalog Store) + manual costs (Project Store).
4. **Furniture uses a parent + variants model.** Parent item holds shared details. Each color variant has its own `original_image_urls[]` (1+ photos), price, link, and `.glb`. See schema.md.
5. **Approval is post-TRELLIS, not pre-TRELLIS.** Variants start with `render_approval_status='pending'`. After TRELLIS generates a .glb, designer reviews it in ModelApprovalModal and approves/rejects/retries. Approval is a quality signal — it does NOT gate canvas placement. Flat items (category.is_flat or item.is_flat_override) skip TRELLIS entirely and auto-approve.
6. **Designer uploads images manually.** The scraper only extracts text data (name, description, dimensions). It does NOT download product images.
7. **Three.js is the only renderer.** Live editor canvas (`RoomCanvas/index.tsx`), room perspective preview (`renderRoomPreview.ts`), and the .glb approval modal all run client-side Three.js. PixiJS is gone (Phase 8). Sprite generation is gone — `.glb` files render directly.
8. **NEVER use `supabase.from()`, `supabase.storage`, or `supabase.auth` for write operations, OR call any store `load*` function from action callbacks while CatalogPanel is mounted.** The Supabase JS client deadlocks when two async operations run concurrently through the same instance — no error, no timeout, just a permanent hang. CatalogPanel polls `loadVariantsForItem` every 5 seconds, so ANY other Supabase client call (including reads!) can collide with it. **Use raw fetch helpers from `@/lib/supabase` instead:** `rawInsert`, `rawInsertMany`, `rawUpdate`, `rawUpdateWhere`, `rawDelete`, `rawDeleteWhere`, `rawStorageUpload`, `rawStorageDownload`, `getPublicStorageUrl`, plus `getAuthToken` and `invokeEdgeFunction` (in `useCatalogStore.ts`). Read-only queries inside store `load*` methods themselves may still use the client (they're the only thing running on initial mount), but action callbacks must NOT trigger re-fetches via `load*` — trust the local Zustand state updates instead. The only safe Supabase client uses are: (a) read-only `.select()` queries inside `load*` methods, (b) `supabase.auth.*` calls in `useAuthStore.ts` (login/signup/signout never run concurrently with polling).

## API Keys Required
- **Supabase:** Project URL + anon key + service role key (from Supabase dashboard)
- **Replicate:** API token (from replicate.com — for TRELLIS model)

## Database
- All tables defined in docs/schema.md
- Row-Level Security (RLS) on all tables
- Designers see own drafts + approved items; admins see everything
