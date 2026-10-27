import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import type { Settings } from '../types'

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  reduceMotion: false,
  noteNaming: 'latin',
  sensitivity: 0.5,
  minNoteMs: 90,
  quantize: 16,
  splitPoint: 60,
  defaultDifficulty: 'original',
  maxRecordSec: 90,
  keepOriginalAudio: true,
  metronome: false,
  countIn: false,
  followScore: true,
  playbackVolume: 0.9,
  sustainPedal: true,
  transcriptionModel: 'auto',
  pianoSound: 'grand',
}

const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]

interface SettingsActions {
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  patch: (values: Partial<Settings>) => void
  reset: () => void
}

export type SettingsState = Settings & SettingsActions

const memory = new Map<string, string>()

/** localStorage when available, otherwise an in-memory fallback (private mode, blocked storage). */
const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      return window.localStorage.getItem(name)
    } catch {
      return memory.get(name) ?? null
    }
  },
  setItem: (name, value) => {
    try {
      window.localStorage.setItem(name, value)
    } catch {
      memory.set(name, value)
    }
  },
  removeItem: (name) => {
    try {
      window.localStorage.removeItem(name)
    } catch {
      memory.delete(name)
    }
  },
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (key, value) => set({ [key]: value } as Partial<SettingsState>),
      patch: (values) => set(values),
      reset: () => set(DEFAULT_SETTINGS),
    }),
    {
      name: 'pauta.settings',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (state) => {
        const out: Partial<Settings> = {}
        for (const key of SETTINGS_KEYS) (out as Record<string, unknown>)[key] = state[key]
        return out as Settings
      },
      merge: (persisted, current) => ({ ...current, ...(persisted as Partial<Settings>) }),
    },
  ),
)

/** Non-reactive snapshot, for use outside React. */
export function getSettings(): Settings {
  const state = useSettings.getState()
  const out: Partial<Settings> = {}
  for (const key of SETTINGS_KEYS) (out as Record<string, unknown>)[key] = state[key]
  return out as Settings
}
