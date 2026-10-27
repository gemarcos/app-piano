import { motion } from 'motion/react'
import { spring } from './motion'
import { cx } from './cx'
import './Toggle.css'

export interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Needed unless the toggle is labelled by surrounding text via id/aria-labelledby. */
  ariaLabel?: string
  ariaLabelledBy?: string
  disabled?: boolean
  id?: string
  className?: string
}

/** On/off switch (role="switch") with a spring knob. */
export function Toggle({ checked, onChange, ariaLabel, ariaLabelledBy, disabled = false, id, className }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      disabled={disabled}
      className={cx('ui-toggle', checked && 'is-on', className)}
      onClick={() => onChange(!checked)}
    >
      <motion.span className="ui-toggle__knob" initial={false} animate={{ x: checked ? 20 : 0 }} transition={spring} />
    </button>
  )
}
