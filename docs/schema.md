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

1. **Parent + Variants model** — Each furniture product has a parent record (shared name, category, dimensions) and one or more color variants (each with its own image, price, link, .glb, and sprites). This mirrors how real products work on Shopee/IKEA.

2. **Live calculation, not stored snapshots** — Cost summaries are calculated on the fly from current variant prices + manually entered renovation costs. No stale price snapshots. Staleness alerts handle the case where prices change between visits.

3. **JSON for geometry, relational for everything else** — Room geometry (walls, doors, windows) and template snapshots are stored as JSON because they're consumed as single blobs. Everything with relationships (items, variants, sprites, categories) uses proper relational tables.

4. **Two approval workflows** — (a) Image approval: designer reviews background-removed images before AI sprite generation. (b) Catalog approval: admin reviews designer-submitted items before they enter the shared catalog.

5. **Supabase Row-Level Security (RLS)** — All tables use RLS policies. Designers can only see their own draft items + all approved items. Admins see everything. Detailed RLS rules are defined in `integration-contracts.md`.

---

## Enums

The following enums are used across multiple tables:

```sql
-- User roles
CREATE TYPE user_role AS ENUM ('admin', 'designer');

-- Furniture item catalog status
CREATE TYPE item_status AS ENUM ('draft', 'pending', 'approved', 'rejected');

-- Image approval pipeline status
CREATE TYPE image_status AS ENUM ('processing', 'pending_approval', 'approved', 'rejected');

-- AI rendering pipeline status
CREATE TYPE render_status AS ENUM ('waiting', 'processing', 'completed', 'failed');

-- Isometric viewing directions
CREATE TYPE direction AS ENUM ('front_left', 'front_right', 'back_left', 'back_right');

-- Link health status (daily recheck)
CREATE TYPE link_status AS ENUM ('active', 'inactive', 'unchecked');

-- Project status
CREATE TYPE project_status AS ENUM ('draft', 'completed');

-- Finish material types
CREATE TYPE finish_type AS ENUM ('wall', 'floor', 'door', 'window', 'lighting');
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
| finishes | jsonb | NOT NULL, default '{}' | Current finish selections. Structure: `{ "wall": { "material_id": "uuid", "custom_url": null }, "floor": { ... }, "door": { ... }, "window": { ... }, "lighting": { ... } }` |
| sort_order | integer | NOT NULL, default 0 | Display order in the room list |
| preview_image_url | text | nullable | Most recently saved eye-level interior vignette (3D perspective preview). Stored in `thumbnails` bucket. Updated each time designer renders a preview and clicks "Save to Project". Null until first save. |
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
| submitted_by | uuid | FK → profiles.id, NOT NULL | Designer who added this item |
| reviewed_by | uuid | FK → profiles.id, nullable | Admin who approved/rejected |
| reviewed_at | timestamptz | nullable | When the review happened |
| created_at | timestamptz | NOT NULL, default now() | |
| updated_at | timestamptz | NOT NULL, default now() | Auto-updated via trigger |

**Indexes:** `category_id`, `submitted_by`, `status`

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
| original_image_url | text | NOT NULL | Designer-uploaded product photo (before background removal) |
| clean_image_url | text | nullable | Background-removed image from rembg. Null until rembg completes |
| image_status | image_status | NOT NULL, default 'processing' | processing = rembg running, pending_approval = awaiting designer review, approved = cleared for TRELLIS, rejected = designer rejected the clean image |
| glb_path | text | nullable | Path to TRELLIS-generated .glb file in Supabase Storage. Null until TRELLIS completes |
| render_status | render_status | NOT NULL, default 'waiting' | waiting = awaiting image approval, processing = TRELLIS/Three.js running, completed = all 4 sprites ready, failed = generation failed |
| link_status | link_status | NOT NULL, default 'unchecked' | For daily link validity recheck. Checked against variant's source_url (or parent's if null) |
| last_checked_at | timestamptz | nullable | Last time the link was verified by the daily recheck job |
| price_changed | boolean | NOT NULL, default false | Flagged true if daily recheck detected a significant price change (>20% threshold). Reset to false when designer acknowledges |
| sort_order | integer | NOT NULL, default 0 | Display order among variants of the same parent |
| created_at | timestamptz | NOT NULL, default now() | |
| updated_at | timestamptz | NOT NULL, default now() | Auto-updated via trigger |

**Indexes:** `furniture_item_id`, `image_status`, `render_status`, `link_status`

#### furniture_sprites

AI-rendered isometric images. 4 per variant (one per direction).

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | uuid | PK, default gen_random_uuid() | |
| variant_id | uuid | FK → furniture_variants.id ON DELETE CASCADE, NOT NULL | Which color variant this sprite belongs to |
| direction | direction | NOT NULL | front_left, front_right, back_left, back_right |
| image_path | text | NOT NULL | Path in Supabase Storage |
| created_at | timestamptz | NOT NULL, default now() | |
| | | UNIQUE (variant_id, direction) | One sprite per direction per variant |

**Indexes:** `variant_id`

---

### Placed Furniture (in projects)

#### placed_furniture

Instances of furniture items placed on the isometric canvas within a room.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | uuid | PK, default gen_random_uuid() | |
| room_id | uuid | FK → rooms.id ON DELETE CASCADE, NOT NULL | Which room |
| furniture_item_id | uuid | FK → furniture_items.id, NOT NULL | Which parent product |
| selected_variant_id | uuid | FK → furniture_variants.id, NOT NULL | Which color variant is currently shown on canvas |
| x | float | NOT NULL | Position on isometric canvas (horizontal) |
| y | float | NOT NULL | Position on isometric canvas (vertical) |
| direction | direction | NOT NULL, default 'front_left' | Current rotation |
| price_at_placement | decimal | nullable | The variant's price when placed. Compared against live price to trigger staleness alerts |
| sort_order | integer | NOT NULL, default 0 | Z-index / layer order on canvas |
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
  │       ├──< furniture_variants
  │       │       │
  │       │       └──< furniture_sprites (4 per variant)
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
1. Designer pastes product link → Edge Function scrapes name, dimensions, description → `furniture_items` row created (status: draft)
2. Designer reviews scraped data, overrides if needed → `furniture_items` updated
3. Designer uploads color variant images with color name + optional price/link → `furniture_variants` rows created (image_status: processing)
4. rembg processes each image → `clean_image_url` set, `image_status` → pending_approval
5. Designer approves each clean image → `image_status` → approved, `render_status` → processing
6. TRELLIS generates .glb → `glb_path` set → Three.js renders 4 sprites → `furniture_sprites` rows created → `render_status` → completed
7. Designer can use item on canvas at any point after step 3 (original photo as placeholder until sprites are ready)

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
