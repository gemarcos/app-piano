// Owner: settings. Ajustes (tab screen): appearance, notation, transcription and playback defaults,
// library maintenance and the way to Acerca de. Every control writes straight to the settings store.
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { Edit05, Headphones01, Microphone01, Monitor01, Moon01, Palette, Sun, Waves } from '@untitled-ui/icons-react'
import { useSettings } from '../../state/settings'
import type { Difficulty, NoteNaming, QuantizeGrid, ThemePreference, TranscriptionModel } from '../../types'
import { pitchName } from '../../engine/score'
import {
  ConfirmDialog,
  ListRow,
  Page,
  Segmented,
  SettingsGroup,
  Slider,
  Stepper,
  Toggle,
  TopBar,
  listContainer,
  listItem,
  spring,
  useReducedMotionPref,
  useToast,
  type SegmentedOption,
} from '../../ui'
import { version } from '../../../package.json'
import { LibrarySettings } from './LibrarySettings'
import { switchTheme } from './theme'
import { PIANO_SOUND_OPTIONS, setPianoSound, usePianoSound } from '../viewer/pianoSound'
import './SettingsScreen.css'

const THEMES: SegmentedOption<ThemePreference>[] = [
  { value: 'system', label: 'Sistema', icon: Monitor01 },
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Oscuro', icon: Moon01 },
]

const NAMINGS: SegmentedOption<NoteNaming>[] = [
  { value: 'none', label: 'Ninguno' },
  { value: 'latin', label: 'Do Re Mi' },
  { value: 'english', label: 'C D E' },
]

const GRIDS: SegmentedOption<QuantizeGrid>[] = [
  { value: 8, label: '1/8' },
  { value: 16, label: '1/16' },
]

const DIFFICULTIES: SegmentedOption<Difficulty>[] = [
  { value: 'original', label: 'Original' },
  { value: 'intermedio', label: 'Intermedio' },
  { value: 'facil', label: 'Fácil' },
]

/** Settings.transcriptionModel (owner: piano-model): Transkun (WebGPU) when the device can run it, or Basic Pitch. */
const MODELS: SegmentedOption<TranscriptionModel>[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'piano', label: 'Piano' },
  { value: 'fast', label: 'Rápido' },
]

const RECORD_LIMITS: SegmentedOption<number>[] = [
  { value: 30, label: '30 s' },
  { value: 60, label: '60 s' },
  { value: 90, label: '90 s' },
  { value: 180, label: '3 min' },
]

const NBSP = '\u00a0'
const percent = (v: number) => `${v}${NBSP}%`
const millis = (v: number) => `${v}${NBSP}ms`

const FALLBACK_NAMES: Record<'latin' | 'english', string[]> = {
  latin: ['Do', 'Do#', 'Re', 'Mib', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'Sib', 'Si'],
  english: ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'],
}

/** "Do4" / "C4" for the split point; falls back to a local table if the score engine fails. */
function splitPointLabel(midi: number, naming: NoteNaming): string {
  try {
    const name = pitchName(midi, naming)
    if (name) return name
  } catch {
    // engine unavailable: use the table below
  }
  const names = FALLBACK_NAMES[naming === 'english' ? 'english' : 'latin']
  return names[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1)
}

/** Full-width control under a row title (segmented choices). */
function Below({ children }: { children: ReactNode }) {
  return <div className="set-below">{children}</div>
}

function AppearanceGroup() {
  const theme = useSettings((s) => s.theme)
  const reduceMotion = useSettings((s) => s.reduceMotion)
  const uiSounds = useSettings((s) => s.uiSounds)
  const set = useSettings((s) => s.set)
  const reduced = useReducedMotionPref()
  const onTheme = (v: ThemePreference) => {
    if (v !== theme) switchTheme(v, () => set('theme', v), !reduced)
  }
  return (
    <SettingsGroup title="Apariencia" icon={Palette}>
      <ListRow title="Tema">
        <Below>
          <Segmented full options={THEMES} value={theme} onChange={onTheme} ariaLabel="Tema" />
        </Below>
      </ListRow>
      <ListRow
        title="Reducir animaciones"
        trailing={<Toggle checked={reduceMotion} onChange={(v) => set('reduceMotion', v)} ariaLabel="Reducir animaciones" />}
      />
      <ListRow
        title="Sonidos de la interfaz"
        trailing={<Toggle checked={uiSounds} onChange={(v) => set('uiSounds', v)} ariaLabel="Sonidos de la interfaz" />}
      />
    </SettingsGroup>
  )
}

function NotationGroup() {
  const naming = useSettings((s) => s.noteNaming)
  const set = useSettings((s) => s.set)
  return (
    <SettingsGroup title="Notación" icon={Edit05}>
      <ListRow title="Nombres de notas">
        <Below>
          <Segmented full options={NAMINGS} value={naming} onChange={(v) => set('noteNaming', v)} ariaLabel="Nombres de notas" />
        </Below>
      </ListRow>
    </SettingsGroup>
  )
}

function TranscriptionGroup() {
  const sensitivity = useSettings((s) => Math.round(s.sensitivity * 100))
  const minNoteMs = useSettings((s) => s.minNoteMs)
  const quantize = useSettings((s) => s.quantize)
  const splitPoint = useSettings((s) => s.splitPoint)
  const naming = useSettings((s) => s.noteNaming)
  const difficulty = useSettings((s) => s.defaultDifficulty)
  const model = useSettings((s) => s.transcriptionModel)
  const set = useSettings((s) => s.set)
  return (
    <SettingsGroup title="Transcripción" icon={Waves} footer="Se aplica a las próximas transcripciones.">
      <ListRow title="Modelo" subtitle="Piano es más preciso">
        <Below>
          <Segmented full options={MODELS} value={model} onChange={(v) => set('transcriptionModel', v)} ariaLabel="Modelo de transcripción" />
        </Below>
      </ListRow>
      <ListRow title="Sensibilidad" subtitle="Más alta, más notas" trailing={<span className="tabular">{percent(sensitivity)}</span>}>
        <Slider
          value={sensitivity}
          min={0}
          max={100}
          step={5}
          onChange={(v) => set('sensitivity', v / 100)}
          ariaLabel="Sensibilidad"
          format={percent}
        />
      </ListRow>
      <ListRow title="Nota mínima" subtitle="Ignora notas más cortas" trailing={<span className="tabular">{millis(minNoteMs)}</span>}>
        <Slider value={minNoteMs} min={40} max={250} step={10} onChange={(v) => set('minNoteMs', v)} ariaLabel="Nota mínima" format={millis} />
      </ListRow>
      <ListRow
        title="Cuantización"
        trailing={<Segmented size="sm" options={GRIDS} value={quantize} onChange={(v) => set('quantize', v)} ariaLabel="Cuantización" />}
      />
      <ListRow
        wrap
        title="División de manos"
        subtitle="Mano derecha desde aquí"
        trailing={
          <Stepper
            value={splitPoint}
            min={48}
            max={72}
            onChange={(v) => set('splitPoint', v)}
            ariaLabel="División de manos"
            format={(v) => splitPointLabel(v, naming)}
          />
        }
      />
      <ListRow title="Dificultad inicial">
        <Below>
          <Segmented full options={DIFFICULTIES} value={difficulty} onChange={(v) => set('defaultDifficulty', v)} ariaLabel="Dificultad inicial" />
        </Below>
      </ListRow>
    </SettingsGroup>
  )
}

/** Recording length and audio storage (part of the transcription defaults, split off to keep cards short). */
function RecordingGroup() {
  const maxRecordSec = useSettings((s) => s.maxRecordSec)
  const keepAudio = useSettings((s) => s.keepOriginalAudio)
  const set = useSettings((s) => s.set)
  return (
    <SettingsGroup title="Grabación" icon={Microphone01}>
      <ListRow title="Duración máxima">
        <Below>
          <Segmented
            full
            options={RECORD_LIMITS}
            value={maxRecordSec}
            onChange={(v) => set('maxRecordSec', v)}
            ariaLabel="Duración máxima de grabación"
          />
        </Below>
      </ListRow>
      <ListRow
        title="Guardar audio original"
        trailing={<Toggle checked={keepAudio} onChange={(v) => set('keepOriginalAudio', v)} ariaLabel="Guardar audio original" />}
      />
    </SettingsGroup>
  )
}

function PlaybackGroup() {
  const metronome = useSettings((s) => s.metronome)
  const countIn = useSettings((s) => s.countIn)
  const followScore = useSettings((s) => s.followScore)
  const sustainPedal = useSettings((s) => s.sustainPedal)
  const pianoSound = usePianoSound()
  const volume = useSettings((s) => Math.round(s.playbackVolume * 100))
  const set = useSettings((s) => s.set)
  return (
    <SettingsGroup title="Reproducción" icon={Headphones01}>
      <ListRow title="Timbre">
        <Below>
          <Segmented full options={PIANO_SOUND_OPTIONS} value={pianoSound} onChange={setPianoSound} ariaLabel="Timbre" />
        </Below>
      </ListRow>
      <ListRow title="Metrónomo" trailing={<Toggle checked={metronome} onChange={(v) => set('metronome', v)} ariaLabel="Metrónomo" />} />
      <ListRow title="Cuenta previa" trailing={<Toggle checked={countIn} onChange={(v) => set('countIn', v)} ariaLabel="Cuenta previa" />} />
      <ListRow title="Pedal" trailing={<Toggle checked={sustainPedal} onChange={(v) => set('sustainPedal', v)} ariaLabel="Pedal" />} />
      <ListRow
        title="Seguir partitura"
        trailing={<Toggle checked={followScore} onChange={(v) => set('followScore', v)} ariaLabel="Seguir partitura" />}
      />
      <ListRow title="Volumen" trailing={<span className="tabular">{percent(volume)}</span>}>
        <Slider value={volume} min={0} max={100} step={5} onChange={(v) => set('playbackVolume', v / 100)} ariaLabel="Volumen" format={percent} />
      </ListRow>
    </SettingsGroup>
  )
}

export function SettingsScreen() {
  const navigate = useNavigate()
  const toast = useToast()
  const reset = useSettings((s) => s.reset)
  const [confirmReset, setConfirmReset] = useState(false)

  const onReset = () => {
    reset()
    setConfirmReset(false)
    toast.show('Ajustes restablecidos')
  }

  return (
    <Page variant="tab" tabBar>
      <TopBar large title="Ajustes" />

      <motion.div className="set-groups" variants={listContainer} initial="hidden" animate="show">
        <motion.div variants={listItem}>
          <AppearanceGroup />
        </motion.div>
        <motion.div variants={listItem}>
          <NotationGroup />
        </motion.div>
        <motion.div variants={listItem}>
          <TranscriptionGroup />
        </motion.div>
        <motion.div variants={listItem}>
          <RecordingGroup />
        </motion.div>
        <motion.div variants={listItem}>
          <PlaybackGroup />
        </motion.div>
        <motion.div variants={listItem}>
          <LibrarySettings />
        </motion.div>
        <motion.div variants={listItem}>
          <SettingsGroup>
            <ListRow title="Acerca de" trailing={<span className="tabular">{version}</span>} chevron onClick={() => navigate('/about')} />
          </SettingsGroup>
        </motion.div>
        <motion.div variants={listItem} className="set-reset-wrap">
          <motion.button type="button" className="set-reset" whileTap={{ scale: 0.96 }} transition={spring} onClick={() => setConfirmReset(true)}>
            Restablecer ajustes
          </motion.button>
        </motion.div>
      </motion.div>

      <ConfirmDialog
        open={confirmReset}
        title="¿Restablecer ajustes?"
        message="Tus partituras no cambian."
        confirmLabel="Restablecer"
        onConfirm={onReset}
        onCancel={() => setConfirmReset(false)}
      />
    </Page>
  )
}
