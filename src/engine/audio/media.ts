// Pure helpers for media files (no DOM): kind / MIME detection.

const VIDEO_EXTENSIONS = new Set([
  'mp4', 'm4v', 'mov', 'qt', 'webm', 'mkv', 'avi', '3gp', '3g2', 'ogv', 'wmv', 'mpg', 'mpeg', 'ts', 'mts', 'm2ts', 'flv',
])

const MIME_BY_EXTENSION: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  wave: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  weba: 'audio/webm',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  caf: 'audio/x-caf',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  qt: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  '3gp': 'video/3gpp',
  '3g2': 'video/3gpp2',
  ogv: 'video/ogg',
  wmv: 'video/x-ms-wmv',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
}

/** Lower-case extension without the dot ('' when there is none). */
export function fileExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/** MIME type from the file name, for blobs without `type`. */
export function guessMime(name: string): string {
  return MIME_BY_EXTENSION[fileExtension(name)] ?? 'application/octet-stream'
}

/** 'video' for video containers (by MIME first, then by extension), otherwise 'audio'. */
export function mediaKind(mime: string, name: string): 'audio' | 'video' {
  const m = mime.trim().toLowerCase()
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  return VIDEO_EXTENSIONS.has(fileExtension(name)) ? 'video' : 'audio'
}
