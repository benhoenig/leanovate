import { useUIStore } from '@/stores/useUIStore'
import { Languages } from 'lucide-react'

interface LanguageToggleProps {
  variant?: 'default' | 'ghost'
  size?: 'sm' | 'md'
}

export default function LanguageToggle({ variant = 'default', size = 'sm' }: LanguageToggleProps) {
  const language = useUIStore((s) => s.language)
  const setLanguage = useUIStore((s) => s.setLanguage)

  const isThai = language === 'th'
  const next = isThai ? 'en' : 'th'
  const label = isThai ? 'EN' : 'ไทย'

  const paddingY = size === 'md' ? 8 : 6
  const paddingX = size === 'md' ? 12 : 10
  const fontSize = size === 'md' ? 13 : 12
  const iconSize = size === 'md' ? 15 : 13

  const baseStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: `${paddingY}px ${paddingX}px`,
    borderRadius: 8,
    fontSize,
    fontWeight: 600,
    cursor: 'pointer',
    border: '1px solid var(--color-border-custom)',
    background: variant === 'ghost' ? 'transparent' : 'var(--color-panel-bg)',
    color: 'var(--color-text-primary)',
    lineHeight: 1,
  }

  return (
    <button
      type="button"
      onClick={() => setLanguage(next)}
      style={baseStyle}
      title={isThai ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย'}
      aria-label={isThai ? 'Switch to English' : 'Switch to Thai'}
    >
      <Languages size={iconSize} strokeWidth={2} />
      <span>{label}</span>
    </button>
  )
}
