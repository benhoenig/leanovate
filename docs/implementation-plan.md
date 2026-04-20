# Implementation Plan — LEANOVATE V2

> **STATUS: COMPLETE.** Phases 7 and 8 both shipped. This doc is retained for
> historical context on the V2 direction; see `CLAUDE.md` for current state.
> The original 6 phases are archived at `implementation-plan-legacy.md`.
>
> **Document scope:** Post-V1 direction and phases. Real-user testing of V1 surfaced two architectural improvements — this doc records them.
>
> **Out of scope (covered in other docs):**
>
> | File | Owns |
> |---|---|
> | `product-spec.md` | Features, user stories, interaction flows |
> | `tech-stack.md` | Technology choices, libraries, versions, rationale, folder structure |
> | `schema.md` | Database tables, fields, relationships |
> | `design.md` | Visual system — colors, typography, component styling |
> | `state-map.md` | Zustand store domains and ownership |
> | `integration-contracts.md` | External API shapes and contracts |

---

## Context — Why V2

The original 6 phases shipped and the full MVP works end-to-end. Real-user testing (the project owner using the app as a designer would) surfaced two architectural problems:

### Problem 1: Fragile AI pipeline

The TRELLIS pipeline produces inconsistent results on varied real-world product photos (different sizes, lighting, backgrounds, lifestyle shots vs clean shots, flat items like rugs). The rembg step + hard approval gate was supposed to catch issues before spending TRELLIS API cost, but it added its own failure points and didn't actually fix the underlying variance problem. Designer time spent fixing bad outputs was starting to eat the time savings templates are supposed to deliver.

### Problem 2: Isometric sprites fight the asset nature

The stack generates `.glb` 3D models via TRELLIS, then flattens them into 4 isometric sprite PNGs, then displays the sprites in a 2D PixiJS canvas. That's real engineering effort spent turning 3D assets into 2D tiles — and the result is a canvas that feels static, locks furniture to 4 angles only, and exposes asset quality issues as "weird flat cutouts" rather than "slightly off 3D shapes." A Three.js scene using the `.glb` files directly would be simpler code, use the assets as intended, and produce a Sims-like UX that matches how designers actually think about space.

### V2 direction (confirmed)

- **Stream A — Pipeline simplification**: drop rembg, support multi-image TRELLIS input, add flat-item bypass, move approval gate post-TRELLIS, keep the pipeline itself minimal for v1 (designers handle messy source photos externally before uploading).
- **Stream B — 3D canvas pivot**: replace PixiJS isometric canvas with Three.js 3D scene, Sims-style. Direct `.glb` rendering, snap-to-grid block sizing, design/roam camera modes. Drop sprite rendering entirely.

Sequence: **A before B.** The 3D canvas displays `.glb` files directly — better-quality `.glb` coming out of A is a prerequisite for B to look good.

---

## Phasing Principles

Same as V1:

1. Each phase produces something testable.
2. Data first, visuals on top.
3. Complete flows, not half-features.
4. Foundation before speed.

Plus one V2 principle:

5. **Clean slate over migration.** The project has no paying users yet. Delete old test projects/rooms/placed furniture during the canvas pivot rather than writing migration code for transient data.

---

## Phase Overview

| Phase | Name | Stream | Est. Effort | Depends On |
|---|---|---|---|---|
| 7 | TRELLIS Pipeline Improvements | A | ~few days | V1 complete |
| 8 | 3D Canvas Rebuild (Sims-style) | B | ~1–2 weeks | Phase 7 |

---

## Phase 7: TRELLIS Pipeline Improvements

Simplify the pipeline, improve `.glb` quality, stop fighting edge cases the pipeline was never going to handle well.

### What to build

**Drop rembg entirely**
- Delete `supabase/functions/remove-background/` Edge Function
- Remove rembg-era fields from `furniture_variants`: `clean_image_url`, `image_status`
- Remove the pre-TRELLIS image approval gate and associated UI (`ImageApprovalModal.tsx`)
- TRELLIS does its own background removal internally — stop double-processing

**Multi-image upload per variant**
- Schema change: `furniture_variants.original_image_url text` → `original_image_urls text[]` (1–6 images per variant)
- Upload UI (`AddFurnitureModal.tsx`): drag-and-drop multi-file widget, reorderable thumbnails
- `generate-3d-model` Edge Function: accept array of signed URLs, pass all to TRELLIS `images[]` input
- TRELLIS multi-image input is the biggest `.glb` quality lever — designer provides 2–4 real product-page angle shots when available

**Flat-item bypass**
- Schema: `furniture_categories.is_flat boolean default false`; seeded true for rugs, wall art, curtains, bedding, mirrors
- Schema: `furniture_items.is_flat_override boolean nullable` (admin/designer per-item override)
- When effective `is_flat = true`: skip `generate-3d-model` entirely. Use the first uploaded image directly as the sprite / canvas asset. No TRELLIS cost, no `.glb`, no weird distorted rugs.

**Post-TRELLIS approval gate**
- Schema: `furniture_variants.render_approval_status enum('pending','approved','rejected') default 'pending'`
- New modal: `ModelApprovalModal.tsx` — renders the generated `.glb` in a small Three.js preview (spin 360°), optionally shows the 4 sprite angles, designer clicks approve / reject / re-upload
- Replaces the old "approve clean image" gate. Designer can see the actual 3D output before committing the variant to the canvas.
- Variant is usable on canvas before approval (with original photo fallback as placeholder) — approval just removes the "pending" badge.

**`generate-3d-model` Edge Function updates**
- Accept `images: string[]` instead of single URL
- Sign URLs for each image
- Pass array directly to TRELLIS `images` input
- Keep existing settings: `texture_size: 1024`, `mesh_simplify: 0.95`, `generate_model: true`, everything else false/default
- Remove the `image_status === 'approved'` check (since rembg gate is gone — the pre-check becomes: at least one uploaded image exists)

**Designer external preprocessing workflow**
- New doc: `docs/designer-workflow.md` — instructs designers on how to prep messy/lifestyle photos before uploading:
  - Recommended tool: Nano Banana (Google Gemini image generation)
  - Prompt template: *"Isolate only the [item type] from this image. Generate [N] separate clean product shots on pure white background: front view, 3/4 angle view, side view. Output as separate images, not a composite."*
  - Upload the prepped outputs to Leanovate
- Keep this workflow external for v1. Do NOT build Nano Banana into the app. Designer manages the messy-input problem before the app sees the data.

### What to test

- Upload a variant with 3 clean product-page photos → TRELLIS output is noticeably cleaner than single-image mode
- Upload a rug → flat-item bypass kicks in, sprite = original photo, no TRELLIS call, no cost
- Upload a per-item override for a non-rug flat-ish item (e.g. thin headboard) → bypass works
- Upload only lifestyle photos → TRELLIS output is bad (expected) → designer re-preps via Nano Banana externally → re-upload → output is clean
- Reject a bad `.glb` via the new modal → variant goes back to `pending`, designer can re-upload and retry

### Reference docs to update

- `schema.md` — `original_image_urls[]`, drop `clean_image_url`/`image_status`, add `render_approval_status`, `is_flat`, `is_flat_override`
- `integration-contracts.md` — update TRELLIS section (multi-image, no rembg), remove the rembg section entirely, remove the Three.js sprite rendering section too (Phase 8 drops sprites — but note Phase 7 keeps them working so cross-reference accordingly)
- `CLAUDE.md` — Phase 7 completion notes after shipping

---

## Phase 8: 3D Canvas Rebuild (Sims-style)

Replace the PixiJS isometric canvas with a Three.js 3D scene that renders `.glb` files directly.

### What to build

**Canvas core**
- Rename `IsometricCanvas.tsx` → `RoomCanvas.tsx`
- Replace PixiJS with a Three.js `WebGLRenderer` scene
- Room shell rendering reuses the logic from `src/lib/renderRoomPreview.ts`: polygon floor, walls with door/window cutouts, ceiling, finish materials from `finish_materials` table
- Furniture rendered from `.glb` via `GLTFLoader`, cached per variant ID (one loaded model reused across instances)
- For flat items (`is_flat = true`): render as a thin textured plane using the sprite image, placed flat on the floor (rugs) or vertically on a wall (wall art) — no `.glb` expected
- Placeholder when `.glb` missing or pending approval: simple semi-transparent box primitive sized to the variant's dimensions

**Camera modes**
- **Design mode** (default): orbit camera around room centroid, pitch locked ~30–50°, zoom limits, can't clip through walls. Mouse drag rotates, scroll zooms.
- **Roam mode**: first-person camera at 160cm eye height, WASD movement, mouse look. Toggleable via a button in the toolbar ("🚶 Roam" → "🎨 Design"). For client presentation.
- Both modes share the same scene; toggling just swaps the camera and its controls

**Interaction**
- Click-to-place: raycast from mouse into floor plane, compute `(x_cm, z_cm)`, snap to grid, drop a ghost mesh, click to commit
- Click-to-select: raycast against furniture meshes, highlight selected (emissive outline or bounding box)
- Drag-to-move: selected item's position tracks raycast hit on floor plane, snaps to grid, Ctrl bypasses snap
- Rotate: replace `direction` enum with continuous `rotation_deg float`. Wheel-scroll on selected item rotates; snaps to 15° increments, Ctrl bypasses
- Delete/Backspace: remove selected item (same as V1)

**Block sizing system**
- Two grid sizes: **big = 100cm**, **small = 25cm**
- Schema: `furniture_categories.default_block_size enum('big','small') default 'big'`
  - Seed: main furniture (sofa, bed, dining table, wardrobe, desk, bookshelf, TV stand) → big; accessories (lamp, plant, side table, vase, small decor) → small
- Schema: `furniture_items.block_size_override enum('big','small') nullable`
- Effective block size = `block_size_override ?? category.default_block_size`
- Placement snap uses the effective block size for that item
- Block picker UI in the properties panel: visual W×D chess-grid selector. User picks cells → writes continuous cm values to variant dimensions (e.g. 3×2 big blocks → 300×200cm). Alongside: manual cm number inputs for fine-tune. Selector and number inputs stay in sync.

**Features to port from PixiJS canvas**
- Polygon room shapes + shape edit mode (vertex handles, midpoint-add handles, delete-vertex, Reset to Rectangle)
- Finish materials (walls, floor, doors, windows, lighting) — reuse perspective preview material logic
- Door/window fixtures with `wall_index` + position along segment
- Room rotation (becomes design-mode camera presets: NW/NE/SE/SW orbit positions)
- Placement mode with ghost mesh
- Properties panel — selected furniture properties (name, category, variant swatches, price, dimensions, block picker, rotate, remove)
- Cost summary panel (unchanged — it reads from stores, not from the canvas)
- Templates (unit / furniture / style) — unchanged logic, just writes to the new data model

**Features to drop**
- `src/lib/renderSprites.ts` — no longer needed, delete
- `furniture_sprites` table — drop via migration
- `sprites` bucket — keep for Phase 7 flat-item sprites, but stop generating 4-angle sprites from `.glb`
- `placed_furniture.direction` enum → replaced by `rotation_deg`

**Construction drawings**
- Update `src/lib/renderConstructionDrawings.ts` to render from the Three.js scene using `OrthographicCamera`:
  - Floor plan: top-down ortho camera, render to offscreen canvas
  - Elevations: ortho camera at each wall's outward-facing midpoint, perpendicular to wall plane
- Reuse existing dimension-line + title-block overlay logic (drawn on Canvas 2D on top of the rendered image)
- Multi-page PDF export unchanged

**Data model changes (`placed_furniture`)**
- `x` → `x_cm float` (clearer that it's cm in world space)
- `y` → `z_cm float` (Y axis is up in Three.js; the old `y` was horizontal depth)
- Add `y_cm float default 0` (vertical offset — 0 for floor items, non-zero for wall-mounted items like art / mirrors / wall shelves)
- Replace `direction direction` enum → `rotation_deg float default 0`
- `price_at_placement` unchanged

**Migration (clean slate)**
- Truncate `projects`, `rooms`, `placed_furniture` (no paying users, no data worth preserving)
- Drop `furniture_sprites` table
- Retain `furniture_items`, `furniture_variants`, `.glb` files in `glb-models` bucket, `finish_materials`
- Retain templates data (will need light migration if direction enum is referenced in `items_data` JSON — unlikely but check)

**Performance**
- Instanced meshes: duplicates of the same variant (e.g. 4 dining chairs) share one `.glb` load via `InstancedMesh` where possible
- Draco / Meshopt compression on `.glb` files (TRELLIS supports this — enable in `generate-3d-model` if not already)
- LOD fallback: placeholder box when `.glb` is missing, loading, or rejected
- Target 30fps on desktop Chrome with 30+ furniture items in the scene

**Tablet support**
- Out of scope for Phase 8. Focus on desktop Chrome/Safari. Revisit post-launch if client-presentation-on-tablet turns out to be a real requirement.

### What to test

- Place a sofa via click-to-place → snaps to 100cm grid → drag with Ctrl held → moves freely off-grid
- Switch to a plant (small block) → snaps to 25cm grid
- Override a coffee table's block size from big → small → grid snap changes accordingly
- Rotate the sofa 15° at a time with scroll-wheel → snaps feel right, Ctrl gives continuous rotation
- Place a rug → renders as flat plane on floor, not a distorted `.glb`
- Toggle roam mode → walk through the room in first-person → back to design mode, state preserved
- Open a project with 30+ furniture items → maintains interactive framerate
- Apply a design style template → all furniture places correctly with rotations intact
- Export construction drawings → floor plan and elevations match the 3D scene dimensions accurately
- Cost summary, shape edit mode, finish changes, variant swatches, templates all still work

### Reference docs to update

- `product-spec.md` — update user stories for 3D interaction (story #8 placement, #9 rotation, #10 room rotation → design mode orbit, add roam mode, block sizing)
- `tech-stack.md` — Three.js primary renderer for canvas (not just sprites/preview). PixiJS removed from dependencies. Mention WebGL 2 requirement.
- `schema.md` — `placed_furniture` new fields (`x_cm`, `y_cm`, `z_cm`, `rotation_deg`), drop `direction`; `furniture_categories.default_block_size`, `furniture_items.block_size_override`; drop `furniture_sprites` table entirely
- `state-map.md` — Canvas Store updates for 3D coordinates, rotation_deg, block-size UI state, camera mode
- `integration-contracts.md` — remove "Three.js Sprite Rendering" section, add "3D Canvas Rendering (Three.js)" section covering scene composition, camera modes, interaction, construction drawing export
- `design.md` — 3D scene lighting/materials should match the perspective preview aesthetic; block picker UI styling
- `CLAUDE.md` — Phase 8 completion notes after shipping, including any concurrency gotchas learned

---

## Dependency Graph

```
V1 (complete)
   │
   ▼
Phase 7: Pipeline Improvements
   │
   ▼
Phase 8: 3D Canvas Rebuild
```

Phase 7 must land first. The 3D canvas displays `.glb` files directly — bad `.glb` output (single-image TRELLIS on messy inputs, attempted rug `.glb`) makes the Sims-style canvas look bad no matter how well-engineered the canvas itself is. Phase 7 also produces testable wins faster and is lower-risk than the canvas rewrite.

---

## What "Done" Looks Like (V2)

All V1 phases + Phase 7 + Phase 8 complete:

1. Designer uploads 2–4 clean product shots per variant (prepped externally via Nano Banana if source photos are messy) → gets a reliable `.glb` out of TRELLIS
2. Flat items (rugs, wall art, curtains, bedding, mirrors) skip TRELLIS entirely and use the product photo as the sprite
3. Designer places furniture in a Sims-style 3D room with big/small block snap-to-grid, Ctrl to bypass
4. Designer rotates the camera freely in design mode; toggles roam mode for client presentations
5. Room shapes, finishes, templates, cost summary, and construction drawings all work against the new 3D data model
6. `furniture_sprites` table and 4-angle sprite PNGs are gone; the pipeline and canvas both use `.glb` natively
