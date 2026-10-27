// Owner: viewer. abcjs is loaded on demand (its own chunk), so screens that never show a score
// do not pay for it. The promise is shared by the paper, the player and the print export.
export type Abcjs = typeof import('abcjs')
export type TuneObject = import('abcjs').TuneObject

let pending: Promise<Abcjs> | null = null

export function loadAbcjs(): Promise<Abcjs> {
  if (!pending) {
    pending = import('abcjs')
      .then((mod) => {
        const m = mod as unknown as Abcjs & { default?: Abcjs }
        return m.default ?? m
      })
      .catch((err) => {
        pending = null
        throw err
      })
  }
  return pending
}
