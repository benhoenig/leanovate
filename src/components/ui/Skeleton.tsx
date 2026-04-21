import { CSSProperties } from 'react'

interface SkeletonProps {
  className?: string
  style?: CSSProperties
  width?: number | string
  height?: number | string
  radius?: number | string
}

export function Skeleton({ className, style, width, height, radius = 6 }: SkeletonProps) {
  return (
    <div
      className={className ? `skeleton ${className}` : 'skeleton'}
      style={{ width, height, borderRadius: radius, ...style }}
    >
      <style>{`
        .skeleton {
          display: inline-block;
          background: linear-gradient(
            90deg,
            var(--color-hover-bg) 0%,
            var(--color-border-custom) 50%,
            var(--color-hover-bg) 100%
          );
          background-size: 200% 100%;
          animation: skeleton-shimmer 1.4s ease-in-out infinite;
        }
        @keyframes skeleton-shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .skeleton { animation: none; }
        }
      `}</style>
    </div>
  )
}
