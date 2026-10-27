// Owner: viewer. React binding of the playback engine: one player per viewer, released on unmount.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ScorePlayer, type PlayerSnapshot, type PlayerSpec } from './player'

/** `spec` should be memoized: every new object is diffed against the previous one. */
export function useScorePlayer(
  spec: PlayerSpec,
  onFrame: (position: number, cursor: boolean) => void,
  onError: (message: string) => void,
): [ScorePlayer, PlayerSnapshot] {
  const [player] = useState(() => new ScorePlayer())
  const frameRef = useRef(onFrame)
  const errorRef = useRef(onError)
  frameRef.current = onFrame
  errorRef.current = onError

  useEffect(() => {
    player.onFrame = (p, c) => frameRef.current(p, c)
    player.onError = (m) => errorRef.current(m)
    return () => player.dispose()
  }, [player])

  useEffect(() => {
    player.update(spec)
  }, [player, spec])

  const snap = useSyncExternalStore(player.subscribe, player.getSnapshot, player.getSnapshot)
  return [player, snap]
}
