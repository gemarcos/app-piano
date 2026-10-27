// Owner: share. What to do with something shared to Pauta (Android share sheet -> service worker -> #/shared).
// Pure decisions, no DOM: a media file goes to Import (trim), a link to the player screen, anything else Home.
import { pickLink, type SharedLink } from './links'

export interface SharePayload {
  title: string
  text: string
  url: string
  files: File[]
  /** The service worker could not read the share. */
  error?: boolean
}

export type IntakeDecision =
  | { kind: 'file'; file: File }
  | { kind: 'link'; link: SharedLink }
  | { kind: 'not-media' }
  | { kind: 'error' }
  | { kind: 'empty' }

/** Larger files are refused before decoding (the whole file is decoded in memory, as on Home). */
export const MAX_SHARED_FILE_BYTES = 750 * 1024 * 1024

export const INTAKE_MESSAGES = {
  'not-media': 'Este archivo no es de audio ni de vídeo.',
  error: 'No se pudo abrir lo compartido.',
  empty: 'No se encontró audio, vídeo ni enlace.',
  tooBig: 'Este archivo es demasiado grande.',
} as const

const MEDIA_EXTENSIONS = new Set([
  'mp3', 'm4a', 'aac', 'wav', 'wave', 'ogg', 'oga', 'opus', 'flac', 'weba', 'aif', 'aiff', 'caf', 'amr',
  'mp4', 'm4v', 'mov', 'qt', 'webm', 'mkv', '3gp', '3g2', 'avi', 'ogv', 'mpg', 'mpeg', 'ts', 'mts',
])

/** Audio or video, by MIME type or (when the type is missing or generic) by extension. */
export function isMediaFile(file: { name: string; type: string }): boolean {
  const type = (file.type || '').toLowerCase()
  if (type.startsWith('audio/') || type.startsWith('video/')) return true
  if (type && type !== 'application/octet-stream' && type !== 'binary/octet-stream') return false
  const name = file.name || ''
  const dot = name.lastIndexOf('.')
  return dot > 0 && MEDIA_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())
}

/** Files win (they go straight to Import), then a link in url / text / title. */
export function decideIntake(payload: SharePayload | null): IntakeDecision {
  if (!payload) return { kind: 'empty' }
  const files = payload.files.filter((f) => f && f.size > 0)
  const media = files.find(isMediaFile)
  if (media) return { kind: 'file', file: media }
  const link = pickLink(payload.url, payload.text, payload.title)
  if (link) return { kind: 'link', link }
  if (files.length) return { kind: 'not-media' }
  if (payload.error) return { kind: 'error' }
  return { kind: 'empty' }
}

/** A share passed in the query of #/shared (?title=&text=&url=, or ?error=1 from the service worker). */
export function payloadFromParams(params: URLSearchParams): SharePayload | null {
  const title = params.get('title') ?? ''
  const text = params.get('text') ?? ''
  const url = params.get('url') ?? ''
  const error = params.get('error') === '1'
  if (!title && !text && !url && !error) return null
  return { title, text, url, files: [], error }
}
