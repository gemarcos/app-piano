// Owner: share. Home's quiet "Enlace" pill: paste a YouTube or TikTok link and open it in the player screen.
// It covers iPhone and computers, where a web app cannot appear in the share sheet.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Link01 } from '@untitled-ui/icons-react'
import { Button, PromptDialog, useToast } from '../../ui'
import { linkPath, pickLink } from './links'

export function LinkPill({ disabled }: { disabled?: boolean }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [open, setOpen] = useState(false)

  const confirm = (value: string) => {
    const link = pickLink(value)
    if (!link) {
      toast.show('Pega un enlace de YouTube o TikTok.', { tone: 'danger' })
      return
    }
    setOpen(false)
    navigate(linkPath(link))
  }

  return (
    <>
      <Button variant="secondary" icon={Link01} disabled={disabled} onClick={() => setOpen(true)}>
        Enlace
      </Button>
      <PromptDialog
        open={open}
        title="Abrir un enlace"
        initialValue=""
        placeholder="Enlace de YouTube o TikTok"
        confirmLabel="Abrir"
        maxLength={2048}
        onConfirm={confirm}
        onCancel={() => setOpen(false)}
      />
    </>
  )
}
