import type { FurnitureVariant } from '@/types'

/**
 * Apply a partial update to a single variant across the item-keyed variants
 * map. Preserves immutability — returns a new map only touching the affected
 * item's list.
 */
export function mapVariant(
  variants: Record<string, FurnitureVariant[]>,
  variantId: string,
  updates: Partial<FurnitureVariant>,
): Record<string, FurnitureVariant[]> {
  const out: Record<string, FurnitureVariant[]> = {}
  for (const [itemId, list] of Object.entries(variants)) {
    out[itemId] = list.map((v) => (v.id === variantId ? { ...v, ...updates } : v))
  }
  return out
}
