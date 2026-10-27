import { useRef, type KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { SearchMd, XClose } from '@untitled-ui/icons-react'
import { Icon } from './Icon'
import { cx } from './cx'
import './SearchField.css'

export interface SearchFieldProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Called after the clear button (or Escape) empties the field. */
  onClear?: () => void
  autoFocus?: boolean
  className?: string
}

/** Light search pill with a clear button. */
export function SearchField({ value, onChange, placeholder = 'Buscar', onClear, autoFocus, className }: SearchFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const clear = () => {
    onChange('')
    onClear?.()
    inputRef.current?.focus()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && value) {
      e.preventDefault()
      e.stopPropagation()
      clear()
    }
  }
  return (
    <div className={cx('ui-search', className)}>
      <Icon icon={SearchMd} size={20} className="ui-search__icon" />
      <input
        ref={inputRef}
        type="search"
        className="ui-search__input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
      />
      <AnimatePresence initial={false}>
        {value && (
          <motion.button
            type="button"
            className="ui-search__clear"
            aria-label="Borrar búsqueda"
            onClick={clear}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ duration: 0.18 }}
          >
            <Icon icon={XClose} size={16} />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}
