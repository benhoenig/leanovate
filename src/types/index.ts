/* ============================================
   Shared type definitions for LEANOVATE
   Derived from docs/schema.md
   ============================================ */

// --- Enums ---

export type UserRole = 'admin' | 'designer'
export type ItemStatus = 'draft' | 'pending' | 'approved' | 'rejected'
export type ImageStatus = 'processing' | 'pending_approval' | 'approved' | 'rejected'
export type RenderStatus = 'waiting' | 'processing' | 'completed' | 'failed'
export type Direction = 'front_left' | 'front_right' | 'back_left' | 'back_right'
export type LinkStatus = 'active' | 'inactive' | 'unchecked'
export type ProjectStatus = 'draft' | 'completed'
export type FinishType = 'wall' | 'floor' | 'door' | 'window' | 'lighting'

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
  created_at: string
  updated_at: string
}

export interface RoomFinishes {
  wall?: { material_id: string | null; custom_url: string | null }
  floor?: { material_id: string | null; custom_url: string | null }
  door?: { material_id: string | null; custom_url: string | null }
  window?: { material_id: string | null; custom_url: string | null }
  lighting?: { material_id: string | null; custom_url: string | null }
}

// --- Room Geometry (doors/windows on walls) ---

export type PhysicalWall = 'north' | 'east' | 'south' | 'west'

export interface RoomDoor {
  id: string
  wall: PhysicalWall
  position: number  // 0-1 along the wall
  width_m: number   // width in metres (default 0.8)
}

export interface RoomWindow {
  id: string
  wall: PhysicalWall
  position: number
  width_m: number   // width in metres (default 1.0)
}

export interface RoomGeometry {
  walls?: unknown[]
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
  source_url: string
  source_domain: string
  width_cm: number | null
  depth_cm: number | null
  height_cm: number | null
  description: string | null
  status: ItemStatus
  submitted_by: string
  reviewed_by: string | null
  reviewed_at: string | null
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
  original_image_url: string
  clean_image_url: string | null
  image_status: ImageStatus
  glb_path: string | null
  render_status: RenderStatus
  link_status: LinkStatus
  last_checked_at: string | null
  price_changed: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface FurnitureSprite {
  id: string
  variant_id: string
  direction: Direction
  image_path: string
  created_at: string
}

// --- Placed Furniture ---

export interface PlacedFurniture {
  id: string
  room_id: string
  furniture_item_id: string
  selected_variant_id: string
  x: number
  y: number
  direction: Direction
  price_at_placement: number | null
  sort_order: number
  created_at: string
}

// --- Finish Materials ---

export interface FinishMaterial {
  id: string
  type: FinishType
  name: string
  thumbnail_path: string
  is_custom: boolean
  uploaded_by: string | null
  created_at: string
}
