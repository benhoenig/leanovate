# Database Schema — LEANOVATE

> **Document scope:** Supabase (PostgreSQL) table structures, fields, relationships, and data design decisions.
>
> **Out of scope (covered in other docs):**
>
> | File | Owns |
> |---|---|
> | `product-spec.md` | App name, problem statement, target users, MVP vs post-MVP features, user stories, success metrics |
> | `tech-stack.md` | Technology choices, libraries, versions, rationale, folder structure |
> | `design.md` | Visual system — colors, typography, component styling |
> | `state-map.md` | Zustand store breakdown and state ownership |
> | `implementation-plan.md` | Build order, phases, and timeline |
> | `integration-contracts.md` | Shopee Affiliate API, Supabase auth, external service shapes |

---

## Design Principles

1. **Parent + Variants model** — Each furniture product has a parent record (shared name, category, dimensions) and one or more color variants (each with its own images, price, link, .glb, and sprites). This mirrors how real products work on Shopee/IKEA.

   **Flat-item bypass:** Categories can be flagged as `is_flat` (e.g. Rug) — flat items skip TRELLIS entirely and use the uploaded image directly as the canvas asset. Individual items can override this with `is_flat_override`.

2. **Live calculation, not stored snapshots** — Cost summaries are calculated on the fly from current variant prices + manually entered renovation costs. No stale price snapshots. Staleness alerts handle the case where prices change between visits.

3. **JSON for geometry, relational for everything else** — Room geometry (walls, doors, windows) and template snapshots are stored as JSON because they're consumed as single blobs. Everything with relationships (items, variants, sprites, categories) uses proper relational tables.

4. **Two approval workflows** — (a) Render approval: after TRELLIS generates a .glb, designer reviews the 3D model in a spinning preview and approves/rejects/retries it (post-TRELLIS gate, replaces the pre-TRELLIS rembg gate from V1). Variants are usable on the canvas with the uploaded photo as placeholder while approval is pending. (b) Catalog approval: admin reviews designer-submitted items before they enter the shared catalog.

5. **Supabase Row-Level Security (RLS)** — All tables use RLS policies. Designers can only see their own draft items + all approved items. Admins see everything. Detailed RLS rules are defined in `integration-contracts.md`.

---

## Enums

The following enums are used across multiple tables:

```sql
-- User roles
CREATE TYPE user_role AS ENUM ('admin', 'designer');

-- Furniture item catalog status
CREATE TYPE item_status AS ENUM ('draft', 'pending', 'approved', 'rejected');

-- AI rendering pipeline status
CREATE TYPE render_status AS ENUM ('waiting', 'processing', 'completed', 'failed');

-- Designer approval of the generated 3D model (post-TRELLIS gate)
CREATE TYPE render_approval_status AS ENUM ('pending', 'approved', 'rejected');

-- Furniture placement grid size (big = 50 cm, small = 25 cm — see src/lib/blockGrid.ts)
CREATE TYPE block_size AS ENUM ('big', 'small');

-- Link health status (daily recheck)
CREATE TYPE link_status AS ENUM ('active', 'inactive', 'unchecked');

-- Project status
CREATE TYPE project_status AS ENUM ('draft', 'completed');

-- Finish material types
CREATE TYPE finish_type AS ENUM ('wall', 'floor', 'door', 'window', 'lighting');

-- Orientation of a flat-item plane. 'horizontal' = rug-style on the floor,
-- 'vertical' = upright plane (picture frames, wall art).
CREATE TYPE flat_orientation AS ENUM ('horizontal', 'vertical');

-- Visibility scope for designer-uploaded art images used inside picture frames.
-- 'private' = only the uploader, 'team' = everyone on the team.
CREATE TYPE art_scope AS ENUM ('private', 'team');

-- How items in a category attach to the room. 'floor' = normal X/Z grid
-- placement (Y=0). 'wall' = door/window (uses wall_index + position, Y
-- derived from wall height). 'ceiling' = ceiling light (X/Z grid, Y auto-
-- snaps to room.ceiling_height_cm at placement).
CREATE TYPE mount_type AS ENUM ('floor', 'wall', 'ceiling');
```

---

## Tables

### Auth & Team

#### profiles

Extends Supabase's built-in `auth.users`. Created automatically when a user signs up.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | uuid | PK, FK → auth.users.id | Matches the Supabase auth user ID |
| role | user_role | NOT NULL, default 'designer' | Controls permissions throughout the app |
| display_name | text | NOT NULL | Shown in UI and project ownership |
| avatar_url | text | nullable | Profile picture URL |
| created_at | timestamptz | NOT NULL, default now() | |

---

### Projects

#### projects

One project = one design proposal for a specific condo unit.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | uuid | PK, default gen_random_uuid() | |
| owner_id | uuid | FK → profiles.id, NOT NULL | Designer who created it |
| name | text | NOT NULL | e.g. "Unit 1204 — Ideo Mobi Sukhumvit" |
| description | text | nullable | Internal notes |
| status | project_status | NOT NULL, default 'draft' | |
| unit_width_cm | integer | NOT NULL | Overall unit width in centimeters |
| unit_height_cm | integer | NOT NULL | Overall unit depth in centimeters |
| manual_costs | jsonb | NOT NULL, default '{}' | Manually entered costs: renovation estimates, finish costs, labor, etc. Structured as key-value pairs e.g. `{ "renovation": 50000, "flooring": 25000, "painting": 10000 }` |
| created_at | timestamptz | NOT NULL, default now() | |
| updated_at | timestamptz | NOT NULL, default now() | Auto-updated via trigger |

**Indexes:** `owner_id`, `status`

#### rooms

Individual rooms within a project's unit.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | uuid | PK, default gen_random_uuid() | |
| project_id | uuid | FK → projects.id ON DELETE CASCADE, NOT NULL | Which project this room belongs to |
| name | text | NOT NULL | e.g. "Living Room", "Bedroom 1", "Kitchen" |
| x | float | NOT NULL | Position within the unit layout (horizontal) |
| y | float | NOT NULL | Position within the unit layout (vertical) |
| width_cm | integer | NOT NULL | Room width |
| height_cm | integer | NOT NULL | Room depth |
| geometry | jsonb | NOT NULL, default '{}' | Wall segments, door positions, window positions. Consumed by PixiJS canvas as one object. Structure: `{ "walls": [...], "doors": [...], "windows": [...] }` |
| finishes | jsonb | NOT NULL, default '{}' | Current finish selections. Only wall + floor now: `{ "material_id": "uuid", "custom_url": null }`. Door/window/lighting entries are no longer written — those are all placed fixtures (ceiling lights via `furniture_categories.emits_light` + `placed_furniture.light_settings`; doors/windows via `rooms.geometry.doors[]/windows[]`). |
| sort_order | integer | NOT NULL, default 0 | Display order in the room list |
| created_at | timestamptz | NOT NULL, default now() | |

**Indexes:** `project_id`

---

### Furniture Catalog

#### furniture_categories

Top-level groupings for the furniture catalog.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | uuid | PK, default gen_random_uuid() | |
| name | text | NOT NULL, UNIQUE | e.g. "Sofa", "Bed", "Dining Table", "TV Stand", "Lamp", "Wardrobe" |
| icon | text | nullable | Icon identifier for UI display |
| sort_order | integer | NOT NULL, default 0 | Display order in catalog browser |
| is_flat | boolean | NOT NULL, default false | If true, items in this category skip TRELLIS entirely — the first uploaded image is used directly as the canvas asset. Seeded true for `Rug`, `Picture Frame`. |
| default_block_size | block_size | NOT NULL, default 'big' | Grid size for furniture placement snap. Seeded Small for Chair, Lamp, Side Table, Coffee Table, Picture Frame; Big for everything else. See `src/lib/blockGrid.ts`. |
| flat_orientation | flat_orientation | NOT NULL, default 'horizontal' | Only read when `is_flat=true`. 'horizontal' = rug-style plane laid on the floor. 'vertical' = upright plane (picture frames, wall art). Seeded 'vertical' for `Picture Frame`. |
| accepts_art | boolean | NOT NULL, default false | If true, items in this category are picture-frame style — the designer picks art from the art library to fill the mat opening. Seeded true for `Picture Frame`. |
| mount_type | mount_type | NOT NULL, default 'floor' | `'floor'` = normal furniture (X/Z grid). `'wall'` = door/window (wall_index + position). `'ceiling'` = ceiling light (X/Z grid, Y auto-snaps to `room.ceiling_height_cm` at placement). Seeded `'ceiling'` for `Ceiling Light`. |
| emits_light | boolean | NOT NULL, default false | If true, placed items attach a Three.js light (SpotLight for `mount_type='ceiling'`, PointLight otherwise) driven by `placed_furniture.light_settings`. Implies TRELLIS bypass (fixture mesh is procedural). Seeded true for `Ceiling Light`. |

#### styles

Design style tags used for filtering and template auto-generation.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | uuid | PK, default gen_random_uuid() | |
| name | text | NOT NULL, UNIQUE | e.g. "Modern", "Minimal", "Japandi", "Scandinavian", "Luxury", "Mid-Century" |
| sort_order | integer | NOT NULL, default 0 | Display order in style picker |

#### furniture_items

The parent product record. Holds shared details — no color-specific data. Each item has one or more `furniture_variants`.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | uuid | PK, default gen_random_uuid() | |
| name | text | NOT NULL | Product name (scraped from link, designer can override) |
| category_id | uuid | FK → furniture_categories.id, NOT NULL | Which category |
| source_url | text | NOT NULL | Primary product link (Shopee, IKEA, etc.) |
| source_domain | text | NOT NULL | e.g. "shopee.co.th", "ikea.com" — extracted from source_url |
| width_cm | integer | nullable | Default physical width (variants can override) |
| depth_cm | integer | nullable | Default physical depth |
| height_cm | integer | nullable | Default physical height |
| description | text | nullable | Product description (scraped, designer can override) |
| status | item_status | NOT NULL, default 'draft' | draft = personal only, pending = submitted for review, approved = in shared catalog, rejected = admin declined |
| is_flat_override | boolean | nullable | Per-item override of `category.is_flat`. Null = inherit from category. Lets designers flag a thin/flat item (e.g. a thin headboard) that falls in a non-flat category. |
| block_size_override | block_size | nullable | Per-item override of `category.default_block_size`. Null = inherit. |
| mat_opening_cm | jsonb | nullable | Inner mat rectangle (visible art area) for picture-frame items. Shape: `{ "w": number, "h": number }` in cm. Required at the application layer when the item's category has `accepts_art=true` (enforced in `AddFurnitureModal`). Null for non-frame items. |
| submitted_by | uuid | FK → profiles.id, NOT NULL | Designer who added this item |
| reviewed_by | uuid | FK → profiles.id, nullable | Admin who approved/rejected |
| reviewed_at | timestamptz | nullable | When the review happened |
| hidden_at | timestamptz | nullable | Set when the item is hidden from the default catalog view. Reversible (unhide clears to null). Hidden items remain referenceable — existing `placed_furniture` instances keep rendering; only the catalog grid filters them out. |
| hidden_by | uuid | FK → profiles.id, nullable | Who hid the item. Paired with `hidden_at`. |
| created_at | timestamptz | NOT NULL, default now() | |
| updated_at | timestamptz | NOT NULL, default now() | Auto-updated via trigger |

**Indexes:** `category_id`, `submitted_by`, `status`, `hidden_at`

**Hide/delete behaviour:** admins can hide or hard-delete any item; designers can hide or hard-delete their own `draft`/`rejected` items (RLS). Hard delete is blocked at the FK level when any `placed_furniture` row references the item — the store surfaces a clearer error and steers the user to Hide instead. Cascade deletes wipe variants and style tags.

#### furniture_item_styles

Many-to-many join table: which styles a furniture item belongs to. Used by the style template auto-generation to select products matching a chosen style.

| Column | Type | Constraints | Description |
|---|---|---|---|
| furniture_item_id | uuid | FK → furniture_items.id ON DELETE CASCADE | |
| style_id | uuid | FK → styles.id ON DELETE CASCADE | |
| | | PK (furniture_item_id, style_id) | Composite primary key |

#### furniture_variants

Color/material variants of a parent furniture item. Each variant has its own image, price, link, .glb 3D model, and sprites.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | uuid | PK, default gen_random_uuid() | |
| furniture_item_id | uuid | FK → furniture_items.id ON DELETE CASCADE, NOT NULL | Parent product |
| color_name | text | NOT NULL | e.g. "Navy Blue", "Oak Natural", "Matte Black" |
| price_thb | decimal | nullable | Variant-specific price in Thai Baht. Null = no price available |
| source_url | text | nullable | Variant-specific link. Null = inherit parent's source_url |
| width_cm | integer | nullable | Override parent dimensions if this variant differs in size |
| depth_cm | integer | nullable | |
| height_cm | integer | nullable | |
| original_image_urls | text[] | NOT NULL, default ARRAY[]::text[] | Designer-uploaded product photos. 1+ images per variant — first image is the primary/fallback. Multiple images improve TRELLIS output quality significantly. |
| glb_path | text | nullable | Path to TRELLIS-generated .glb file in Supabase Storage. Null for flat items (bypass). Null until TRELLIS completes for non-flat items. |
| thumbnail_path | text | nullable | Cached isometric snapshot PNG in Supabase Storage (`thumbnails` bucket, `variants/{variant_id}.png`). Used as the catalog tile image so the left sidebar reads as a buy-mode catalog instead of a metadata list. Null for flat items (tile uses `original_image_urls[0]`) and for legacy/unrendered variants (lazily backfilled client-side when the catalog mounts). |
| render_status | render_status | NOT NULL, default 'waiting' | waiting = pipeline queued, processing = TRELLIS/Three.js running, completed = ready (flat items: completed immediately with no .glb), failed = generation failed |
| render_approval_status | render_approval_status | NOT NULL, default 'pending' | Post-TRELLIS designer gate. pending = awaiting review, approved = designer confirmed the 3D model is good, rejected = designer flagged it as bad. Flat items default to 'approved' (no .glb to review). |
| link_status | link_status | NOT NULL, default 'unchecked' | For daily link validity recheck. Checked against variant's source_url (or parent's if null) |
| last_checked_at | timestamptz | nullable | Last time the link was verified by the daily recheck job |
| price_changed | boolean | NOT NULL, default false | Flagged true if daily recheck detected a significant price change (>20% threshold). Reset to false when designer acknowledges |
| sort_order | integer | NOT NULL, default 0 | Display order among variants of the same parent |
| created_at | timestamptz | NOT NULL, default now() | |
| updated_at | timestamptz | NOT NULL, default now() | Auto-updated via trigger |

**Indexes:** `furniture_item_id`, `render_status`, `render_approval_status`, `link_status`

#### ~~furniture_sprites~~ (dropped Phase 8a)

In V1 this table held 4 isometric sprite PNGs per variant (one per direction).
Phase 8 rebuilt the canvas in Three.js and renders `.glb` files directly, so
sprites are obsolete. The table was dropped in migration `20260420010000_phase8a_canvas_data_model.sql`.
The `direction` enum it depended on was also dropped.

---

### Placed Furniture (in projects)

#### placed_furniture

Instances of furniture items placed in a room. Coordinates are room-local cm.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | uuid | PK, default gen_random_uuid() | |
| room_id | uuid | FK → rooms.id ON DELETE CASCADE, NOT NULL | Which room |
| furniture_item_id | uuid | FK → furniture_items.id, NOT NULL | Which parent product |
| selected_variant_id | uuid | FK → furniture_variants.id, NOT NULL | Which color variant is currently shown on canvas |
| x_cm | float | NOT NULL | Horizontal position in room-local cm (world X in Three.js scene) |
| y_cm | float | NOT NULL, default 0 | Vertical offset in cm. 0 = floor; non-zero = wall-mounted (art, mirrors, wall shelves) |
| z_cm | float | NOT NULL | Depth position in room-local cm (world Z in Three.js scene; Y is up) |
| rotation_deg | float | NOT NULL, default 0 | Rotation around vertical axis in degrees (0–360). Replaces the V1 4-direction enum. |
| price_at_placement | decimal | nullable | The variant's price when placed. Compared against live price to trigger staleness alerts |
| scale_factor | float | NOT NULL, default 1 | Per-instance size multiplier applied on top of variant dimensions |
| sort_order | integer | NOT NULL, default 0 | Not used by the 3D canvas (retained for backwards compat) |
| art_id | uuid | FK → art_library.id ON DELETE SET NULL, nullable | Art image rendered inside the frame's mat. Only meaningful for picture-frame items (category.accepts_art = true). Null = empty frame (shows just the frame product photo with the grey/white mat visible). On art deletion the frame silently reverts to empty instead of orphaning the reference. |
| light_settings | jsonb | nullable | Per-instance lighting settings for items whose `category.emits_light = true`. Shape: `{ "enabled": bool, "preset": "warm\|neutral\|cool\|custom", "temperature_k": int 2200–6500, "intensity": float 0–1 }`. Null → renderer falls back to warm defaults (2700K, 70%). Moving a slider flips `preset → 'custom'` but keeps the values; the "Off" preset sets `enabled=false`. |
| created_at | timestamptz | NOT NULL, default now() | |

**Indexes:** `room_id`, `furniture_item_id`

**Staleness alert logic:** When a project is opened, the app compares `price_at_placement` against the selected variant's current `price_thb`. If they differ, a price change alert is shown to the designer with the old vs new price. The designer can acknowledge the change (which updates `price_at_placement` to the new price) or swap the item.

---

### Finish Materials

#### finish_materials

Preset palette of wall colors, floor materials, door styles, window styles, and lighting fixtures.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | uuid | PK, default gen_random_uuid() | |
| type | finish_type | NOT NULL | wall, floor, door, window, lighting |
| name | text | NOT NULL | e.g. "Oak Wood Flooring", "Matte White Paint", "Sliding Glass Door" |
| thumbnail_path | text | NOT NULL | Preview image in Supabase Storage |
| is_custom | boolean | NOT NULL, default false | true = uploaded by a designer, false = preset |
| uploaded_by | uuid | FK → profiles.id, nullable | Only set if is_custom = true |
| created_at | timestamptz | NOT NULL, default now() | |

**Indexes:** `type`, `is_custom`

---

### Art Library

#### art_library

Designer-uploaded images used as the art inside picture-frame items. Each row is either private to the uploader or shared team-wide (opt-in via the designer, no admin approval). Referenced from `placed_furniture.art_id`.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | uuid | PK, default gen_random_uuid() | |
| uploaded_by | uuid | FK → profiles.id ON DELETE CASCADE, NOT NULL | Designer who uploaded the image |
| name | text | NOT NULL | Designer-friendly label. Defaults to the filename (minus extension) on upload |
| image_path | text | NOT NULL | Path within the `frame-art` storage bucket (e.g. `{uploader_id}/{uuid}.jpg`) |
| aspect_ratio | float | NOT NULL | width / height, measured at upload time from the decoded image. Used by the frame picker to filter art that fits a given mat opening (±10% tolerance) |
| scope | art_scope | NOT NULL, default 'private' | 'private' = only the uploader sees it in their picker. 'team' = visible to everyone. The designer flips this freely; there is no admin approval gate for v1 |
| created_at | timestamptz | NOT NULL, default now() | |
| updated_at | timestamptz | NOT NULL, default now() | Auto-updated via trigger |

**Indexes:** `uploaded_by`, `scope`

**RLS:** Users SELECT rows where `scope='team' OR uploaded_by=auth.uid() OR is_admin()`. INSERT requires `uploaded_by=auth.uid()`. UPDATE/DELETE only for own art (or admin). See `supabase/migrations/20260427000000_picture_frames_and_art.sql`.

**Storage:** Images live in the `frame-art` bucket (public read + authenticated INSERT/DELETE, same pattern as the `thumbnails` bucket after `20260422000000_variant_thumbnails.sql`). Private art relies on DB-level RLS for access control — the bucket paths use UUIDs so they aren't easily guessable.

---

### Templates

#### unit_layout_templates

Saved unit configurations (rooms + geometry + finishes). Frozen snapshot — not affected by later changes.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | uuid | PK, default gen_random_uuid() | |
| name | text | NOT NULL | e.g. "Ideo Mobi 34sqm 1BR" |
| created_by | uuid | FK → profiles.id, NOT NULL | |
| is_global | boolean | NOT NULL, default false | true = promoted by admin, visible to all |
| promoted_by | uuid | FK → profiles.id, nullable | Admin who promoted it |
| unit_width_cm | integer | NOT NULL | |
| unit_height_cm | integer | NOT NULL | |
| rooms_data | jsonb | NOT NULL | Full snapshot of all rooms, their geometry, and finishes. Everything needed to recreate the unit layout. |
| created_at | timestamptz | NOT NULL, default now() | |

**Indexes:** `created_by`, `is_global`

#### furniture_layout_templates

Saved furniture position arrangements. Contains category slots with positions — no specific products, no colors.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | uuid | PK, default gen_random_uuid() | |
| name | text | NOT NULL | e.g. "Standard 1BR Living + Bedroom" |
| created_by | uuid | FK → profiles.id, NOT NULL | |
| is_global | boolean | NOT NULL, default false | |
| promoted_by | uuid | FK → profiles.id, nullable | |
| layout_data | jsonb | NOT NULL | Array of furniture slots. Structure: `[{ "category_id": "uuid", "room_name": "Living Room", "x": 120, "y": 80, "direction": "front_left" }, ...]` |
| compatible_unit_types | text[] | nullable | Optional tags for filtering e.g. `["studio", "1BR", "2BR"]` |
| created_at | timestamptz | NOT NULL, default now() | |

**Indexes:** `created_by`, `is_global`

#### design_style_templates

Full furniture + specific products + specific color variants for a style. The most complete template — "one-click generate."

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | uuid | PK, default gen_random_uuid() | |
| name | text | NOT NULL | e.g. "Modern 1BR — Set A" |
| style_id | uuid | FK → styles.id, NOT NULL | Which style this template represents |
| created_by | uuid | FK → profiles.id, NOT NULL | |
| is_global | boolean | NOT NULL, default false | |
| promoted_by | uuid | FK → profiles.id, nullable | |
| items_data | jsonb | NOT NULL | Array of placed items with specific products. Structure: `[{ "category_id": "uuid", "furniture_item_id": "uuid", "variant_id": "uuid", "room_name": "Living Room", "x": 120, "y": 80, "direction": "front_left", "price_at_save": 15990 }, ...]`. The `price_at_save` field enables staleness alerts when applying the template. |
| created_at | timestamptz | NOT NULL, default now() | |

**Indexes:** `created_by`, `is_global`, `style_id`

**Staleness alert logic for templates:** When a designer applies a design style template, the app compares each item's `price_at_save` against the variant's current `price_thb`, and checks each variant's `link_status`. If any prices changed or links went inactive, an alert is shown: "X items have updated prices, Y items may no longer be available" before the template is applied.

---

## Relationships Diagram

```
profiles
  │
  ├──< projects
  │       │
  │       └──< rooms
  │               │
  │               └──< placed_furniture
  │                       ├── furniture_items (parent product)
  │                       └── furniture_variants (selected color)
  │
  ├──< furniture_items (submitted_by)
  │       │
  │       ├──< furniture_variants (.glb rendered directly in 3D canvas)
  │       │
  │       ├──< furniture_item_styles >── styles
  │       │
  │       └── furniture_categories
  │
  ├──< finish_materials (uploaded_by, custom only)
  │
  ├──< unit_layout_templates (created_by)
  ├──< furniture_layout_templates (created_by)
  └──< design_style_templates (created_by)
                │
                └── styles
```

---

## Data Flow Summary

### Adding a new furniture item
1. Designer uploads a product screenshot + optional product link → Edge Function extracts name, dimensions, description → `furniture_items` row created (status: draft). Optional `is_flat_override` per item.
2. Designer reviews extracted data, overrides if needed → `furniture_items` updated
3. Designer uploads 1+ cropped product photos per color variant (first image is primary) → `furniture_variants` rows created with `original_image_urls[]`
4. **Branch based on flat bypass:**
   - If `category.is_flat` (or `items.is_flat_override` = true): skip TRELLIS. `render_status` set to `completed` and `render_approval_status` to `approved` immediately. First uploaded image serves as canvas asset.
   - Otherwise: `render_status` → processing. TRELLIS runs with all uploaded images (multi-image mode) → `glb_path` set → `render_status` → completed. `render_approval_status` stays `pending`.
5. Designer reviews the generated .glb in the Model Approval Modal (spinning 3D preview) → sets `render_approval_status` to approved, rejected, or retries (re-runs TRELLIS from the same images).
6. Designer can use the item on canvas at any point after step 3 — a translucent placeholder box is shown until the .glb finishes loading.

### Daily link validity recheck
1. Scheduled Edge Function picks a batch of `furniture_variants` ordered by `last_checked_at` (oldest first)
2. For each variant, checks the source URL (variant's own URL, or parent's if null)
3. Updates `link_status`, `last_checked_at`, `price_thb` (if price changed), `price_changed` flag
4. Admin dashboard surfaces newly flagged items

### Cost summary calculation
1. Query all `placed_furniture` in a project
2. For each, look up `selected_variant_id` → get current `price_thb`
3. Sum all variant prices = furniture total
4. Add `projects.manual_costs` values = renovation/finish total
5. Grand total = furniture total + renovation total
6. Compare each `placed_furniture.price_at_placement` against current price → surface staleness alerts for any differences

### Template staleness check (on apply)
1. Read template's `items_data` JSON
2. For each item, compare `price_at_save` against live `furniture_variants.price_thb`
3. Check each variant's `link_status`
4. Surface alerts before applying: "X prices changed, Y links inactive"
