// Owner: share. Mounts the official player of a link (YouTube or TikTok) into a div React never renders into,
// and hands the player to the screen through `playerRef` (play / pause in the same tap as "Escuchar").
import { useEffect, useRef, type RefObject } from 'react'
import type { SharedLink } from './links'
import { createEmbedPlayer, type EmbedError, type EmbedPlayer, type EmbedState } from './players'

interface EmbedFrameProps {
  link: SharedLink
  playerRef: RefObject<EmbedPlayer | null>
  onReady: () => void
  onState: (state: EmbedState) => void
  onError: (error: EmbedError) => void
  className?: string
}

export function EmbedFrame({ link, playerRef, onReady, onState, onError, className }: EmbedFrameProps) {
  const ref = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onReady, onState, onError })
  callbacks.current = { onReady, onState, onError }

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const player = createEmbedPlayer(el, link, {
      onReady: () => callbacks.current.onReady(),
      onState: (state) => callbacks.current.onState(state),
      onError: (error) => callbacks.current.onError(error),
    })
    playerRef.current = player
    return () => {
      player.destroy()
      if (playerRef.current === player) playerRef.current = null
    }
  }, [link, playerRef])

  return <div ref={ref} className={className} />
}
