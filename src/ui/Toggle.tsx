import { useState } from 'react'
import { motion } from 'motion/react'
import { spring } from './motion'
import { playUiSound } from './sound'
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

/** On/off switch (role="switch"): a spring knob that stretches while pressed, a gradient track when on, a soft cue. */
export function Toggle({ checked, onChange, ariaLabel, ariaLabelledBy, disabled = false, id, className }: ToggleProps) {
  const [pressing, setPressing] = useState(false)
  // Pressed, the knob widens towards the side it will travel to (iOS-like squish).
  const width = pressing ? 34 : 28
  const x = checked ? 20 - (width - 28) : 0
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
      onPointerDown={() => setPressing(true)}
      onPointerUp={() => setPressing(false)}
      onPointerLeave={() => setPressing(false)}
      onPointerCancel={() => setPressing(false)}
      onClick={() => {
        playUiSound(checked ? 'toggleOff' : 'toggleOn')
        onChange(!checked)
      }}
    >
      <span className="ui-toggle__fill" aria-hidden="true" />
      <motion.span className="ui-toggle__knob" initial={false} animate={{ x, width }} transition={spring} />
    </button>
  )
}
