import Dexie, { type EntityTable } from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import type { AudioDoc, ScoreDoc } from '../types'
import { newId } from '../lib/id'

class PautaDB extends Dexie {
  scores!: EntityTable<ScoreDoc, 'id'>
  audio!: EntityTable<AudioDoc, 'id'>

  constructor() {
    super('pauta')
    // Booleans can't be indexed in IndexedDB: favorites are filtered in memory.
    this.version(1).stores({
      scores: 'id, title, createdAt, updatedAt, openedAt, source',
      audio: 'id, createdAt',
    })
  }
}

export const db = new PautaDB()

export type NewScoreInput = Omit<ScoreDoc, 'id' | 'createdAt' | 'updatedAt'> & Partial<Pick<ScoreDoc, 'id'>>

/** Creates a library item and returns it. */
export async function createScore(input: NewScoreInput): Promise<ScoreDoc> {
  const now = Date.now()
  const doc: ScoreDoc = { ...input, id: input.id ?? newId(), createdAt: now, updatedAt: now }
  await db.scores.put(doc)
  return doc
}

/** Partial update; bumps updatedAt unless `touch` is false (e.g. when only recording openedAt). */
export async function updateScore(id: string, patch: Partial<Omit<ScoreDoc, 'id'>>, touch = true): Promise<void> {
  await db.scores.update(id, touch ? { ...patch, updatedAt: Date.now() } : patch)
}

export async function getScore(id: string): Promise<ScoreDoc | undefined> {
  return db.scores.get(id)
}

/** Deletes the item and its stored audio. */
export async function deleteScore(id: string): Promise<void> {
  await db.transaction('rw', db.scores, db.audio, async () => {
    const doc = await db.scores.get(id)
    if (doc?.audioId) await db.audio.delete(doc.audioId)
    await db.scores.delete(id)
  })
}

/** Copies an item (new id, title suffixed). Audio is shared by reference only if it still exists. */
export async function duplicateScore(id: string, titleSuffix = ' (copia)'): Promise<ScoreDoc | undefined> {
  const doc = await db.scores.get(id)
  if (!doc) return undefined
  const { id: _old, createdAt: _c, updatedAt: _u, audioId, ...rest } = doc
  let newAudioId: string | undefined
  if (audioId) {
    const audio = await db.audio.get(audioId)
    if (audio) newAudioId = await saveAudio(audio.blob, audio.mime)
  }
  return createScore({ ...rest, title: doc.title + titleSuffix, favorite: false, audioId: newAudioId })
}

export async function saveAudio(blob: Blob, mime = blob.type || 'audio/webm'): Promise<string> {
  const id = newId()
  await db.audio.put({ id, blob, mime, createdAt: Date.now() })
  return id
}

export async function getAudio(id: string): Promise<AudioDoc | undefined> {
  return db.audio.get(id)
}

/** Live list of all items, most recently updated first. Undefined while loading. */
export function useAllScores(): ScoreDoc[] | undefined {
  return useLiveQuery(() => db.scores.orderBy('updatedAt').reverse().toArray(), [])
}

/** Live single item. Undefined while loading, null when missing. */
export function useScoreDoc(id: string | undefined): ScoreDoc | null | undefined {
  return useLiveQuery(async () => (id ? ((await db.scores.get(id)) ?? null) : null), [id])
}

const BACKUP_FORMAT = 'pauta-backup'

/** JSON backup of the library (without audio, to keep it small). */
export async function exportBackup(): Promise<Blob> {
  const scores = await db.scores.toArray()
  const payload = {
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    scores: scores.map(({ audioId: _a, ...rest }) => rest),
  }
  return new Blob([JSON.stringify(payload)], { type: 'application/json' })
}

/** Imports a backup file. Existing ids are overwritten. Returns the number of items imported. */
export async function importBackup(file: Blob): Promise<number> {
  const text = await file.text()
  const data = JSON.parse(text) as { format?: string; scores?: ScoreDoc[] }
  if (data.format !== BACKUP_FORMAT || !Array.isArray(data.scores)) {
    throw new Error('El archivo no es una copia de seguridad de Pauta.')
  }
  const valid = data.scores.filter((s) => s && typeof s.id === 'string' && Array.isArray(s.notes) && s.params && s.analysis)
  await db.scores.bulkPut(valid)
  return valid.length
}

/** Removes every item and all stored audio. */
export async function clearLibrary(): Promise<void> {
  await db.transaction('rw', db.scores, db.audio, async () => {
    await db.scores.clear()
    await db.audio.clear()
  })
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (!navigator.storage?.estimate) return null
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    return { usage, quota }
  } catch {
    return null
  }
}
