import type { SVGProps } from 'react'
import { Equal } from '@untitled-ui/icons-react'

/**
 * Untitled UI (free) has no bare "pause" icon, only PauseCircle/PauseSquare.
 * This is the Untitled `Equal` glyph turned 90deg: two vertical bars that match the Play triangle.
 * Use it like any icon: <Icon icon={PauseIcon} /> or <IconButton icon={PauseIcon} … />.
 */
export function PauseIcon(props: SVGProps<SVGSVGElement>) {
  return <Equal {...props} style={{ ...props.style, transform: 'rotate(90deg)' }} />
}
