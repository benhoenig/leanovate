import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useCatalogStore } from '@/stores/useCatalogStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import type { RoomDoor, RoomWindow } from '@/types'

export default function FixtureStyleSwatches({ fixture, isDoor, roomId }: {
  fixture: RoomDoor | RoomWindow
  isDoor: boolean
  roomId: string
}) {
  const { t } = useTranslation()
  const categories = useCatalogStore((s) => s.categories)
  const items = useCatalogStore((s) => s.items)
  const variantsMap = useCatalogStore((s) => s.variants)
  const loadItems = useCatalogStore((s) => s.loadItems)
  const loadVariantsForItem = useCatalogStore((s) => s.loadVariantsForItem)
  const switchFixtureVariant = useCanvasStore((s) => s.switchFixtureVariant)

  useEffect(() => {
    if (items.length === 0) loadItems()
  }, [items.length, loadItems])

  const targetCategoryName = isDoor ? 'Door' : 'Window'
  const category = categories.find((c) => c.name === targetCategoryName)
  const fixtureItems = category
    ? items.filter((i) => i.category_id === category.id && i.status === 'approved')
    : []

  useEffect(() => {
    for (const item of fixtureItems) {
      if (!variantsMap[item.id]) loadVariantsForItem(item.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixtureItems.length])

  const allVariants = fixtureItems.flatMap((item) =>
    (variantsMap[item.id] ?? [])
      .filter((v) => v.render_status === 'completed')
      .map((v) => ({ item, variant: v }))
  )

  if (allVariants.length === 0) return null

  return (
    <div className="panel-section">
      <span className="section-title">{t('editor.properties.fixtureStyle')}</span>
      <div className="fp-swatch-grid">
        {allVariants.map(({ item, variant }) => {
          const isSelected = fixture.variant_id === variant.id
          const thumb = variant.original_image_urls?.[0]
          return (
            <button
              key={variant.id}
              className={`fp-swatch ${isSelected ? 'selected' : ''}`}
              onClick={() => void switchFixtureVariant(roomId, fixture.id, variant.id)}
              title={`${item.name} — ${variant.color_name}`}
            >
              {thumb ? (
                <img src={thumb} alt={variant.color_name} className="fp-swatch-img" />
              ) : (
                <span className="fp-swatch-text">{variant.color_name.slice(0, 2)}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
