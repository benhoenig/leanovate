import { Skeleton } from '@/components/ui/Skeleton'
import { useDelayedTrue } from '@/hooks/useDelayedTrue'

/**
 * Generic admin-list loading placeholder. Renders 4 row placeholders with a
 * thumbnail + two text lines. Gated on a 150ms delay so fast loads don't flash.
 */
export default function AdminListSkeleton({ rows = 4 }: { rows?: number }) {
  const show = useDelayedTrue(true)
  if (!show) return null

  return (
    <div className="admin-list-skeleton">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="admin-list-skeleton-row">
          <Skeleton width={40} height={40} radius={8} />
          <div className="admin-list-skeleton-text">
            <Skeleton width="55%" height={13} />
            <Skeleton width="35%" height={11} />
          </div>
          <Skeleton width={80} height={28} radius={6} />
        </div>
      ))}
      <style>{`
        .admin-list-skeleton {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 16px;
        }
        .admin-list-skeleton-row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px;
          border: 1px solid var(--color-border-custom);
          border-radius: 10px;
          background: var(--color-card-bg);
        }
        .admin-list-skeleton-text {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
      `}</style>
    </div>
  )
}
