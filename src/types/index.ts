/* ============================================
   Shared type definitions for LEANOVATE
   Derived from docs/schema.md
   ============================================ */

// --- Enums ---

export type UserRole = 'admin' | 'designer'
export type ItemStatus = 'draft' | 'pending' | 'approved' | 'rejected'
export type RenderStatus = 'waiting' | 'processing' | 'completed' | 'failed'
export type RenderApprovalStatus = 'pending' | 'approved' | 'rejected'
export type LinkStatus = 'active' | 'inactive' | 'unchecked'
export type BlockSize = 'big' | 'small'
export type ProjectStatus = 'draft' | 'completed'
// NOTE: door/window are no longer finish types — doors and windows are placed
// individually as fixtures (see FixturePickerPanel + placed_furniture). The
// DB enum still has them for historical rows but the app never writes new
// ones. Lighting stays as a type placeholder for the deferred ceiling-light
// feature (hidden from the UI for now).
export type FinishType = 'wall' | 'floor' | 'lighting'
export type CurtainStyle = 'none' | 'open' | 'closed'
export type MountType = 'floor' | 'wall'
export type FlatOrientation = 'horizontal' | 'vertical'
export type ArtScope = 'private' | 'team'

// --- Auth & Team ---

export interface Profile {
  id: string
  role: UserRole
  display_name: string
  avatar_url: string | null
  created_at: string
}

// --- Projects ---

export interface Project {
  id: string
  owner_id: string
  name: string
  description: string | null
  status: ProjectStatus
  unit_width_cm: number
  unit_height_cm: number
  manual_costs: Record<string, number>
  /** Cached isometric snapshot of the primary room, shown on dashboard cards. Null until first save. Path in the `thumbnails` bucket: `projects/{project_id}.png`. */
  thumbnail_path: string | null
  created_at: string
  updated_at: string
}

export type LightingPreset = 'warm' | 'neutral' | 'cool' | 'custom'

/**
 * Ceiling-light settings stored per room (JSONB, no column migration needed).
 * `material_id` picks the fixture style (see `finish_materials` WHERE type='lighting').
 * Presets set temperature + intensity; moving a slider flips `preset` to 'custom'
 * but keeps the values. `enabled=false` is "Off" — light is skipped at render time
 * but settings are preserved so toggling back restores the last state.
 */
export interface RoomLightingFinish {
  material_id: string | null
  custom_url: string | null
  enabled: boolean
  preset: LightingPreset
  temperature_k: number   // 2200–6500
  intensity: number       // 0–1
}

export interface RoomFinishes {
  wall?: { material_id: string | null; custom_url: string | null }
  floor?: { material_id: string | null; custom_url: string | null }
  lighting?: RoomLightingFinish
}

// --- Room Geometry (polygon vertices + doors/windows on walls) ---

export type PhysicalWall = 'north' | 'east' | 'south' | 'west'

/** A 2D point in room-local metres. u = width axis, v = depth axis. */
export interface RoomVertex {
  u: number
  v: number
}

export interface RoomDoor {
  id: string
  wall_index: number  // segment index into geometry.vertices
  position: number    // 0-1 along the wall segment
  width_m: number     // width in metres (default 0.8)
  height_m?: number   // height from floor in metres (default ~ceiling×0.82)
  /** Catalog variant this fixture renders. Null → fall back to generic panel. */
  variant_id?: string | null
  wall?: PhysicalWall // DEPRECATED: kept for backward compat migration
}

export interface RoomWindow {
  id: string
  wall_index: number  // segment index into geometry.vertices
  position: number
  width_m: number     // width in metres (default 1.0)
  height_m?: number   // window opening height in metres (default ~ceiling×0.48)
  sill_m?: number     // sill height from floor in metres (default ~ceiling×0.30)
  curtain_style?: CurtainStyle  // default 'none'
  curtain_color?: string        // hex string e.g. '#F5F0E8', default linen
  /** Catalog variant this fixture renders. Null → fall back to generic frame+glass. */
  variant_id?: string | null
  wall?: PhysicalWall // DEPRECATED: kept for backward compat migration
}

export interface RoomGeometry {
  vertices?: RoomVertex[]  // CCW polygon. If absent → fallback to rectangle from width_cm/height_cm
  doors?: RoomDoor[]
  windows?: RoomWindow[]
}

export interface Room {
  id: string
  project_id: string
  name: string
  x: number
  y: number
  width_cm: number
  height_cm: number
  ceiling_height_cm: number
  geometry: RoomGeometry
  finishes: RoomFinishes
  sort_order: number
  preview_image_url: string | null
  created_at: string
}

// --- Furniture Catalog ---

export interface FurnitureCategory {
  id: string
  name: string
  icon: string | null
  sort_order: number
  is_flat: boolean
  default_block_size: BlockSize
  /** 'floor' = normal furniture (X/Z grid placement); 'wall' = door/window (wall-attached). */
  mount_type: MountType
  /** 'horizontal' = rug-style plane on floor; 'vertical' = upright plane (picture frame). Only meaningful when is_flat=true. */
  flat_orientation: FlatOrientation
  /** True when items in this category are picture-frame style (designer picks art to fill the mat opening). */
  accepts_art: boolean
}

export interface Style {
  id: string
  name: string
  sort_order: number
}

export interface FurnitureItem {
  id: string
  name: string
  category_id: string
  /** Null for wall fixtures (no purchase link). */
  source_url: string | null
  source_domain: string
  width_cm: number | null
  depth_cm: number | null
  height_cm: number | null
  description: string | null
  status: ItemStatus
  is_flat_override: boolean | null
  block_size_override: BlockSize | null
  /** Inner mat rectangle in cm for frame-style items. Required when the item's category has accepts_art=true. */
  mat_opening_cm: { w: number; h: number } | null
  submitted_by: string
  reviewed_by: string | null
  reviewed_at: string | null
  hidden_at: string | null
  hidden_by: string | null
  created_at: string
  updated_at: string
}

export interface FurnitureVariant {
  id: string
  furniture_item_id: string
  color_name: string
  price_thb: number | null
  source_url: string | null
  width_cm: number | null
  depth_cm: number | null
  height_cm: number | null
  original_image_urls: string[]
  glb_path: string | null
  /** Cached isometric snapshot of the .glb, shown as the catalog tile image. Null for flat items or legacy/unrendered. */
  thumbnail_path: string | null
  render_status: RenderStatus
  render_approval_status: RenderApprovalStatus
  link_status: LinkStatus
  last_checked_at: string | null
  price_changed: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

// --- Placed Furniture ---

export interface PlacedFurniture {
  id: string
  room_id: string
  furniture_item_id: string
  selected_variant_id: string
  /** Horizontal position in room-local cm. */
  x_cm: number
  /** Vertical offset in cm. 0 = floor; non-zero = wall-mounted (art, mirrors, wall shelves). */
  y_cm: number
  /** Depth position in room-local cm (Three.js Y axis is up, so this is the old "y"). */
  z_cm: number
  /** Rotation in degrees, 0–360. Replaces the old 4-direction enum. */
  rotation_deg: number
  price_at_placement: number | null
  scale_factor: number
  sort_order: number
  /** Art image to render inside the frame's mat opening. Null = empty frame. Only meaningful when the furniture_item is a picture frame (category.accepts_art). */
  art_id: string | null
  created_at: string
}

// --- Art Library ---

export interface ArtImage {
  id: string
  uploaded_by: string
  name: string
  /** Path within the `frame-art` storage bucket. Resolve to a public URL via getPublicStorageUrl. */
  image_path: string
  /** width / height, used to filter art that fits a given frame's mat opening. */
  aspect_ratio: number
  scope: ArtScope
  created_at: string
  updated_at: string
}

// --- Finish Materials ---

export interface FinishMaterial {
  id: string
  type: FinishType
  name: string
  thumbnail_path: string
  texture_url: string | null
  tile_size_cm: number | null
  is_custom: boolean
  uploaded_by: string | null
  created_at: string
}

// --- Templates ---

export interface UnitLayoutTemplate {
  id: string
  name: string
  created_by: string
  is_global: boolean
  promoted_by: string | null
  unit_width_cm: number
  unit_height_cm: number
  rooms_data: Array<{
    name: string
    x: number
    y: number
    width_cm: number
    height_cm: number
    ceiling_height_cm: number
    geometry: RoomGeometry
    finishes: RoomFinishes
    sort_order: number
  }>
  created_at: string
}

export interface FurnitureLayoutSlot {
  category_id: string
  room_name: string
  x_cm: number
  z_cm: number
  rotation_deg: number
}

export interface FurnitureLayoutTemplate {
  id: string
  name: string
  created_by: string
  is_global: boolean
  promoted_by: string | null
  layout_data: FurnitureLayoutSlot[]
  compatible_unit_types: string[] | null
  created_at: string
}

export interface DesignStyleItem {
  category_id: string
  furniture_item_id: string
  variant_id: string
  room_name: string
  x_cm: number
  z_cm: number
  rotation_deg: number
  price_at_save: number | null
}

export interface DesignStyleTemplate {
  id: string
  name: string
  style_id: string
  created_by: string
  is_global: boolean
  promoted_by: string | null
  items_data: DesignStyleItem[]
  created_at: string
}

// --- Staleness ---

export interface StalenessAlert {
  placed_furniture_id: string
  furniture_item_name: string
  variant_color_name: string
  old_price: number | null
  new_price: number | null
  link_inactive: boolean
}
