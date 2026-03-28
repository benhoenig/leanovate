# Implementation Plan — LEANOVATE

> **Document scope:** Build order, phases, and what's in each phase. No time estimates — phases are sequenced by dependency, not calendar.
>
> **Out of scope (covered in other docs):**
>
> | File | Owns |
> |---|---|
> | `product-spec.md` | Features, user stories, interaction flows |
> | `tech-stack.md` | Technology choices, libraries, versions, folder structure |
> | `schema.md` | Database tables, fields, relationships |
> | `design.md` | Visual system — colors, typography, component styling |
> | `state-map.md` | Zustand store domains and ownership |
> | `integration-contracts.md` | External API shapes and contracts |

---

## Phasing Principles

1. **Each phase produces something testable.** No phase ends with invisible infrastructure — you should be able to click around and verify it works before moving on.
2. **Data first, visuals on top.** Build the data layer before the UI that displays it. Avoids building with fake data then rewiring.
3. **Complete flows, not half-features.** If a feature spans multiple integrations (e.g. add furniture → scrape → rembg → TRELLIS → sprites), build the whole pipeline in one phase rather than splitting it across phases with placeholder statuses.
4. **Foundation before speed.** Get the core working correctly before adding templates and shortcuts that accelerate workflows.

---

## Phase Overview

| Phase | Name | Builds On | What You Can Test After |
|---|---|---|---|
| 1 | Foundation | — | Log in, see empty dashboard, navigate to empty editor, deployed on Vercel |
| 2 | Room Builder | Phase 1 | Create a unit, add rooms, set dimensions, apply finishes, save/reopen project |
| 3 | Furniture Catalog + AI Pipeline | Phase 1 | Add furniture from Shopee/IKEA link, upload color variants, approve images, see isometric sprites generated |
| 4 | Isometric Canvas | Phase 2 + 3 | Place real furniture with real sprites on canvas, drag, rotate items, rotate room, switch colors |
| 5 | Templates + Cost Summary | Phase 4 | Save/apply templates across all 3 layers, regenerate styles, see live cost breakdown with staleness alerts |
| 6 | Room Preview + Admin + Daily Recheck | Phase 4 + 5 | Click "Preview Room" for interior vignette, admin approves furniture, manage team, link recheck runs daily |

---

## Phase 1: Foundation

Get the boring infrastructure right so everything after this builds on solid ground.

**What to build:**

- Vite + React + TypeScript project scaffolding
- Tailwind CSS + shadcn/ui configured with design system CSS variables from `design.md`
- Supabase project: database, auth, storage buckets (as defined in `integration-contracts.md`)
- Supabase Auth integration: sign up, log in, log out
- `profiles` table with role field (admin/designer), auto-created on sign up
- Zustand stores: empty shells for all 6 stores from `state-map.md`
- React Router: login page → dashboard → editor (all empty shells with correct routes)
- Deploy to Vercel with GitHub auto-deploy

**What to test:**
- Sign up → profile created in database with designer role
- Log in → land on dashboard
- Navigate to editor → empty page loads
- Open on phone → pages are responsive
- Push code to GitHub → Vercel auto-deploys

**Reference docs:** `tech-stack.md` (all technology choices), `design.md` (CSS variables), `schema.md` (profiles table), `state-map.md` (store names), `integration-contracts.md` (Supabase Auth, Storage buckets)

---

## Phase 2: Room Builder

The unit configurator — walls, rooms, finishes. No furniture yet.

**What to build:**

- Project CRUD: create, rename, delete projects
- Dashboard: list of designer's projects with "New Project" button
- Room CRUD within a project: add rooms, rename, delete, reorder
- Unit layout configurator: set unit dimensions, set room dimensions, position walls/doors/windows
- Room geometry stored as JSON in `rooms` table
- Finish customization: wall color, flooring material, door style, window style, lighting from preset `finish_materials` table + custom texture upload
- PixiJS canvas initialized: renders the isometric room shell (walls, floor) from geometry data
- Room list in left sidebar with room selection
- Save/load projects to Supabase
- `isDirty` tracking: "unsaved changes" warning on navigation

**What to test:**
- Create a project "Unit 1204"
- Add a living room (450×380cm) and bedroom (300×350cm)
- Set finishes: oak flooring, white walls, warm lighting
- Upload a custom wallpaper texture
- See the isometric room shell rendered on canvas
- Save, close, reopen — everything persists
- Try to navigate away with unsaved changes — warning appears

**Reference docs:** `product-spec.md` (user stories #1–3), `schema.md` (projects, rooms, finish_materials tables), `integration-contracts.md` (Supabase Storage for textures)

---

## Phase 3: Furniture Catalog + AI Pipeline

Build the complete data pipeline from "paste a link" to "isometric sprites ready." No canvas placement yet — sprites are generated and viewable in the catalog.

**What to build:**

- Seed `furniture_categories` and `styles` tables with initial data
- Catalog browser in left sidebar: search bar, category filter pills, furniture item list
- Add Furniture modal — Step 1:
  - Designer pastes product link
  - Edge Function validates source domain + scrapes product details
  - Designer reviews/overrides scraped name, description, dimensions
  - `furniture_items` record created (status: draft)
- Add Furniture modal — Step 2:
  - Designer uploads color variant images with color name
  - Optional: separate price, product link, size overrides per variant
  - `furniture_variants` records created
- rembg integration:
  - Background removal runs on each uploaded image
  - Clean image stored in Supabase Storage
  - `image_status`: processing → pending_approval
- Image approval gate:
  - Designer sees clean image, clicks approve or reject
  - Reject: upload a better photo, rembg re-runs
  - Approve: `image_status` → approved
- TRELLIS integration:
  - Approved image sent to Replicate API
  - .glb file returned and stored in Supabase Storage
  - `render_status`: waiting → processing
- Three.js sprite rendering:
  - .glb file rendered into 4 isometric angle PNGs
  - Sprites stored in Supabase Storage
  - `furniture_sprites` rows created
  - `render_status`: processing → completed
- Catalog displays items with: status dot, name, category, price, color swatches, sprite thumbnails (or original photo while processing)
- Item status flow for admin: draft → pending → approved/rejected
- Style tagging: assign styles to furniture items

**What to test:**
- Click "Add Furniture" → paste a Shopee link → see name/description scraped
- Override the scraped name → save
- Upload 3 color variant photos (blue, beige, black)
- See backgrounds removed in ~2 seconds per image
- Review clean images → approve all 3
- Wait ~1 minute per variant → see .glb generated → see 4 sprite images appear
- Browse catalog → search for "sofa" → filter by "Sofa" category → see the item with 3 color swatches
- Change item status to pending → log in as admin → see it in pending list → approve → now visible to all

**Reference docs:** `product-spec.md` (user stories #12–14), `schema.md` (furniture_items, furniture_variants, furniture_sprites, furniture_item_styles, furniture_categories, styles tables), `integration-contracts.md` (scraping, rembg, TRELLIS, Three.js sprite rendering, Supabase Storage), `state-map.md` (Catalog Store)

---

## Phase 4: Isometric Canvas + Furniture Placement

The core interaction — placing real furniture with real sprites on the isometric canvas.

**What to build:**

- PixiJS canvas: render placed furniture sprites on the isometric grid
- Click-to-select from catalog: click a furniture item in sidebar → enter placement mode
- Click-to-place on canvas: click a position → furniture appears with default variant's sprite
- Drag to reposition placed items
- Furniture rotation: click to cycle through 4 isometric directions (sprite swaps to matching direction image)
- Room view rotation: NW/NE/SE/SW buttons, entire room + all furniture rotates
- Color variant switching: select a placed item → right panel shows color swatches → click to swap variant (sprites swap instantly)
- Selected item properties in right panel: name, category, source, dimensions, current variant, price
- Remove item from canvas
- Original product photo as fallback when sprites aren't ready yet
- `placed_furniture` records saved to Supabase
- `price_at_placement` recorded when item is placed

**What to test:**
- Browse catalog → click a sofa → cursor changes to placement mode
- Click on the living room canvas → sofa sprite appears at that position
- Drag it to a better position → it moves smoothly
- Click rotate → sofa shows from next angle
- Click NE rotation button → entire room rotates, all furniture shows matching angle
- Select the sofa → right panel shows 3 color swatches → click beige → sprite swaps instantly, price updates
- Save project → reopen → all placed furniture still there with correct positions, variants, and rotations

**Reference docs:** `product-spec.md` (user stories #8–10, #15), `schema.md` (placed_furniture table), `state-map.md` (Canvas Store — references Catalog Store by ID), `design.md` (floating rotation controls, color swatches)

---

## Phase 5: Templates + Cost Summary

The speed multipliers — one-click generation and live pricing.

**What to build:**

- Save as unit layout template: snapshot current rooms + geometry + finishes
- Save as furniture layout template: snapshot furniture category positions (no specific products)
- Save as design style template: snapshot full arrangement with specific products + variants
- Template browser in left sidebar (Templates tab): browse all 3 layers, personal vs global badges
- Apply unit layout template: populates project with rooms/geometry/finishes
- Apply furniture layout template: places category slots on canvas
- Apply design style template: fills slots with specific products + variants
- Regenerate/shuffle: re-randomize product picks within same style (reads from Catalog Store items tagged with that style)
- Template permissions: designer creates personal, admin promotes to global
- Cost summary panel (right panel, Cost tab):
  - Live-calculated furniture total from placed variants' current prices
  - Manual renovation/finish cost entries (editable)
  - Grand total
  - Subtotals per section
- Staleness alerts on project open: compare `price_at_placement` vs current price, surface differences
- Template staleness check on apply: compare `price_at_save` vs current price, check link status, warn before applying

**What to test:**
- Design a complete 1BR unit with furniture
- Save as "Modern 1BR — Set A" style template
- Create a new project with the same unit layout
- Apply the style template → all furniture places itself in one click with correct products, variants, and positions
- Click regenerate → products shuffle to different items in the same style
- Open cost tab → see furniture total + manual costs + grand total
- Change a product price in the database → reopen project → see staleness alert "1 item has a price change"
- Apply a template where one product link went inactive → see warning before applying

**Reference docs:** `product-spec.md` (user stories #4–7, #16–18, #21), `schema.md` (three template tables, placed_furniture.price_at_placement, design_style_templates.items_data.price_at_save), `state-map.md` (Template Store cross-store operations)

---

## Phase 6: Room Preview + Admin + Daily Recheck

The finishing touches that make it production-ready for the team.

**What to build:**

- Room perspective preview:
  - "Preview Room" button on canvas
  - Server-side Three.js loads room geometry + finishes + all placed .glb files
  - Renders eye-level interior vignette (perspective camera at ~160cm height)
  - Displays in modal overlay
  - Saves to `rooms.preview_image_url` in Supabase Storage
- Admin catalog management:
  - Pending furniture approval queue (approve/reject items submitted by designers)
  - Shared catalog overview with status filters
  - Link status overview (active/inactive/unchecked counts)
- Team management:
  - Invite new team members (email invite)
  - Remove team members
  - Assign/change roles (admin/designer)
- Daily link validity recheck:
  - Scheduled Edge Function (3:00 AM Bangkok time)
  - Batch checks variant source URLs (round-robin, ~100 per run)
  - Updates `link_status`, `last_checked_at`, `price_thb`, `price_changed`
  - Admin dashboard surfaces newly flagged items
- Admin project access: view and manage all projects across team
- Responsive polish: tablet bottom sheet for right panel, mobile presentation mode

**What to test:**
- Design a furnished room → click "Preview Room" → wait 5–10 seconds → see realistic interior vignette in modal showing all furniture with finishes
- Log in as admin → see pending furniture queue → approve an item → it appears in all designers' catalogs
- Invite a new designer by email → they sign up → appear in team list as designer
- Wait for daily recheck to run → check admin dashboard → see flagged items with inactive links or changed prices
- Open the app on a tablet → present a project to a (pretend) client using the room preview

**Reference docs:** `product-spec.md` (user stories #11, #19–20, #22–23), `schema.md` (rooms.preview_image_url, furniture_variants link recheck fields), `integration-contracts.md` (room perspective preview, daily link recheck), `design.md` (alert banner styling)

---

## Dependency Graph

```
Phase 1: Foundation
  │
  ├──► Phase 2: Room Builder
  │       │
  │       └──────────┐
  │                  │
  ├──► Phase 3: Catalog + AI Pipeline
  │       │          │
  │       └──────────┤
  │                  │
  │           Phase 4: Isometric Canvas
  │                  │
  │                  ├──► Phase 5: Templates + Cost
  │                  │          │
  │                  └──────────┤
  │                             │
  │                      Phase 6: Preview + Admin + Recheck
  │
  └──► Phases 2 and 3 can be built in parallel (no dependency on each other)
```

**Note:** Phases 2 and 3 are independent — they both depend on Phase 1 but not on each other. If you want variety in your vibe-coding sessions, you can alternate between room builder work and catalog/pipeline work.

---

## What "Done" Looks Like

When all 6 phases are complete, LEANOVATE supports the full workflow:

1. Designer logs in → creates a project for a condo unit
2. Configures the unit layout (rooms, dimensions, finishes)
3. Applies a furniture layout template → category slots appear
4. Applies a design style → real products auto-fill with sprites
5. Regenerates until the selection feels right
6. Manually swaps individual items or colors
7. Views live cost summary with furniture + renovation totals
8. Clicks "Preview Room" → sees an eye-level interior vignette
9. Presents the isometric view + vignette + cost summary to the client
10. Admin manages the catalog, approves new items, monitors link health
