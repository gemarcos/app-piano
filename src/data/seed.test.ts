// Owner: library. Demo seeding: exactly once per device, deleted demos stay deleted, restore adds the missing.
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScoreDoc } from '../types'

/** Minimal Web Storage for node (seed.ts reads the flag from globalThis.localStorage). */
class MemoryStorage {
  private map = new Map<string, string>()
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value))
  }
  removeItem(key: string) {
    this.map.delete(key)
  }
  clear() {
    this.map.clear()
  }
}

const storage = new MemoryStorage()

/**
 * Fresh module graph over the same IndexedDB + localStorage: like reloading the app.
 * (fake-indexeddb keeps the data; seed.ts / db.ts / settings get new module state.)
 */
async function reload() {
  vi.resetModules()
  const dbModule = await import('./db')
  const seed = await import('./seed')
  const demos = await import('./demos')
  const engine = await import('../engine/score')
  const settings = await import('../state/settings')
  const images = await import('../assets/images')
  return { ...dbModule, ...seed, ...demos, ...engine, ...settings, ...images }
}

const DEMO_IDS = ['demo-oda-alegria', 'demo-minueto-sol', 'demo-preludio-do']

const ids = async (app: Awaited<ReturnType<typeof reload>>) => (await app.db.scores.toArray()).map((d) => d.id).sort()

beforeEach(async () => {
  vi.stubGlobal('localStorage', storage)
  storage.clear()
  const app = await reload()
  await app.db.scores.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('seedDemosOnce', () => {
  it('adds the three demos once, even when called twice at the same time (StrictMode)', async () => {
    const app = await reload()
    const a = app.seedDemosOnce()
    const b = app.seedDemosOnce()
    expect(b).toBe(a)
    await Promise.all([a, b])
    await app.seedDemosOnce()
    expect(await ids(app)).toEqual([...DEMO_IDS].sort())
    expect(storage.getItem(app.DEMOS_SEEDED_KEY)).toBe('1')
    expect(app.isDemoSeedSettled()).toBe(true)
  })

  it('keeps exactly three demos across reloads', async () => {
    for (let i = 0; i < 3; i++) {
      const app = await reload()
      await app.seedDemosOnce()
      expect(await app.db.scores.count()).toBe(3)
    }
  })

  it('does not bring back deleted demos or undo "Borrar biblioteca" after a reload', async () => {
    let app = await reload()
    await app.seedDemosOnce()
    await app.deleteScore('demo-minueto-sol')

    app = await reload()
    await app.seedDemosOnce()
    expect(await ids(app)).toEqual(['demo-oda-alegria', 'demo-preludio-do'])

    await app.clearLibrary()
    app = await reload()
    await app.seedDemosOnce()
    expect(await app.db.scores.count()).toBe(0)
  })

  it('never rejects, and retries on the next run when the database fails', async () => {
    let app = await reload()
    vi.spyOn(app.db, 'transaction').mockImplementation(() => {
      throw new Error('IndexedDB broken')
    })
    await expect(app.seedDemosOnce()).resolves.toBeUndefined()
    expect(app.isDemoSeedSettled()).toBe(true)
    expect(storage.getItem(app.DEMOS_SEEDED_KEY)).toBeNull()
    vi.restoreAllMocks()

    app = await reload()
    await app.seedDemosOnce()
    expect(await app.db.scores.count()).toBe(3)
  })

  it('without localStorage, only seeds an empty library', async () => {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('blocked')
      },
      setItem() {
        throw new Error('blocked')
      },
    })
    let app = await reload()
    await app.seedDemosOnce()
    expect(await app.db.scores.count()).toBe(3)

    await app.deleteScore('demo-oda-alegria')
    app = await reload()
    await app.seedDemosOnce()
    expect(await app.db.scores.count()).toBe(2)
  })
})

describe('restoreDemos', () => {
  it('re-adds only the missing demos and returns how many', async () => {
    const app = await reload()
    await app.seedDemosOnce()
    expect(await app.restoreDemos()).toBe(0)

    await app.deleteScore('demo-preludio-do')
    expect(await app.restoreDemos()).toBe(1)
    expect(await ids(app)).toEqual([...DEMO_IDS].sort())

    await app.clearLibrary()
    expect(await app.restoreDemos()).toBe(3)
    expect(await app.restoreDemos()).toBe(0)
    expect(await app.db.scores.count()).toBe(3)
  })

  it('works on a library that was never seeded and marks the device as seeded', async () => {
    const app = await reload()
    expect(await app.restoreDemos()).toBe(3)
    expect(storage.getItem(app.DEMOS_SEEDED_KEY)).toBe('1')
    const next = await reload()
    await next.seedDemosOnce()
    expect(await next.db.scores.count()).toBe(3)
  })

  it('leaves existing demos untouched (renamed, favourite)', async () => {
    const app = await reload()
    await app.seedDemosOnce()
    await app.updateScore('demo-oda-alegria', { title: 'Mi oda', favorite: true })
    await app.deleteScore('demo-minueto-sol')
    expect(await app.restoreDemos()).toBe(1)
    const oda = await app.getScore('demo-oda-alegria')
    expect(oda?.title).toBe('Mi oda')
    expect(oda?.favorite).toBe(true)
  })

  it('rejects when the database fails, so Ajustes can say so', async () => {
    const app = await reload()
    vi.spyOn(app.db, 'transaction').mockImplementation(() => {
      throw new Error('IndexedDB broken')
    })
    await expect(app.restoreDemos()).rejects.toThrow()
  })
})

describe('demo items', () => {
  it('are built the way the engine documents (pinned analysis, demo split point, original difficulty)', async () => {
    const app = await reload()
    await app.seedDemosOnce()
    const docs = (await app.db.scores.toArray()) as ScoreDoc[]
    const byId = new Map(docs.map((d) => [d.id, d]))
    const expected: Record<string, { bars: number; key: string; ts: string }> = {
      'oda-alegria': { bars: 16, key: 'Sol mayor', ts: '4/4' },
      'minueto-sol': { bars: 16, key: 'Sol mayor', ts: '3/4' },
      'preludio-do': { bars: 8, key: 'Do mayor', ts: '4/4' },
    }
    for (const demo of app.demoPieces) {
      const doc = byId.get(app.DEMO_ID_PREFIX + demo.slug)!
      expect(doc.title).toBe(demo.title)
      expect(doc.composer).toBe(demo.composer)
      expect(doc.source).toBe('demo')
      expect(doc.favorite).toBe(false)
      expect(doc.notes).toEqual(demo.notes)
      expect(doc.analysis).toEqual(app.demoAnalysis(demo))
      expect(doc.analysis.beatOffset).toBe(0)
      expect(doc.params).toEqual({ ...app.demoParams(demo, app.getSettings()), quantize: 16, difficulty: 'original' })
      expect(doc.params.splitPoint).toBe(demo.splitPoint)
      const score = app.buildScore(doc.notes, doc.params, doc.analysis, doc.title)
      expect(doc.durationSec).toBe(score.durationSeconds)
      expect(doc.summary).toEqual(app.summarizeScore(score))
      const want = expected[demo.slug]
      expect(doc.summary.measureCount).toBe(want.bars)
      expect(doc.summary.timeSignature).toBe(want.ts)
      expect(app.keyName(doc.summary.key, 'latin')).toBe(want.key)
      expect(doc.createdAt).toBe(doc.updatedAt)
    }
  })

  it('get three different covers, the same ones on every restore', async () => {
    const app = await reload()
    const covers = app.demoCoverIds()
    const values = Object.values(covers)
    expect(values).toHaveLength(3)
    expect(new Set(values).size).toBe(3)
    await app.seedDemosOnce()
    const before = new Map((await app.db.scores.toArray()).map((d) => [d.id, d.coverId]))
    await app.clearLibrary()
    await app.restoreDemos()
    for (const doc of await app.db.scores.toArray()) expect(doc.coverId).toBe(before.get(doc.id))
    // The first demo keeps the cover pickCoverId gives it.
    expect(covers['oda-alegria']).toBe(app.pickCoverId('oda-alegria'))
  })

  it('are listed newest first in their canonical order', async () => {
    const app = await reload()
    await app.seedDemosOnce()
    const docs = await app.db.scores.orderBy('createdAt').reverse().toArray()
    expect(docs.map((d) => d.id)).toEqual(DEMO_IDS)
  })

  it('ignore transcription defaults that would spoil them (1/8 grid, other difficulty or split)', async () => {
    const app = await reload()
    app.useSettings.getState().patch({ quantize: 8, defaultDifficulty: 'facil', splitPoint: 55 })
    expect(await app.restoreDemos()).toBe(3)
    for (const doc of await app.db.scores.toArray()) {
      expect(doc.params.quantize).toBe(16)
      expect(doc.params.difficulty).toBe('original')
      expect(doc.params.splitPoint).toBe(app.findDemo(doc.id)?.splitPoint)
    }
  })
})
