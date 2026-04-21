import { blockStepCm } from '@/lib/blockGrid'
import { useCatalogStore } from '@/stores/useCatalogStore'

/** Effective grid step (cm) for a given item — respects block_size_override. */
export function getGridStepCm(itemId: string): number {
  const catalog = useCatalogStore.getState()
  const item = catalog.items.find((i) => i.id === itemId)
  if (!item) return blockStepCm('big')
  const effective =
    item.block_size_override ??
    catalog.categories.find((c) => c.id === item.category_id)?.default_block_size ??
    'big'
  return blockStepCm(effective)
}

/** Snap a cm value to the nearest multiple of step (or pass-through if bypass). */
export function snapCm(valCm: number, stepCm: number, bypass: boolean): number {
  if (bypass) return valCm
  return Math.round(valCm / stepCm) * stepCm
}

/**
 * Resolve physical dimensions (width + height in metres) for a fixture
 * during placement. Falls back to sensible defaults when no variant is
 * picked (generic fallback fixture).
 */
export function getFixtureDims(
  itemId: string | null,
  variantId: string | null,
  type: 'door' | 'window' | null,
): { widthM: number; heightM: number } {
  const defaults = type === 'door'
    ? { widthM: 0.8, heightM: 2.1 }
    : { widthM: 1.2, heightM: 1.2 }
  if (!itemId) return defaults
  const catalog = useCatalogStore.getState()
  const item = catalog.items.find((i) => i.id === itemId)
  if (!item) return defaults
  const variants = catalog.variants[itemId] ?? []
  const variant = variantId ? variants.find((v) => v.id === variantId) : undefined
  const widthCm = variant?.width_cm ?? item.width_cm ?? null
  const heightCm = variant?.height_cm ?? item.height_cm ?? null
  return {
    widthM: widthCm != null ? widthCm / 100 : defaults.widthM,
    heightM: heightCm != null ? heightCm / 100 : defaults.heightM,
  }
}
