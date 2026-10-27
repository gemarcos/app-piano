export function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  } catch {
    // insecure context: fall through
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
