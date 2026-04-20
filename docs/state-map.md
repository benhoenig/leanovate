# State Map — LEANOVATE

> **Document scope:** Zustand store domains, ownership boundaries, and inter-store relationships. Defines which store owns which *kind* of data so the AI coder never duplicates state or puts data in the wrong place.
>
> This file does NOT list specific state fields or actions. The AI coder should derive those from `product-spec.md` (user stories) and `schema.md` (data shapes), then place them in the correct store based on the ownership rules here.
>
> **Out of scope (covered in other docs):**
>
> | File | Owns |
> |---|---|
> | `product-spec.md` | Features, user stories, interaction flows |
> | `tech-stack.md` | Technology choices, libraries, versions, folder structure |
> | `schema.md` | Database tables, fields, relationships, data shapes |
> | `design.md` | Visual system — colors, typography, component styling |
> | `implementation-plan.md` | Build order, phases, timeline |
> | `integration-contracts.md` | External API shapes and contracts |

---

## Stores

The app uses **6 Zustand stores**, each owning one domain.

### 1. Auth Store (`useAuthStore`)

Owns the current user's identity and role. Read-only from the app's perspective — only Supabase Auth events update it. Every other store checks this store for permission logic (admin vs designer).

### 2. Project Store (`useProjectStore`)

Owns everything about the currently open project: the unit itself, its rooms, room geometry, room finishes, and manually entered renovation/finish costs. Maps to the `projects` and `rooms` tables in Supabase. Does NOT own placed furniture — that's the Canvas Store.

### 3. Canvas Store (`useCanvasStore`)

Owns everything happening on the 3D canvas: placed furniture (position in cm, rotation in degrees), selection, placement mode, shape-edit mode, and design-mode camera preset rotation. Maps to the `placed_furniture` table in Supabase. This store only holds ID references to items and variants — it never duplicates product details like names or prices. UI components join the data at render time by looking up IDs in the Catalog Store.

### 4. Catalog Store (`useCatalogStore`)

**Single source of truth for all product data.** Owns furniture items, color variants (with prices, images, `.glb` paths, and statuses), categories, and styles. Also owns search and filter state for the catalog browser. Maps to `furniture_items`, `furniture_variants`, `furniture_categories`, `styles`, and `furniture_item_styles` tables in Supabase. No other store should cache or duplicate any product data.

### 5. Template Store (`useTemplateStore`)

Owns all three template layers: unit layout templates, furniture layout templates, and design style templates. Also owns staleness alerts generated when applying a template. Maps to the three template tables in Supabase. Template apply is a cross-store operation — this store orchestrates by reading template data, checking staleness against the Catalog Store, then writing results to the Project Store and/or Canvas Store.

### 6. UI Store (`useUIStore`)

Owns pure visual state: which sidebar tab is active, which right panel tab is active, modal visibility, alert banners, toast notifications, **world-grid visibility** (persisted to localStorage), and **camera mode** (`design` | `roam`, session-local). No business logic, no data persistence beyond the grid toggle.

---

## Inter-Store Relationships

```
                    ┌─────────────┐
                    │  Auth Store  │
                    │  (user/role) │
                    └──────┬──────┘
                           │ role checks
              ┌────────────┼────────────┐
              ▼            ▼            ▼
      ┌──────────┐  ┌───────────┐  ┌──────────┐
      │ Project  │  │  Catalog  │  │ Template │
      │  Store   │  │   Store   │  │  Store   │
      └────┬─────┘  └─────┬─────┘  └────┬─────┘
           │              │              │
           │   ┌──────────┘              │
           │   │  ID lookups             │ applies templates
           │   ▼                         ▼
      ┌────────────┐            writes to Project
      │   Canvas   │◄───────── & Canvas stores
      │   Store    │
      │            │
      │            │──── computed ────► Cost Calculation
      │            │                    (not a store)
      └────────────┘

      ┌──────────┐
      │ UI Store │  (independent — no data relationships)
      └──────────┘
```

---

## Cost Calculation (Computed, Not a Store)

As defined in `schema.md`: cost summary is always calculated live, never stored.

```
Furniture total = sum of each placed item's selected variant's current price_thb
                  (looked up from Catalog Store by variant ID)

Manual total = sum of Project Store's manualCosts values

Grand total = Furniture total + Manual total

Staleness = compare each placed item's price_at_placement (Canvas Store)
            against current price_thb (Catalog Store)
            → if different, surface alert
```

Implemented as a derived/computed value in the cost panel component.

---

## Key Rules

1. **Never duplicate data across stores.** If canvas needs a furniture item's name, read from Catalog Store by ID — don't copy it into Canvas Store.

2. **Catalog Store is the single source of truth** for all product data. Every other store references products by ID only.

3. **Cost is always computed, never stored.** Read live prices from Catalog Store at render time.

4. **UI Store has no business logic.** It only tracks visibility. Data-changing actions belong in other stores.

5. **Template apply is cross-store.** Template Store reads template data, checks staleness against Catalog Store, then writes to Project Store and/or Canvas Store.

6. **Auth Store is read-only.** Only Supabase Auth events update it.

7. **Derive state and actions from other docs.** This file defines ownership domains. The AI coder should read `product-spec.md` for what features exist, `schema.md` for data shapes, and place each piece of state/action in the store that owns that domain.
