// Owner: piano-sound. The viewer's piano sound setting ("Timbre"): 'grand' (Salamander, default) or
// 'classic' (the FluidR3 sound of the first version), persisted in the settings store as `pianoSound`.
import { useSettings } from '../../state/settings'
import type { SegmentedOption } from '../../ui'
import type { PianoSound } from './pianoSamples'

export type { PianoSound } from './pianoSamples'

export const PIANO_SOUND_OPTIONS: SegmentedOption<PianoSound>[] = [
  { value: 'grand', label: 'Piano de cola' },
  { value: 'classic', label: 'Piano clásico' },
]

/** The chosen piano sound (reactive). Unknown stored values fall back to the grand piano. */
export function usePianoSound(): PianoSound {
  return useSettings((s) => (s.pianoSound === 'classic' ? 'classic' : 'grand'))
}

/** Saves the piano sound (persisted with the other settings). */
export function setPianoSound(value: PianoSound): void {
  useSettings.getState().patch({ pianoSound: value })
}
