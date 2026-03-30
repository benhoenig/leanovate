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
| 2 | Supabase Storage | Client + Edge Functions | Image uploads, sprite storage, .glb storage |
| 3 | Product Link Scraping | Supabase Edge Function | Designer submits a product link |
| 4 | rembg (Background Removal) | Supabase Edge Function | After scrape succeeds, for each uploaded variant image |
| 5 | Replicate API — TRELLIS | Supabase Edge Function | After designer approves a clean image |
| 6 | Three.js Sprite Rendering | Client (browser) | After TRELLIS returns a .glb file |
| 7 | Daily Link Recheck | Supabase Edge Function (scheduled) | Daily cron (3:00 AM Bangkok time) |
| 8 | Room Perspective Preview | Supabase Edge Function or render service | Designer clicks "Preview Room" |

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
| `original-images` | Designer-uploaded product photos (before rembg) | Authenticated users |
| `clean-images` | Background-removed images (after rembg) | Authenticated users |
| `glb-models` | TRELLIS-generated .glb 3D model files | Authenticated users |
| `sprites` | Rendered isometric sprite images (4 per variant) | Public (for canvas rendering performance) |
| `textures` | Designer-uploaded custom finish textures | Authenticated users |
| `thumbnails` | Project thumbnail previews | Authenticated users |

**Send:** File binary + target path
**Get back:** Public URL or signed URL
**Where it goes:** URL stored in the relevant `furniture_variants` column (`original_image_url`, `clean_image_url`, `glb_path`) or `furniture_sprites.image_path`
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

## 4. rembg (Background Removal)

**Purpose:** Remove background from a product photo, producing a clean transparent-background image.

**Triggered by:** Designer uploads a color variant image.

**Send:** Original product photo (PNG/JPEG from Supabase Storage)
**Get back:** Clean image with transparent background (PNG)
**Where it goes:**
- Image saved to `clean-images` bucket in Supabase Storage
- `furniture_variants.clean_image_url` updated with the storage path
- `furniture_variants.image_status` updated: `processing` → `pending_approval`

**Error handling:** On failure, set `image_status` to `processing` (retry) or notify designer to upload a different photo. Do not proceed to TRELLIS.

**Hard gate:** After rembg completes, the designer MUST review and approve the clean image before the pipeline continues. See product-spec.md user story #14.

---

## 5. Replicate API — TRELLIS

**Purpose:** Generate a 3D model (.glb) from a background-removed product photo.

**Triggered by:** Designer approves a clean image (`image_status` → `approved`).

**API endpoint:** Replicate API (`firtoz/trellis` model)

**Send:**

| Parameter | Value |
|---|---|
| `image` | Clean image URL (from Supabase Storage `clean-images` bucket) |
| `texture_size` | 1024 (default — balance of quality and speed) |
| `mesh_simplify` | 0.95 (default) |
| `generate_model` | true |

**Get back:** .glb file (3D model with textures)

**Where it goes:**
- .glb file saved to `glb-models` bucket in Supabase Storage
- `furniture_variants.glb_path` updated with the storage path
- `furniture_variants.render_status` updated: `waiting` → `processing`
- Pipeline continues to Three.js rendering (step 6)

**Cost:** ~$0.05 per run

**Error handling:**
- Replicate API timeout → retry once
- Model generation fails → set `render_status` to `failed`, notify designer
- Do NOT auto-retry more than once — bad input images won't produce better results on retry

---

## 6. Three.js Sprite Rendering (Client-Side)

**Purpose:** Render 4 isometric sprite images from a .glb 3D model file.

**Runs on:** Client-side (browser) — implemented in `src/lib/renderSprites.ts`

**Triggered by:** `generate-3d-model` Edge Function returns successfully. The client's `approveImage` flow calls `renderSprites()` after confirming `glb_path` is set.

**Send:** variant ID + .glb file path from Supabase Storage
**Process:**
1. Download .glb from `glb-models` bucket
2. Create offscreen 512×512 canvas (not attached to DOM)
3. Set up Three.js: WebGLRenderer, Scene, OrthographicCamera (size 1.8), lighting
4. Load .glb with GLTFLoader, center + normalize to 2-unit cube
5. Render 4 views:

| Direction | Azimuth | Elevation |
|---|---|---|
| `front_left` | 225° | 35.264° |
| `front_right` | 315° | 35.264° |
| `back_left` | 135° | 35.264° |
| `back_right` | 45° | 35.264° |

6. Export each as PNG blob via `canvas.toBlob()`
7. Upload 4 PNGs to `sprites` bucket
8. Upsert 4 `furniture_sprites` rows

**Get back:** 4 PNG images (transparent background, 512×512px)

**Where it goes:**
- 4 images saved to `sprites` bucket in Supabase Storage
- 4 rows upserted in `furniture_sprites` table (one per direction)
- `furniture_variants.render_status` updated: `processing` → `completed`

**Rendering specs:**
- OrthographicCamera with true isometric projection (35.264° elevation)
- Transparent background (alpha: true, clearColor 0x000000 at opacity 0)
- 512×512px output size
- Lighting: ambient 0.6 white + directional 1.2 warm (5,10,7) + fill 0.4 cool (-5,3,-5)

**Why client-side:** Server-side rendering via Supabase Edge Functions (Deno) failed because headless canvas libraries (`npm:canvas`) require native binaries unavailable in Edge Functions. Browser WebGL rendering works reliably.

**Error handling:** On render failure, set `render_status` to `failed`. Designer can retry (which re-runs from TRELLIS or just re-renders from existing .glb if it exists).

---

## 7. Daily Link Recheck

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

## 8. Room Perspective Preview

**Purpose:** Render eye-level interior vignettes — realistic 3D perspective images of the current room, showing all placed furniture, room geometry (walls with door/window cutouts), and finishes. User can select which wall to view from via wall selector buttons. Used for client presentations.

**Triggered by:** Designer clicks "Preview Room" button and selects a wall from the wall selector.

**Send:**
- Room geometry (walls, floor, ceiling dimensions from `rooms` table)
- Room finishes (wall color/material, floor material, door style, window style)
- All placed furniture in the room: .glb file paths + positions + directions + selected variant
- Camera wall index: which wall segment the camera stands at (0 to N-1, user-selected)

**Rendered by:** Three.js client-side (browser) — implemented in `src/lib/renderRoomPreview.ts`

**Get back:** Single PNG image (1920×1080) — eye-level interior vignette with realistic lighting

**Where it goes:** Displayed in a modal overlay (`RoomPreviewModal.tsx`) with wall selector buttons at top. User can download as PNG or save to `thumbnails` bucket in Supabase Storage, URL stored in `rooms.preview_image_url`.

**Wall selector:**
- N buttons (one per wall segment from `getVertices(room).length`), labeled "Wall 1", "Wall 2", etc.
- Each button triggers a new render from that wall's perspective
- Active button: primary brand gradient, white text. Inactive: outline style.
- Disabled during rendering (loading spinner shown)

**Rendering specs:**
- PerspectiveCamera (FOV 70°) at 160cm eye height, positioned 0.4m inward from selected wall midpoint, looking perpendicular across the room
- Room shell: floor (ShapeGeometry from polygon vertices), walls (PlaneGeometry or ShapeGeometry with door/window cutouts), ceiling
- Doors: rectangular cutout holes in walls + brown door panel meshes (MeshStandardMaterial)
- Windows: rectangular cutout holes + semi-transparent glass panes (opacity 0.3) + grey frame borders
- All placed .glb models loaded via GLTFLoader, positioned at (u, 0, v), scaled by declared dimensions, rotated by direction
- Lighting: ambient 0.5 white + warm directional sun (1.0) + cool fill light (0.3) + warm point light at ceiling centroid (0.4)
- Output: 1920×1080 PNG, horizontally mirrored to correct Three.js camera handedness for CCW-wound rooms
- All materials use `DoubleSide` rendering

**Render time:** Approximately 3–10 seconds depending on number of furniture pieces and .glb model complexity.

**Error handling:** On failure (e.g. missing .glb files for some furniture), render what's available and show a warning banner: "X item(s) could not be rendered (missing 3D models)."

**Post-MVP upgrade path:** Replace wall selector with free camera controls or add interactive 3D walkthrough (full Three.js scene in browser).

---

## Pipeline Summary

The full flow from "designer pastes a link" to "sprites ready on canvas":

```
Designer pastes link
  │
  ▼
[3. Scrape] ──── text data ────► furniture_items + furniture_variants
  │
  │  Designer uploads variant images
  ▼
[4. rembg] ──── clean image ────► Supabase Storage + variant.clean_image_url
  │
  │  Designer approves clean image (HARD GATE)
  ▼
[5. TRELLIS] ──── .glb file ────► Supabase Storage + variant.glb_path
  │
  ▼
[6. Three.js] ──── 4 sprites ────► Supabase Storage + furniture_sprites rows
  │
  ▼
variant.render_status = completed
Sprites replace placeholder on canvas
```

Each step is independent and async. Failure at any step does not block previous steps. The designer can use the item on canvas with the original photo at any point after uploading.
