/**
 * Block-grid constants for furniture placement.
 *
 * Two grid sizes control how furniture snaps when placing or dragging:
 *   - BIG   — main furniture (sofa, bed, dining table, wardrobe, desk…)
 *   - SMALL — accents (lamp, chair, side table, coffee table…)
 *
 * Per-item `block_size_override` and category `default_block_size` decide
 * which grid applies to a given item. Ctrl/Cmd at drag time bypasses snap.
 */

import type { BlockSize } from '@/types'

export const BIG_BLOCK_CM = 50
export const SMALL_BLOCK_CM = 25

/** Returns the grid step (cm) for a given block size. */
export function blockStepCm(size: BlockSize): number {
  return size === 'small' ? SMALL_BLOCK_CM : BIG_BLOCK_CM
}
