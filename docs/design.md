# Design System — LEANOVATE

> **Document scope:** Visual system reference — colors, typography, spacing, shadows, and reusable component styling specs. This file tells the AI coder how everything should *look*, not what to build or how it behaves.
>
> **Out of scope (covered in other docs):**
>
> | File | Owns |
> |---|---|
> | `product-spec.md` | Features, user stories, interaction flows |
> | `tech-stack.md` | Technology choices, libraries, versions, folder structure |
> | `schema.md` | Database tables, fields, relationships |
> | `state-map.md` | Zustand store breakdown and state ownership |
> | `implementation-plan.md` | Build order, phases, timeline |
> | `integration-contracts.md` | External API shapes and contracts |

---

## Design Philosophy

LEANOVATE's visual identity is inspired by **The Sims / SimCity** — warm, playful, and approachable, but professional enough for client-facing use.

**Principles:**

1. **Warm, not clinical** — Light theme with warm undertones (cream/beige canvas, not stark white/gray)
2. **Playful, not childish** — Rounded shapes, smooth transitions, soft shadows — no cartoon aesthetics
3. **Status at a glance** — Color-coded dots, badges, and alerts for instant recognition of approved, pending, flagged, or failed states
4. **Dense but breathable** — Compact panels with enough spacing that nothing feels cramped
5. **Canvas-first** — The isometric room is the hero. UI panels serve the canvas, not the other way around

---

## Color Palette

### Core Colors

| Role | Hex | CSS Variable | Usage |
|---|---|---|---|
| Primary | `#2BA8A0` | `--color-primary` | Buttons, active states, selected items, links |
| Primary Hover | `#238C85` | `--color-primary-hover` | Button hover, active tab underlines |
| Primary Light | `#F0FAF9` | `--color-primary-light` | Selected item backgrounds, active card highlights |
| Secondary | `#F2735A` | `--color-secondary` | Regenerate button, accent highlights |
| Secondary Hover | `#E8614A` | `--color-secondary-hover` | Secondary button hover |

### Neutrals

| Role | Hex | CSS Variable | Usage |
|---|---|---|---|
| Canvas Background | `#F5F3EF` | `--color-canvas-bg` | Isometric grid area |
| Panel Background | `#FFFFFF` | `--color-panel-bg` | Sidebars, toolbars, dialogs |
| Card Background | `#FAFAF8` | `--color-card-bg` | List items, cards within panels |
| Border | `#E8E5E0` | `--color-border` | Panel borders, card borders, dividers |
| Input Background | `#F8F6F3` | `--color-input-bg` | Search fields, text inputs |
| Hover Background | `#F0EDEA` | `--color-hover-bg` | Inactive pills, unselected tabs |

### Text

| Role | Hex | CSS Variable | Usage |
|---|---|---|---|
| Text Primary | `#2D2D2D` | `--color-text-primary` | Headings, labels, item names |
| Text Secondary | `#7A7A7A` | `--color-text-secondary` | Descriptions, hints, metadata |

### Status

| Role | Hex | CSS Variable | Usage |
|---|---|---|---|
| Success | `#4CAF82` | `--color-success` | Approved, completed, active |
| Warning | `#F5A623` | `--color-warning` | Price changes, staleness, pending |
| Warning Background | `#FFF8EC` | `--color-warning-bg` | Warning banner background |
| Warning Text | `#8B6914` | `--color-warning-text` | Warning banner text |
| Error | `#E54D42` | `--color-error` | Rejected, inactive, failed |

### Gradients

| Usage | CSS |
|---|---|
| Logo / brand accent | `linear-gradient(135deg, #2BA8A0, #238C85)` |
| Secondary action buttons | `linear-gradient(135deg, #F2735A, #E8614A)` |
| Grand total card | `linear-gradient(135deg, #2BA8A0, #238C85)` |

---

## Typography

### Font

```css
font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
```

Inter via Google Fonts. Thai text falls back to the device's native Thai font (Sarabun on Android, Thonburi on iOS/macOS).

### Type Scale

| Role | Size | Weight | Example usage |
|---|---|---|---|
| App title | 15px | 700 | "LEANOVATE" in top bar |
| Section header | 11px uppercase | 700, letter-spacing 0.5px | "ROOM", "FINISHES", "FURNITURE" |
| Item name | 12–13px | 600 | Furniture names, room names |
| Body | 12px | 400–500 | Descriptions, labels |
| Hint | 10–11px | 400 | Category tags, color names |
| Price | 13px | 600 | `฿24,990` |
| Grand total | 24px | 800 | Cost summary total |
| Badge | 9px | 600 | "GLOBAL", "PENDING" |

### Currency

- Thai Baht prefix: `฿`
- Thousand separators: `฿24,990` (use `toLocaleString()`)
- No decimal places for whole amounts

---

## Spacing

Based on 4px increments:

| Token | Value | Usage |
|---|---|---|
| `--space-xs` | 4px | Gaps between pills, swatches |
| `--space-sm` | 6px | List item gaps, inner card margins |
| `--space-md` | 8–10px | Card padding, section margins |
| `--space-lg` | 12px | Panel padding, section spacing |
| `--space-xl` | 16px | Top bar padding, major gaps |

---

## Border Radius

| Token | Value | Usage |
|---|---|---|
| `--radius-sm` | 4–6px | Pills, badges, small buttons, swatches |
| `--radius-md` | 8px | Cards, inputs, standard buttons |
| `--radius-lg` | 10px | Furniture cards, action buttons, panel sections |
| `--radius-xl` | 12px | Grand total card, major containers |

---

## Shadows

| Token | Value | Usage |
|---|---|---|
| `--shadow-sm` | `0 1px 3px rgba(0,0,0,0.04)` | Top bar, subtle elevation |
| `--shadow-md` | `0 2px 8px rgba(0,0,0,0.08)` | Floating controls, tooltips |
| `--shadow-lg` | `0 4px 16px rgba(0,0,0,0.12)` | Dialogs, modals, dropdowns |

---

## Icons

Use **Lucide React** (`lucide-react`) for all icons. It's included with shadcn/ui.

---

## Transitions

All interactive elements:

```css
transition: all 0.15s ease;
```

---

## Component Styling Specs

These define how reusable UI components should look. What they *do* and where they appear is defined in `product-spec.md`.

### Status Dot

8px colored circle indicating status. Inline before item names, 6px margin-right.

| Status | Color |
|---|---|
| Approved | `--color-success` |
| Pending | `--color-warning` |
| Draft | `--color-text-secondary` |
| Rejected | `--color-error` |

### Price Tag

- Normal: `--color-primary`, 13px, weight 600
- Changed: `--color-error`, with a small warning icon appended
- Format: `฿24,990`

### Color Swatches

- Small (in lists): 18px, border-radius 6px
- Large (in properties panel): 28px, border-radius 8px
- Selected: 2.5px solid `--color-primary`
- Unselected: 2px solid `--color-border`
- Large swatches show color name below (9px)

### Pills (Category / Style)

- Padding: 4–5px 10–12px
- Border radius: 6–8px
- Active: `--color-primary` background, white text
- Inactive: `--color-hover-bg` background, `--color-text-secondary`
- Font: 11–12px, weight 500

### Tab Switcher

- Full-width, evenly split buttons
- Active: `--color-primary` text, 2px solid `--color-primary` bottom border
- Inactive: `--color-text-secondary`, transparent bottom border
- Font: 12px, weight 600
- Container bottom border: 1px solid `--color-border`

### Cards (List Items)

- Padding: 10px
- Border radius: 10px (`--radius-lg`)
- Background: `--color-card-bg`
- Border: 1px solid `--color-border`
- Selected: background `--color-primary-light`, border 1.5px solid `--color-primary`
- Margin-bottom: 6px

### Buttons

| Type | Background | Text | Border |
|---|---|---|---|
| Primary filled | `--color-primary` | white | none |
| Primary outline | transparent | `--color-primary` | 1.5px solid `--color-primary` |
| Secondary filled | coral gradient | white | none |
| Danger | `--color-error` | white | none |
| Ghost | transparent | `--color-text-secondary` | none |

All buttons: 12px weight 600, border-radius 8px, padding 6px 16px.

### Dashed Action Button (e.g. "Add Furniture")

- Width: 100%
- Border: 1.5px dashed `--color-primary`
- Background: `--color-primary-light`
- Text: `--color-primary`, 13px, weight 600
- Border radius: 10px

### Badge

- Font: 9px, weight 600
- Padding: 2px 6px
- Border radius: 4px
- Background: `--color-primary` (or status color as needed)
- Color: white

### Alert Banner (Floating)

- Background: `--color-warning-bg`
- Border: 1px solid `--color-warning` at 25% opacity
- Border radius: 10px
- Shadow: `--shadow-md`
- Text: 12px, `--color-warning-text`, weight 500
- Contains: icon + message + small action button

### Floating Control Bar (e.g. Rotation)

- Background: `rgba(255,255,255,0.9)` with `backdrop-filter: blur(8px)`
- Border radius: 10px
- Shadow: `--shadow-md`
- Buttons inside: 36×32px, border-radius 7px
- Active: `--color-primary` background, white text
- Inactive: transparent, `--color-text-secondary`

### Highlight Card (e.g. Grand Total)

- Background: primary gradient
- Border radius: 12px
- Padding: 14px
- All text: white
- Label: 11px, weight 500, 80% opacity
- Main value: 24px, weight 800, letter-spacing -0.5px
- Sub text: 11px, 70% opacity

### Subtotal Row

- Background: `--color-primary-light`
- Border radius: 8px
- Padding: 8px 10px
- Label: 12px, weight 600
- Amount: 13px, weight 700, `--color-primary`

---

## Dark Mode

Not in MVP scope. Can be added post-MVP by inverting the CSS variable palette.
