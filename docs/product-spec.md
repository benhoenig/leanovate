# Product Spec — LEANOVATE

> **Document scope:** App name, problem statement, target users, MVP vs post-MVP feature scope, user stories, and success metrics.
>
> **Out of scope (covered in other docs):**
>
> | File | Owns |
> |---|---|
> | `tech-stack.md` | Technology choices, libraries, versions, rationale, folder structure |
> | `design.md` | Visual system — colors, typography, component styling |
> | `schema.md` | Supabase table structures, fields, and relationships |
> | `state-map.md` | Zustand store breakdown and state ownership |
> | `implementation-plan.md` | Build order, phases, and timeline |
> | `integration-contracts.md` | Shopee Affiliate API, Supabase auth, external service shapes |

---

## App Name

**LEANOVATE**

---

## Problem Statement

Our design team currently pitches condo investors using Canva presentations paired with manual spreadsheet-based price lists. This workflow is slow (each proposal takes significant design time), produces inconsistent visual quality across team members, and introduces pricing errors from manual data entry. There's no single tool that lets our team place real purchasable furniture into a unit layout, auto-generate a cost breakdown, and output a client-ready presentation — all in one flow.

LEANOVATE replaces this fragmented process with a unified internal tool where designers place real products into isometric room layouts, cost summaries update automatically, and every proposal meets a consistent professional standard. A layered template system (unit layout → furniture layout → design style) enables one-click proposal generation, reducing per-project turnaround from hours to minutes.

---

## Target Users

- **Primary (MVP):** Internal design team (3–10 people) — designers building unit proposals and presenting them to condo investor clients.
- **End client (not a user):** Condo investors and real estate investors in Thailand furnishing units for rental or resale — they see the output but don't interact with the app.

---

## Roles

| Role | Capabilities |
|---|---|
| **Designer** | Create projects, configure unit layouts, customize finishes, browse/place furniture, add furniture from external links (personal draft), create personal templates, view cost summaries |
| **Admin** | Everything a designer can do, plus: manage team accounts (invite/remove/assign roles), promote personal templates to official/global, approve or reject pending furniture into shared catalog, access and manage all projects across the team |

---

## MVP Feature Scope

| Feature | Description |
|---|---|
| **Isometric room planner** | Click-to-select, click-to-place (Canva-style) furniture placement on an isometric canvas. Designers can reposition items by dragging after placement. |
| **Room view rotation** | Rotate the entire room view to see the unit from all 4 corners. |
| **Unit layout configurator** | Adjustable room count, dimensions, walls, floors, windows, doors per project. Supports saving as reusable unit layout template. |
| **Unit finish customization** | Change wall color/wallpaper, flooring material, door style, window style, and lighting fixtures per unit. Preset palette of materials available plus custom texture/image upload. Finishes are visual templates — costs are entered manually by the designer. |
| **Furniture layout templates** | Preset furniture category positions (sofa, bed, TV, etc.) applicable to a unit layout. One-click to place all furniture slots. |
| **Design style templates** | Auto-fills a furniture layout with specific products tagged to a style (modern, minimal, luxury, Japandi, Scandinavian, mid-century, etc.). One-click generate with regenerate/shuffle to randomize product picks within the same style. |
| **Template permissions** | Any designer or admin can create templates (personal). Only admin can promote a template to official/global. |
| **Furniture catalog** | Browsable shared catalog of IKEA + Shopee products, tagged by category and style. |
| **Manual furniture adding** | Two-step process: (1) Designer pastes a product link → system scrapes product details (name, dimensions, description) → designer can review and override/fill in additional details the scraper missed. (2) Designer adds one or more color variants — for each: uploads a cropped product image, fills in color name, and optionally provides a separate price, product link, or size differences. Optional details help the scraper get better results (if a separate link is provided, scraper pulls from that link; if price is provided manually, scraper skips price). Variants inherit name, category, style tags, and dimensions from the parent item unless overridden. |
| **Image approval gate** | For each uploaded color variant image: rembg removes background → designer reviews and approves the clean image (hard gate) → on approval, TRELLIS generates 3D model → sprites render in background. On rejection, designer can upload a better photo and retry. Designer can use the item on canvas immediately with original photo as placeholder while sprites generate. |
| **AI-rendered isometric sprites** | Approved images are converted into a 3D model (.glb) via TRELLIS, then rendered into 4 isometric sprite views (front-left, front-right, back-left, back-right) via Three.js. Each color variant gets its own .glb and 4 sprites. Pre-rendered via async background processing. |
| **Color variant switching** | When a furniture item is placed on the canvas, the designer can switch between color variants via color swatches. Sprites swap instantly (pre-rendered). Cost summary updates to reflect the selected variant's price. |
| **Furniture rotation** | Click to rotate individual furniture items through 4 isometric directions on the canvas. |
| **Room perspective preview** | "Preview Room" button renders a single static eye-level interior vignette — a realistic 3D perspective image of the current room showing all placed furniture (.glb models), room geometry, and finishes from a human standing-height camera angle. Rendered server-side via Three.js, displayed in a modal. Used during client presentations to show mood and tone. |
| **Cost summary** | Auto-calculated breakdown of furniture costs (updates in real time as items are added/removed) + manually entered renovation/finish estimates. |
| **Daily link validity recheck** | System automatically rechecks product source links on a daily schedule to detect inactive/delisted products (especially common on Shopee). Flagged items are visually marked for designers. Price changes are auto-updated. Admin receives a summary of newly flagged items. |
| **Role-based access** | Admin: full access + template promotion + catalog approval + team management. Designer: project creation + personal templates + personal draft items. |
| **Construction drawing export** | "Export Drawings" generates a PDF construction document set: top-down floor plan + 4 elevation views (front, left, right, back). All views include dimension lines in cm — wall lengths, door/window widths, heights, sill heights, distances between elements, ceiling height, and a scale indicator. These are the working drawings that contractors need to execute the interior fit-out accurately. |

---

## Post-MVP Features

| Feature | Description |
|---|---|
| **Shoppable affiliate links** | Shopee checkout integration via affiliate API. |
| **Proposal export** | PDF / image export of completed designs. |
| **Client-facing portal** | Investors can view and approve proposals directly. |
| **Style scoring** | Scoring system for furniture-to-style alignment to improve auto-generation accuracy. |
| **Interactive 3D walkthrough** | Upgrade room preview from a static snapshot to a full interactive Three.js scene in the browser — designer/client can look around freely like a virtual tour. |

---

## User Stories

### Designer

1. **Create a new project** — As a designer, I can create a new project for a specific condo unit so I can start building a proposal for a client.

2. **Configure the unit layout** — As a designer, I can set up a unit's floor plan by adjusting room count, room dimensions, and positioning walls, floors, windows, and doors to match the actual condo unit.

3. **Customize unit finishes** — As a designer, I can change the wall color/wallpaper, flooring material, door style, window style, and lighting fixtures. I can pick from a preset palette of materials or upload custom textures/images. I can manually enter costs for finishes in the cost summary.

4. **Save a unit layout as template** — As a designer, I can save a unit layout (including finishes) as a personal template so I can reuse it for future units with the same floor plan.

5. **Apply a furniture layout template** — As a designer, I can apply a furniture layout template to a unit, which one-click places furniture category slots (sofa, bed, TV, etc.) in preset positions so I don't arrange from scratch every time.

6. **Apply a design style template** — As a designer, I can select a style (modern, minimal, Japandi, etc.) to auto-fill furniture slots with real products tagged to that style, generating a near-complete proposal in one click.

7. **Regenerate style picks** — As a designer, I can click regenerate to shuffle which products are selected within the same style, giving me variations until I find one close to what I want.

8. **Browse and place furniture manually** — As a designer, I can browse the shared furniture catalog and click-to-select an item, then click on the canvas to place it. I can reposition items by dragging after placement.

9. **Rotate furniture** — As a designer, I can click to rotate a placed furniture item through 4 isometric directions (front-left, front-right, back-left, back-right) to fit the room layout properly.

10. **Rotate room view** — As a designer, I can rotate the entire room view to see the unit from all 4 corners, so I can verify the layout from every angle and choose the best view for presenting to clients.

11. **Preview room in 3D perspective** — As a designer, I can click "Preview Room" to generate an eye-level interior vignette — a realistic perspective image of the current room showing all placed furniture, room geometry, and finishes as if standing inside the unit. The image renders in a few seconds and displays in a modal, which I can show to clients during presentations.

12. **Add furniture from external link** — As a designer, I can paste a product link and the system scrapes product details (name, dimensions, description). I can review and override any scraped details or fill in additional information the scraper missed (e.g. correct name, add dimensions).

13. **Add color variants** — As a designer, I can add one or more color variants to a furniture item. For each variant, I upload a cropped product image and fill in the color name. I can optionally provide a separate price, product link, or size differences per variant — these help the scraper get more accurate data. Variants inherit details from the parent item unless I override them.

14. **Approve variant images** — As a designer, for each color variant image I upload, the system removes the background and shows me the clean result. I approve or reject the clean image. On approval, isometric sprites generate in the background. On rejection, I can upload a better photo and retry.

15. **Switch color variants on canvas** — As a designer, when I place a furniture item on the canvas, I can switch between its color variants via color swatches. The sprites swap instantly and the cost summary updates to reflect the selected variant's price.

16. **View cost summary** — As a designer, I can see an auto-calculated cost breakdown (furniture costs updated in real time based on selected color variants + manually entered renovation/finish estimates) that reflects the current state of my project.

17. **Save and revisit projects** — As a designer, I can save my work and return to any project later to continue editing or present to a client.

18. **Create templates** — As a designer, I can save my current furniture arrangement as a personal furniture layout template, or save the full arrangement with specific product selections as a personal design style template.

### Admin

19. **All designer capabilities** — As an admin, I can do everything a designer can (create projects, place furniture, use templates, etc.).

20. **Manage team accounts** — As an admin, I can invite, remove, and assign roles (admin/designer) to team members.

21. **Promote templates to global** — As an admin, I can review personal templates created by any team member and promote them to official/global templates visible to all designers.

22. **Review pending furniture** — As an admin, I can see all designer-submitted furniture items pending approval, and approve or reject each one. Approved items move into the shared catalog available to all designers.

23. **Access all projects** — As an admin, I can view and manage all projects across the team for quality control and client coordination.

---

## Success Metrics

> **Note:** Measure current baselines (using the Canva + spreadsheet workflow) before launch. Update targets once baseline data is collected.

| Category | Metric | Baseline | Target |
|---|---|---|---|
| **Speed** | Time to complete a client proposal (blank to presentable) | TBD — measure before launch | TBD |
| **Volume** | Proposals delivered per designer per week | TBD — measure before launch | TBD |
| **Consistency** | % of proposals using official templates vs built from scratch | 0% (no templates exist today) | TBD |
| **Cost accuracy** | Frequency of pricing errors in cost summaries | TBD — measure before launch | Near zero for furniture (auto-calculated) |
| **Catalog growth** | Approved products in shared catalog | 0 | Track monthly growth |
| **Template coverage** | Global templates available across all 3 layers (unit, furniture layout, style) | 0 | Track monthly growth |
| **Team adoption** | % of designers using LEANOVATE as primary workflow | 0% | 100% within 1 month of launch |
