# Integration Contracts — LEANOVATE

> **Document scope:** How LEANOVATE connects to external services. For each integration: what we send, what we get back, where the result goes, and what to do when it fails.
>
> **Out of scope (covered in other docs):**
>
> | File | Owns |
> |---|---|
> | `product-spec.md` | Features, user stories, interaction flows |
> | `tech-stack.md` | Technology choices, versions, rationale, folder structure |
> | `schema.md` | Database tables, fields, relationships |
> | `design.md` | Visual system — colors, typography, component styling |
> | `state-map.md` | Zustand store domains and ownership |
> | `implementation-plan.md` | Build order, phases, timeline |

---

## Integration Overview

| # | Integration | Runs On | Triggered By |
|---|---|---|---|
| 1 | Supabase Auth | Client (browser) | User login/logout |
| 2 | Supabase Storage | Client + Edge Functions | Image uploads, `.glb` storage |
| 3 | Product Screenshot Extraction | Supabase Edge Function (Claude Vision) | Designer uploads a product page screenshot |
| 4 | Replicate API — TRELLIS | Supabase Edge Function | Variant created (non-flat items). Multi-image input. |
| 5 | Daily Link Recheck | Supabase Edge Function (scheduled) | Daily cron (3:00 AM Bangkok time) |
| 6 | Export Canvas View | Client (browser, Three.js) | Designer clicks the "Export view" button on the canvas |
| 7 | 3D Canvas Rendering | Client (browser, Three.js) | Editor page mount (live canvas for placement) |

---

## 1. Supabase Auth

**Purpose:** User authentication and role-based access.

**Send:** Email + password (or magic link request)
**Get back:** Session token + user ID
**Where it goes:** Auth Store (`useAuthStore`) loads the user's profile from the `profiles` table using the returned user ID
**Error handling:** Surface login errors to the user (invalid credentials, network failure). On session expiry, redirect to login.

**Rules:**
- Row-Level Security (RLS) policies on all tables enforce role permissions at the database level
- Designer can only read their own drafts + all approved items
- Admin can read and write everything
- RLS policies are defined directly in Supabase SQL migrations, not in application code

---

## 2. Supabase Storage

**Purpose:** Store and serve images and 3D files.

**Buckets:**

| Bucket | Contents | Access |
|---|---|---|
| `original-images` | Designer-uploaded product photos (1+ per variant, stored as `original_image_urls[]`) | Authenticated users |
| `glb-models` | TRELLIS-generated .glb 3D model files (not produced for flat items) | Authenticated users |
| `sprites` | Rendered isometric sprite images (4 per variant) | Public (for canvas rendering performance) |
| `textures` | Designer-uploaded custom finish textures | Authenticated users |
| `thumbnails` | Project thumbnail previews | Authenticated users |

**Send:** File binary + target path
**Get back:** Public URL or signed URL
**Where it goes:** URLs appended to `furniture_variants.original_image_urls[]` (for source photos), stored in `furniture_variants.glb_path` (for .glb files), or `furniture_sprites.image_path` (for sprites).
**Error handling:** Retry upload once. On persistent failure, set relevant status to `failed` and notify the designer via toast.

---

## 3. Product Link Scraping

**Purpose:** Extract product details from a Shopee or IKEA product URL.

**Triggered by:** Designer pastes a product link in the Add Furniture modal.

**Send:** Product URL + source domain
**Get back (desired data):**

| Field | Required | Notes |
|---|---|---|
| Product name | Yes | Used as default, designer can override |
| Description | No | Product description text |
| Price (THB) | No | Current price — may not be available for all sources |
| Width, Depth, Height (cm) | No | Dimensions — often missing, designer fills manually |

**Where it goes:** `furniture_items` table (name, description, dimensions) and/or `furniture_variants` table (price, if variant-specific link provided)

**Important:** The scraper only extracts text data. Product images are uploaded manually by the designer — the scraper does NOT download images from the listing.

**Supported sources (MVP):**
- `shopee.co.th` — Shopee Thailand product pages
- `ikea.com` — IKEA product pages (any region)

**Error handling:**
- Unsupported domain → reject immediately, notify designer
- Page not found / 404 → notify designer to re-check the link
- Scrape returns partial data → save what was found, flag missing fields for designer to fill manually
- Anti-bot blocking → retry once with delay, if still blocked, notify designer and accept manual entry of all fields

**Designer-provided context:** The designer can optionally provide additional details (name override, price, dimensions) alongside the link. If provided, these take priority over scraped values and help the scraper validate its results.

---

## 4. Replicate API — TRELLIS (Multi-Image)

**Purpose:** Generate a 3D model (.glb) from one or more designer-uploaded product photos. TRELLIS does its own internal background removal — there is no separate rembg step.

**Triggered by:** Variant row is created with at least one image in `original_image_urls[]` AND the item is not flat (neither `categories.is_flat` nor `items.is_flat_override` is true). For flat items this step is skipped entirely — see "Flat-item bypass" below.

**API endpoint:** Replicate API (`firtoz/trellis` model)

**Send:**

| Parameter | Value |
|---|---|
| `images` | Array of signed URLs for each file in `original_image_urls[]` (Supabase Storage signed URLs, 10 min TTL) |
| `texture_size` | 1024 |
| `mesh_simplify` | 0.95 |
| `generate_model` | true |

**Why multi-image:** Multi-image input is the single biggest lever on .glb quality. Designers are encouraged to upload 2–4 clean product-page angle shots (front, 3/4, side) when available. For messy source photos, the recommended pre-processing is Nano Banana (Google Gemini) — see `designer-workflow.md`.

**Get back:** .glb file (3D model with textures)

**Where it goes:**
- .glb file saved to `glb-models` bucket in Supabase Storage
- `furniture_variants.glb_path` updated with the storage path
- `furniture_variants.render_status` stays `processing` until sprite rendering (step 5) completes
- Designer reviews the .glb via `ModelApprovalModal` and sets `render_approval_status` to `approved` / `rejected`; `retryRender` re-runs this step with the same images.

**Cost:** ~$0.05 per run (single call regardless of image count)

**Error handling:**
- Replicate API timeout → mark `render_status='failed'`; designer can retry via `retryRender`.
- Model generation fails → `render_status='failed'`.
- Designer rejects the .glb → `render_approval_status='rejected'`; designer can re-upload better photos and retry (no auto-retry on the same images).

**Flat-item bypass:** When the effective `is_flat` is true, the variant skips this step entirely. `render_status` is set to `completed` and `render_approval_status` to `approved` at variant creation time. The first uploaded image serves as the canvas asset; no .glb is produced, no TRELLIS cost is incurred.

---

## 5. Daily Link Recheck

**Purpose:** Verify that product source URLs are still active and prices haven't changed significantly.

**Triggered by:** Scheduled Supabase Edge Function — daily at 3:00 AM Bangkok time (UTC+7).

**Process:**
1. Query `furniture_variants` ordered by `last_checked_at` ASC (oldest checked first)
2. Pick a batch (configurable, start with ~100 per run)
3. For each variant, check the source URL (variant's own `source_url`, or parent item's `source_url` if variant's is null)

**Send:** HTTP HEAD or GET request to the product URL
**Check for:**

| Check | Result |
|---|---|
| Page returns 200 + product still listed | `link_status` → `active`, update `last_checked_at` |
| Page returns 404 or product delisted | `link_status` → `inactive`, update `last_checked_at` |
| Price on page differs from stored `price_thb` | Update `price_thb`, set `price_changed` → `true` if change exceeds 20% |
| Request times out or is blocked | Skip, try again next cycle |

**Where it goes:** Updates `furniture_variants` fields: `link_status`, `last_checked_at`, `price_thb`, `price_changed`

**Error handling:** Network errors or anti-bot blocks → skip the item, do not mark as inactive. It will be retried in the next cycle. Only mark as `inactive` when the page clearly returns a 404 or the product is confirmed delisted.

**Admin visibility:** Admin dashboard surfaces a list of newly flagged items (inactive links, significant price changes) for review.

---

## 6. Export Canvas View

**Purpose:** Capture the designer's current camera angle on the live 3D canvas as a 4K PNG and trigger a browser download. Used to share a specific view with a client (email, LINE, proposal PDF) without a screen capture tool.

**Triggered by:** Designer clicks the floating "Export view" button at the canvas's bottom-right.

**How it works:**
1. Read current renderer drawingBuffer dimensions + pixel ratio.
2. Temporarily `renderer.setSize(3840, height, /* updateStyle */ false)` — drawingBuffer bumps to 4K while the CSS display size is unchanged (the browser keeps scaling the canvas into its box, so the high-res frame is visually invisible).
3. `renderer.render(scene, camera)` — one frame at 4K.
4. `canvas.toBlob()` → PNG.
5. Synthesize an `<a download>` click to trigger the browser download.
6. Restore the original `setSize` + pixelRatio and render once more so the next animate-loop frame is already at normal res.

**Rendered by:** The live canvas's own `WebGLRenderer` — no separate scene build, no `.glb` reload. Everything visible in the designer's viewport (lighting, shadows, placed fixtures, ceiling-light emissives, etc.) is in the export.

**Output:** PNG file, 3840 wide, height = 3840 / current aspect ratio. Filename: `{project}_{room}_{YYYYMMDD_HHmm}.png`.

**Implementation:** `src/lib/exportCanvasView.ts` (helper) + button in `src/components/editor/RoomCanvas/index.tsx`.

**Availability:** Design mode only. Hidden in roam mode — first-person captures are typically weirdly framed; designers swap to design mode if they want to export.

**Not persisted:** no DB column, no storage upload. Exports are ephemeral files owned by the designer's machine. (The old `rooms.preview_image_url` column was dropped in migration `20260428000000_drop_room_preview_image.sql`.)

**Error handling:** If any Three.js ref is missing (shouldn't happen in practice — canvas must be mounted for the button to exist) the function silently returns.

---

## 7. 3D Canvas Rendering (Live Editor)

**Purpose:** The interactive room canvas designers work on. Renders the room shell + all placed furniture in real time, handles placement/drag/rotate/delete, edit-shape mode, and switches between design (orbit camera) and roam (first-person WASD) views.

**Runs on:** Client-side (browser, Three.js) — implemented in `src/components/editor/RoomCanvas.tsx` with helpers in `src/lib/roomScene.ts`.

**Triggered by:** `EditorPage` mount when a room is selected. Persists across sessions and re-renders reactively as state changes.

**Scene layers:**
- **Shell layer** — floor, walls, ceiling, lighting. Built once per room/finish change. Walls render `THREE.FrontSide` in design mode (dollhouse — near walls cull so camera sees in) and `THREE.DoubleSide` in roam mode. Ceiling hidden in design mode.
- **Furniture layer** — placed items as cloned `.glb` groups. Cached per `glb_path` (single parse/download). Materials are deep-cloned on each instance so per-instance transparency tweaks (ghost preview) don't leak into shared state. Flat items render as textured floor planes; missing `.glb` falls back to a translucent teal box.
- **Handle layer** — vertex sphere + midpoint ring handles when `shapeEditMode` is on.
- **World grid** — 1m majors + 50cm minors, toggled via `useUIStore.canvasGrid` (persisted to localStorage).

**Camera modes:**
- **Design** (default) — `OrbitControls`, mouse-drag rotates, wheel zooms, right-drag pans. Pitch clamped [5%, 48%] of π so camera can't clip through floor/ceiling. NW/NE/SE/SW preset buttons reposition to room corners.
- **Roam** — `PointerLockControls` + WASD, 160cm eye height, Shift sprints. Cursor locked; Esc exits. Camera is clamped inside room polygon to prevent walking through walls.

**Interactions:**
- Click-to-place: raycast against Y=0 plane, snap to effective block grid (50cm big / 25cm small, `src/lib/blockGrid.ts`). Ghost preview follows cursor.
- Drag-to-move: same snap; Ctrl/Cmd bypasses snap; clamp to room polygon via `nearestPointOnPolygon`.
- Rotate: scroll-wheel on selected item, 15° snap (1° with Ctrl). Debounced into a single undo command per gesture.
- Edit shape: drag vertex sphere, click midpoint ring to insert, click wall to push/pull perpendicular. 10cm snap. Delete removes selected vertex (min 3).

**Performance:**
- Shell layer rebuilds only when room/finishes/camera-mode change — furniture stays loaded.
- Furniture layer uses a signature (variant id + dims + flat flag + scale) to rebuild only on meaningful changes; position/rotation updates mutate in place.
- `.glb` downloads cached in-memory per path.

---

## Pipeline Summary

The full flow from "designer uploads screenshot" to "3D model approved":

```
Designer uploads product screenshot + details
  │
  ▼
[3. Extract] ── text data ──► furniture_items
  │
  │  Designer uploads 1+ product photos per variant
  ▼
furniture_variants created with original_image_urls[]
  │
  ├──── is_flat? ────► skip TRELLIS:
  │                    render_status=completed,
  │                    render_approval_status=approved,
  │                    first image serves as canvas asset
  │
  ▼ (non-flat items)
[4. TRELLIS] ── multi-image → .glb ──► Supabase Storage + variant.glb_path
  │
  ▼
[5. Three.js] ── 4 sprites ──► Supabase Storage + furniture_sprites rows
  │                             variant.render_status = completed
  ▼
Designer reviews .glb in ModelApprovalModal:
  - Approve: render_approval_status=approved
  - Reject:  render_approval_status=rejected
  - Retry:   re-run TRELLIS with same images
```

The approval gate does not block canvas placement — the first uploaded photo serves as a placeholder while the pipeline runs, and the item is usable even if approval stays pending. The badge is purely a quality signal.
