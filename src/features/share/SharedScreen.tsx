// Owner: share. #/shared: where Android's share sheet lands (through public/share-target-sw.js). Reads and clears
// what was shared, then: an audio/video file -> Import (trim), a link -> the player screen (/link), anything
// else -> Home with a calm toast. Decode errors show the engine's Spanish message.
import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { DECODE_ERROR_MESSAGE } from '../../engine/audio'
import { Page, Spinner, useToast } from '../../ui'
import { takeSharedPayload } from './inbox'
import { decideIntake, INTAKE_MESSAGES, payloadFromParams } from './intake'
import { linkPath } from './links'
import { openMediaFile } from './openMedia'
import './LinkScreen.css'

export function SharedScreen() {
  const navigate = useNavigate()
  const toast = useToast()
  const [params] = useSearchParams()
  const query = useRef(params)

  useEffect(() => {
    let alive = true
    // The timer swallows StrictMode's mount-unmount-mount, so the inbox is read (and cleared) once.
    const timer = window.setTimeout(async () => {
      const payload = (await takeSharedPayload()) ?? payloadFromParams(query.current)
      if (!alive) return
      const decision = decideIntake(payload)
      if (decision.kind === 'link') {
        navigate(linkPath(decision.link), { replace: true })
        return
      }
      if (decision.kind === 'file') {
        try {
          await openMediaFile(decision.file)
          if (alive) navigate('/import', { replace: true })
        } catch (err) {
          if (!alive) return
          toast.show((err as Error)?.message || DECODE_ERROR_MESSAGE, { tone: 'danger' })
          navigate('/', { replace: true })
        }
        return
      }
      toast.show(INTAKE_MESSAGES[decision.kind], { tone: decision.kind === 'empty' ? 'neutral' : 'danger' })
      navigate('/', { replace: true })
    }, 0)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [navigate, toast])

  return (
    <Page variant="tab" className="share-intake">
      <div className="share-intake__stage" role="status">
        <Spinner size={28} />
        <p className="share-intake__label">Abriendo</p>
      </div>
    </Page>
  )
}
