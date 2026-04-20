# Designer Workflow — Preparing Product Photos for 3D Generation

> **Document scope:** How designers should prepare messy real-world product photos before uploading them to Leanovate so TRELLIS produces clean, usable 3D models.
>
> This workflow is deliberately kept **external to the app** for v1. The app does not ship a built-in preprocessing step — designers handle messy inputs themselves before upload.

---

## When this matters

TRELLIS produces its best 3D models from clean product shots:
- Single item centered in frame
- Pure or near-pure background (white, light grey)
- Multiple angles (front, 3/4, side)
- No lifestyle/context elements (no humans, no other furniture, no room backgrounds)

Most real source photos from Shopee, IKEA, Facebook Marketplace, etc. are **not** like this. They're lifestyle shots, cluttered scenes, product-in-use photos, or single-angle composites.

If you upload those directly, TRELLIS output quality will be poor — distorted geometry, blended textures, phantom limbs from background objects. The fix is to prep the photo externally before uploading.

---

## The tool: Nano Banana (Google Gemini)

Open Google Gemini and use image generation (codename: Nano Banana).

### Prompt template

Upload the messy source photo and paste:

```
Isolate only the [item type] from this image. Generate [N] separate
clean product shots on pure white background: front view, 3/4 angle
view, side view. Output as separate images, not a composite.
```

Fill in `[item type]` (e.g. "sofa", "coffee table", "floor lamp") and `[N]` (typically 2–4).

### Why this works

- Gemini's image model can cleanly isolate objects even from busy scenes
- Asking for multiple angles gives you the multi-image input that TRELLIS wants
- Pure white backgrounds match what TRELLIS is trained on
- "Separate images, not a composite" avoids Gemini cramming all angles into one image

### What to upload to Leanovate

The 2–4 clean Gemini outputs. In the Add Furniture modal, upload all of them to the same variant. The first image becomes the primary (shown as the canvas placeholder). TRELLIS uses all of them together.

---

## Shortcuts

- **If the source photo is already clean** (seller used a studio shot), you can skip Gemini and upload directly — single image mode works, just lower quality than multi-angle.
- **If Gemini outputs one angle well but another is distorted**, keep the good ones and drop the bad. Better to give TRELLIS 2 clean shots than 4 mixed-quality shots.
- **If the product is flat** (rug, wall art, curtains), skip all of this. Mark the category as `is_flat` (or set `is_flat_override` on the item) and upload a single clean shot — TRELLIS is bypassed entirely.

---

## When Nano Banana isn't enough

Some products don't produce good 3D models no matter how clean the input:
- Transparent / glass (vases, glass tabletops, acrylic)
- Highly reflective (chrome, mirror finishes)
- Very thin (wire frames, minimalist legs)
- Complex mesh (baskets, woven textures)

For these, two options:
1. Set `is_flat_override = true` and treat as a 2D sprite
2. Skip 3D and use the uploaded photo directly as the canvas asset (same effect as flat bypass)

---

## Why external

Keeping this workflow out of the app for v1:
- Nano Banana rate limits + API cost would hit Leanovate instead of the designer's free personal quota
- The prep step is one-off per variant — designers batch prep a set of items, then upload all at once
- The prep logic evolves faster than the app can ship updates (prompt tweaks, new models)
- If a designer's Gemini output is bad, they fix it in Gemini and re-upload — no app bugs to debug

Post-v1, if prep becomes a bottleneck, we can evaluate:
- Built-in integration with the chosen image model
- A "prep queue" tab in the app that shows un-prepped items
- Auto-detection of low-quality source photos with a warning before TRELLIS runs
