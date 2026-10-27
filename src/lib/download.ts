/** "Minueto en Sol / 2" -> "Minueto en Sol - 2" (safe for file systems). */
export function safeFileName(title: string, fallback = 'partitura'): string {
  const cleaned = title
    .normalize('NFC')
    .replace(/[\\/:*?"<>|]+/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return cleaned || fallback
}

/** Triggers a browser download for a blob. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** True when the Web Share API can share files on this device. */
export function canShareFiles(): boolean {
  try {
    const probe = new File([''], 'x.txt', { type: 'text/plain' })
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] })
  } catch {
    return false
  }
}

/**
 * Shares a file with the native share sheet when possible, otherwise downloads it.
 * Resolves 'shared' | 'downloaded' | 'cancelled'.
 */
export async function shareOrDownload(blob: Blob, fileName: string, title: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], fileName, { type: blob.type })
  try {
    if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title })
      return 'shared'
    }
  } catch (err) {
    if ((err as DOMException)?.name === 'AbortError') return 'cancelled'
  }
  downloadBlob(blob, fileName)
  return 'downloaded'
}

export const MIME = {
  musicxml: 'application/vnd.recordare.musicxml+xml',
  midi: 'audio/midi',
  abc: 'text/vnd.abc',
  json: 'application/json',
} as const
