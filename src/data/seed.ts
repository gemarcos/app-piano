// Owner: library. Seeds the public-domain demo pieces (src/data/demos.ts) into the library.
//
// - seedDemosOnce(): first run only. A localStorage flag remembers that the demos were seeded on this
//   device, so demos the user deletes (or "Borrar biblioteca") stay deleted after a reload.
// - restoreDemos(): Ajustes > "Restaurar ejemplos". Re-adds the demos whose ids are missing.
// Demo ids are deterministic (DEMO_ID_PREFIX + slug), so the library can never hold two copies.
import type { ScoreDoc, ScoreParams } from '../types'
import { covers, pickCoverId } from '../assets/images'
import { buildScore, summarizeScore } from '../engine/score'
import { getSettings } from '../state/settings'
import { db } from './db'
import { DEMO_ID_PREFIX, demoAnalysis, demoParams, demoPieces, type DemoPiece } from './demos'

/** localStorage key: '1' once the demos were seeded on this device. */
export const DEMOS_SEEDED_KEY = 'pauta.demosSeeded'

/** Library id of a demo ('demo-oda-alegria'). */
export function demoId(demo: DemoPiece): string {
  return DEMO_ID_PREFIX + demo.slug
}

/**
 * One cover per demo, all different: pickCoverId(slug), or the next unused cover when an earlier demo
 * already took it. Computed over the whole demo list, so a restored demo always gets the same cover.
 */
export function demoCoverIds(): Record<string, string> {
  const used = new Set<string>()
  const out: Record<string, string> = {}
  for (const demo of demoPieces) {
    let id = pickCoverId(demo.slug)
    const start = covers.findIndex((c) => c.id === id)
    if (start >= 0) {
      for (let step = 0; step < covers.length && used.has(id); step++) id = covers[(start + step) % covers.length].id
    }
    used.add(id)
    out[demo.slug] = id
  }
  return out
}

/**
 * Library item for a demo (pure, no DB access). Analysis pinned to the demo's tempo, meter and key;
 * params = the user's defaults with the demo's split point, 'original' difficulty and the 1/16 grid
 * (the demo notes are exact sixteenths: the 1/8 transcription default would merge the Prelude's figures).
 */
export function buildDemoDoc(demo: DemoPiece, now: number, coverId = demoCoverIds()[demo.slug] ?? pickCoverId(demo.slug)): ScoreDoc {
  const analysis = demoAnalysis(demo)
  const params: ScoreParams = { ...demoParams(demo, getSettings()), quantize: 16, difficulty: 'original' }
  const score = buildScore(demo.notes, params, analysis, demo.title)
  return {
    id: demoId(demo),
    title: demo.title,
    composer: demo.composer,
    createdAt: now,
    updatedAt: now,
    source: 'demo',
    durationSec: score.durationSeconds,
    coverId,
    favorite: false,
    notes: demo.notes,
    analysis,
    params,
    summary: summarizeScore(score),
  }
}

/** Adds the demos whose ids are missing, in one transaction. Resolves with how many were added. */
async function addMissingDemos(): Promise<number> {
  const now = Date.now()
  const coverIds = demoCoverIds()
  const docs: ScoreDoc[] = []
  demoPieces.forEach((demo, i) => {
    try {
      // 1 ms apart, so "Recientes" lists the demos in their canonical order.
      docs.push(buildDemoDoc(demo, now - i, coverIds[demo.slug]))
    } catch {
      // A demo that cannot be built is skipped; the others still go in.
    }
  })
  if (docs.length === 0) return 0
  // rw transactions on the same store are serialized, so two tabs seeding at once cannot both add.
  return db.transaction('rw', db.scores, async () => {
    const existing = await db.scores.bulkGet(docs.map((d) => d.id))
    const missing = docs.filter((_, i) => !existing[i])
    if (missing.length > 0) await db.scores.bulkAdd(missing)
    return missing.length
  })
}

/** true / false from localStorage, null when storage is unavailable (blocked, private mode quirks). */
function readSeededFlag(): boolean | null {
  try {
    return globalThis.localStorage.getItem(DEMOS_SEEDED_KEY) === '1'
  } catch {
    return null
  }
}

function writeSeededFlag(): void {
  try {
    globalThis.localStorage.setItem(DEMOS_SEEDED_KEY, '1')
  } catch {
    // Storage unavailable: seeding falls back to "only into an empty library".
  }
}

let seeding: Promise<void> | null = null
let settled = false

/**
 * Seeds the demo pieces once per device. Safe to call repeatedly and concurrently (StrictMode runs
 * effects twice): every call shares one promise. Never rejects.
 */
export function seedDemosOnce(): Promise<void> {
  seeding ??= (async () => {
    try {
      const flag = readSeededFlag()
      if (flag === true) return
      // Without storage we cannot remember the first run: only seed an empty library.
      if (flag === null && (await db.scores.count()) > 0) return
      await addMissingDemos()
      writeSeededFlag()
    } catch {
      // IndexedDB unavailable or failing: the library simply starts empty (no flag, so the next run retries).
    } finally {
      settled = true
    }
  })()
  return seeding
}

/** True once seedDemosOnce() has finished (successfully or not) in this session. */
export function isDemoSeedSettled(): boolean {
  return settled
}

/**
 * Re-adds any missing demo pieces (Ajustes > "Restaurar ejemplos"). Resolves with how many were added
 * (0 when all three are already there). Rejects only when the database itself fails, so the caller can
 * tell the user.
 */
export async function restoreDemos(): Promise<number> {
  const added = await addMissingDemos()
  writeSeededFlag()
  return added
}
