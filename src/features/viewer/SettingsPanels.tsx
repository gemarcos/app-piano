// Owner: viewer. The three tabs of the viewer's settings sheet: Reproducción, Partitura, Filtros.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronSelectorVertical, RefreshCcw01 } from '@untitled-ui/icons-react'
import type { AnalysisResult, Difficulty, Hands, KeySignature, NoteNaming, QuantizeGrid, Score, ScoreParams, Settings, TimeSignature } from '../../types'
import { TIME_SIGNATURES, allKeys, keyName, pitchName, tonicPc } from '../../engine/score'
import { Button, Icon, ListRow, RangeSlider, Segmented, SettingsGroup, Slider, Stepper, Toggle, type SegmentedOption } from '../../ui'
import { formatSemitones, type LoopMode } from './timeline'
import { SPEED_RANGE, ZOOM_RANGE, type SoundSource, type ViewState } from './viewState'

const NBSP = ' '
const percent = (v: number) => `${Math.round(v)}${NBSP}%`

const LOOPS: SegmentedOption<LoopMode>[] = [
  { value: 'off', label: 'No' },
  { value: 'all', label: 'Todo' },
  { value: 'ab', label: 'A–B' },
]
const SOUNDS: SegmentedOption<SoundSource>[] = [
  { value: 'piano', label: 'Piano' },
  { value: 'original', label: 'Original' },
]
const HANDS: SegmentedOption<Hands>[] = [
  { value: 'both', label: 'Ambas' },
  { value: 'right', label: 'Derecha' },
  { value: 'left', label: 'Izquierda' },
]
const NAMINGS: SegmentedOption<NoteNaming>[] = [
  { value: 'none', label: 'Ninguno' },
  { value: 'latin', label: 'Do Re Mi' },
  { value: 'english', label: 'C D E' },
]
const METERS: SegmentedOption<TimeSignature>[] = (['2/4', '3/4', '4/4', '6/8'] as const)
  .filter((t) => TIME_SIGNATURES.includes(t))
  .map((t) => ({ value: t, label: t }))
const DIFFICULTIES: SegmentedOption<Difficulty>[] = [
  { value: 'original', label: 'Original' },
  { value: 'intermedio', label: 'Intermedio' },
  { value: 'facil', label: 'Fácil' },
]
const GRIDS: SegmentedOption<QuantizeGrid>[] = [
  { value: 8, label: '1/8' },
  { value: 16, label: '1/16' },
]

/** Full-width control under a row title. */
function Below({ children }: { children: ReactNode }) {
  return <div className="vw-below">{children}</div>
}

/** Local value while dragging, committed on release (for settings that are expensive to apply). */
function useDraft(value: number): [number, (v: number) => void] {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return [draft, setDraft]
}

/* ---------------- Reproducción ---------------- */

export interface PlaybackPanelProps {
  view: ViewState
  setView: (patch: Partial<ViewState>) => void
  settings: Pick<Settings, 'metronome' | 'countIn' | 'followScore'>
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  hasOriginal: boolean
  onLoopMode: (mode: LoopMode) => void
}

export function PlaybackPanel({ view, setView, settings, setSetting, hasOriginal, onLoopMode }: PlaybackPanelProps) {
  const [speed, setSpeed] = useDraft(view.speed)
  const original = hasOriginal && view.sound === 'original'
  return (
    <div className="vw-panel">
      <SettingsGroup>
        <ListRow title="Velocidad" trailing={<span className="tabular">{percent(speed)}</span>}>
          <Slider
            value={speed}
            min={SPEED_RANGE[0]}
            max={SPEED_RANGE[1]}
            step={5}
            onChange={setSpeed}
            onChangeEnd={(v) => setView({ speed: v })}
            ariaLabel="Velocidad"
            format={percent}
          />
        </ListRow>
        <ListRow
          title="Metrónomo"
          disabled={original}
          trailing={<Toggle checked={settings.metronome} onChange={(v) => setSetting('metronome', v)} ariaLabel="Metrónomo" disabled={original} />}
        />
        <ListRow
          title="Cuenta previa"
          disabled={original}
          trailing={<Toggle checked={settings.countIn} onChange={(v) => setSetting('countIn', v)} ariaLabel="Cuenta previa" disabled={original} />}
        />
        <ListRow
          title="Seguir partitura"
          trailing={<Toggle checked={settings.followScore} onChange={(v) => setSetting('followScore', v)} ariaLabel="Seguir partitura" />}
        />
      </SettingsGroup>
      <SettingsGroup>
        <ListRow title="Bucle">
          <Below>
            <Segmented full options={LOOPS} value={view.loop} onChange={onLoopMode} ariaLabel="Bucle" />
          </Below>
        </ListRow>
        {hasOriginal && (
          <ListRow title="Sonido">
            <Below>
              <Segmented full options={SOUNDS} value={view.sound} onChange={(v) => setView({ sound: v })} ariaLabel="Sonido" />
            </Below>
          </ListRow>
        )}
      </SettingsGroup>
    </div>
  )
}

/* ---------------- Partitura ---------------- */

export interface NotationPanelProps {
  view: ViewState
  setView: (patch: Partial<ViewState>) => void
  naming: NoteNaming
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  params: ScoreParams
  patch: (values: Partial<ScoreParams>) => void
  analysis: AnalysisResult
  score: Score
}

const keyId = (k: KeySignature) => `${tonicPc(k)}:${k.mode}`

function KeySelect({ value, detected, naming, onChange }: { value: KeySignature | null; detected: KeySignature; naming: NoteNaming; onChange: (k: KeySignature | null) => void }) {
  const keys = useMemo(() => allKeys(), [])
  return (
    <span className="vw-select">
      <select
        value={value ? keyId(value) : 'auto'}
        aria-label="Tonalidad"
        onChange={(e) => onChange(e.target.value === 'auto' ? null : (keys.find((k) => keyId(k) === e.target.value) ?? null))}
      >
        <option value="auto">Auto · {keyName(detected, naming)}</option>
        <optgroup label="Mayores">
          {keys.filter((k) => k.mode === 'major').map((k) => (
            <option key={keyId(k)} value={keyId(k)}>
              {keyName(k, naming)}
            </option>
          ))}
        </optgroup>
        <optgroup label="Menores">
          {keys.filter((k) => k.mode === 'minor').map((k) => (
            <option key={keyId(k)} value={keyId(k)}>
              {keyName(k, naming)}
            </option>
          ))}
        </optgroup>
      </select>
      <Icon icon={ChevronSelectorVertical} size={16} className="vw-select__icon" />
    </span>
  )
}

export function NotationPanel({ view, setView, naming, setSetting, params, patch, analysis, score }: NotationPanelProps) {
  const names: NoteNaming = naming === 'english' ? 'english' : 'latin'
  return (
    <div className="vw-panel">
      <SettingsGroup>
        <ListRow title="Manos">
          <Below>
            <Segmented full options={HANDS} value={view.hands} onChange={(v) => setView({ hands: v })} ariaLabel="Manos" />
          </Below>
        </ListRow>
        <ListRow title="Nombres de notas">
          <Below>
            <Segmented full options={NAMINGS} value={naming} onChange={(v) => setSetting('noteNaming', v)} ariaLabel="Nombres de notas" />
          </Below>
        </ListRow>
        <ListRow title="Zoom" trailing={<span className="tabular">{percent(view.zoom)}</span>}>
          <Slider
            value={view.zoom}
            min={ZOOM_RANGE[0]}
            max={ZOOM_RANGE[1]}
            step={10}
            onChange={(v) => setView({ zoom: v })}
            ariaLabel="Zoom"
            format={percent}
          />
        </ListRow>
      </SettingsGroup>
      <SettingsGroup>
        <ListRow
          title="Transponer"
          subtitle={keyName(score.key, naming)}
          trailing={
            <Stepper value={params.transpose} min={-12} max={12} onChange={(v) => patch({ transpose: v })} format={formatSemitones} ariaLabel="Transponer" />
          }
        />
        <ListRow title="Tonalidad" trailing={<KeySelect value={params.key} detected={analysis.key} naming={naming} onChange={(k) => patch({ key: k })} />} />
        <ListRow title="Compás">
          <Below>
            <Segmented full options={METERS} value={params.timeSignature} onChange={(v) => patch({ timeSignature: v })} ariaLabel="Compás" />
          </Below>
        </ListRow>
        <ListRow
          title="Tempo base"
          subtitle={`Detectado: ${Math.round(analysis.bpm)}${NBSP}ppm`}
          trailing={
            <Stepper value={Math.round(params.bpm)} min={40} max={240} onChange={(v) => patch({ bpm: v })} format={(v) => `${v}${NBSP}ppm`} ariaLabel="Tempo base" />
          }
        />
        <ListRow
          title="División de manos"
          trailing={
            <Stepper
              value={params.splitPoint}
              min={36}
              max={84}
              onChange={(v) => patch({ splitPoint: v })}
              format={(v) => pitchName(v, names)}
              ariaLabel="División de manos"
            />
          }
        />
        <ListRow title="Dificultad">
          <Below>
            <Segmented full options={DIFFICULTIES} value={params.difficulty} onChange={(v) => patch({ difficulty: v })} ariaLabel="Dificultad" />
          </Below>
        </ListRow>
      </SettingsGroup>
    </div>
  )
}

/* ---------------- Filtros ---------------- */

export interface FiltersPanelProps {
  params: ScoreParams
  patch: (values: Partial<ScoreParams>) => void
  naming: NoteNaming
  onReset: () => void
}

export function FiltersPanel({ params, patch, naming, onReset }: FiltersPanelProps) {
  const names: NoteNaming = naming === 'english' ? 'english' : 'latin'
  const noise = Math.round(params.minVelocity * 100)
  const minMs = Math.round(params.minDuration * 1000)
  const [lo, hi] = params.pitchRange
  return (
    <div className="vw-panel">
      <SettingsGroup>
        <ListRow title="Ruido" subtitle="Ignora las notas más suaves" trailing={<span className="tabular">{percent(noise)}</span>}>
          <Slider value={noise} min={0} max={80} step={5} onChange={(v) => patch({ minVelocity: v / 100 })} ariaLabel="Ruido" format={percent} />
        </ListRow>
        <ListRow title="Duración mínima" trailing={<span className="tabular">{`${minMs}${NBSP}ms`}</span>}>
          <Slider
            value={minMs}
            min={0}
            max={300}
            step={10}
            onChange={(v) => patch({ minDuration: v / 1000 })}
            ariaLabel="Duración mínima"
            format={(v) => `${v}${NBSP}ms`}
          />
        </ListRow>
        <ListRow title="Rango" trailing={<span className="tabular">{`${pitchName(lo, names)} – ${pitchName(hi, names)}`}</span>}>
          <RangeSlider
            value={[lo, hi]}
            min={21}
            max={108}
            minGap={1}
            onChange={(v) => patch({ pitchRange: v })}
            ariaLabel="Rango"
            labels={['nota más grave', 'nota más aguda']}
            format={(v) => pitchName(v, names)}
          />
        </ListRow>
        <ListRow
          title="Polifonía máxima"
          subtitle="Notas a la vez por mano"
          trailing={<Stepper value={params.maxPolyphony} min={1} max={6} onChange={(v) => patch({ maxPolyphony: v })} ariaLabel="Polifonía máxima" />}
        />
        <ListRow
          title="Cuantización"
          trailing={<Segmented size="sm" options={GRIDS} value={params.quantize} onChange={(v) => patch({ quantize: v })} ariaLabel="Cuantización" />}
        />
      </SettingsGroup>
      <div className="vw-panel__reset">
        <Button variant="secondary" icon={RefreshCcw01} onClick={onReset}>
          Restablecer
        </Button>
      </div>
    </div>
  )
}
