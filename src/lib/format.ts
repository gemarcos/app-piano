/** 75.4 -> "1:15" */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const total = Math.floor(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** 1536000 -> "1,5 MB" */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const digits = value >= 10 || unit === 0 ? 0 : 1
  return `${value.toLocaleString('es-ES', { maximumFractionDigits: digits })} ${units[unit]}`
}

const dateFormatter = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' })
const dateYearFormatter = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })

/** "Hoy", "Ayer", "27 oct", "3 ene 2025" */
export function formatDate(timestamp: number, now = Date.now()): string {
  const d = new Date(timestamp)
  const today = new Date(now)
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  if (timestamp >= startOfToday) return 'Hoy'
  if (timestamp >= startOfToday - 86_400_000) return 'Ayer'
  return d.getFullYear() === today.getFullYear() ? dateFormatter.format(d) : dateYearFormatter.format(d)
}

/** Default title for a new transcription: "Grabación 27 oct, 09:41" */
export function defaultTitle(prefix: string, timestamp = Date.now()): string {
  const d = new Date(timestamp)
  const time = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  return `${prefix} ${dateFormatter.format(d)}, ${time}`
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
