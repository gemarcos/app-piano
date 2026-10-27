import type { ComponentType, CSSProperties, SVGProps } from 'react'

/** Any icon from @untitled-ui/icons-react. */
export type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

export interface IconProps {
  icon: IconComponent
  /** px; use 16 / 20 / 24 / 28. */
  size?: number
  className?: string
  style?: CSSProperties
}

/** Decorative icon (aria-hidden). Stroke width is unified by CSS (.ui-icon, --icon-stroke). */
export function Icon({ icon: Glyph, size = 24, className = '', style }: IconProps) {
  return (
    <Glyph
      width={size}
      height={size}
      className={className ? `ui-icon ${className}` : 'ui-icon'}
      style={style}
      aria-hidden="true"
      focusable="false"
    />
  )
}
