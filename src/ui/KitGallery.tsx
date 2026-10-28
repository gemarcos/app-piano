// DEV-only gallery (#/__kit). Not bundled in production (see App.tsx).
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import {
  Download01,
  DotsHorizontal,
  Edit02,
  Grid01,
  Heart,
  Microphone01,
  MusicNote01,
  Play,
  Rows01,
  Share07,
  SkipBack,
  SkipForward,
  Star01,
  Trash01,
  Upload01,
} from '@untitled-ui/icons-react'
import {
  ActionSheet,
  Button,
  Card,
  Chip,
  ChipRow,
  ConfirmDialog,
  Cover,
  EmptyState,
  Icon,
  IconButton,
  ListRow,
  LiveBars,
  Page,
  PauseIcon,
  ProgressRing,
  PromptDialog,
  RangeSlider,
  SearchField,
  SectionHeader,
  Segmented,
  SettingsGroup,
  Sheet,
  Slider,
  Spinner,
  Stepper,
  TabBar,
  Toggle,
  TopBar,
  Vinyl,
  Waveform,
  listContainer,
  listItem,
  useToast,
} from './index'
import { BackButton } from './Layout'
import { ScreenDemo, TabDemo, demoPeaks } from './KitDemos'
import './KitGallery.css'

function useDemoLevel(active: boolean) {
  const [level, setLevel] = useState(0)
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => {
      const t = performance.now() / 1000
      setLevel(Math.min(1, 0.45 + 0.35 * Math.sin(t * 2.1) * Math.sin(t * 0.7) + Math.random() * 0.25))
    }, 70)
    return () => window.clearInterval(id)
  }, [active])
  return active ? level : 0
}

function Section({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <motion.section className="kit-section" variants={listItem}>
      <SectionHeader title={title} />
      {note && <p className="kit-note">{note}</p>}
      {children}
    </motion.section>
  )
}

export default function KitGallery() {
  const [params] = useSearchParams()
  const demo = params.get('demo')
  if (demo === 'screen') return <ScreenDemo />
  if (demo === 'tab') return <TabDemo />
  return <Gallery />
}


function Gallery() {
  const toast = useToast()
  const peaks = useMemo(() => demoPeaks(360), [])
  const [playing, setPlaying] = useState(true)
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [hands, setHands] = useState<'both' | 'right' | 'left'>('both')
  const [speed, setSpeed] = useState(100)
  const [range, setRange] = useState<[number, number]>([12, 48])
  const [metronome, setMetronome] = useState(true)
  const [countIn, setCountIn] = useState(false)
  const [tempo, setTempo] = useState(96)
  const [query, setQuery] = useState('')
  const [chip, setChip] = useState('todas')
  const [sheet, setSheet] = useState(false)
  const [actions, setActions] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [prompt, setPrompt] = useState(false)
  const [title, setTitle] = useState('Minueto en Sol')
  const level = useDemoLevel(playing)

  return (
    <Page className="kit">
      <TopBar
        large
        title="Kit"
        subtitle="Componentes de Pauta"
        right={<IconButton icon={DotsHorizontal} label="Más opciones" onClick={() => setActions(true)} />}
      />

      <motion.div className="kit-sections" variants={listContainer} initial="hidden" animate="show">
        <Section title="Vinilo">
          <div className="kit-center">
            <Vinyl size={300} spinning={playing} tonearm={playing ? 'play' : 'rest'} progress={0.42} ariaLabel="Disco" />
          </div>
          <div className="kit-player">
            <p className="kit-player__title">{title}</p>
            <p className="kit-player__sub">Transcripción · 96 ppm</p>
            <LiveBars level={level} active={playing} bars={22} height={36} className="kit-livebars" />
            <p className="kit-player__time tabular">0:38 / 1:42</p>
          </div>
          <div className="kit-transport">
            <IconButton icon={SkipBack} label="Anterior" variant="neu" size="lg" />
            <IconButton
              icon={playing ? PauseIcon : Play}
              label={playing ? 'Pausar' : 'Reproducir'}
              variant="neu"
              size="xl"
              onClick={() => setPlaying((p) => !p)}
            />
            <IconButton icon={SkipForward} label="Siguiente" variant="neu" size="lg" />
          </div>
        </Section>

        <Section title="Botones">
          <div className="kit-wrap">
            <Button icon={Play}>Reproducir</Button>
            <Button variant="accent" icon={Microphone01}>
              Escuchar
            </Button>
            <Button variant="secondary" icon={Upload01}>
              Importar
            </Button>
            <Button variant="ghost">Cancelar</Button>
            <Button variant="danger" icon={Trash01}>
              Eliminar
            </Button>
            <Button size="sm" variant="secondary">
              Pequeño
            </Button>
            <Button size="sm" loading>
              Cargando
            </Button>
          </div>
          <Button size="lg" full variant="accent" className="kit-gap-top">
            Transcribir
          </Button>
          <div className="kit-wrap kit-wrap--spread kit-gap-top">
            <IconButton icon={Heart} label="Favorito" />
            <IconButton icon={Star01} label="Destacar" active pressed />
            <IconButton icon={Share07} label="Compartir" variant="surface" />
            <IconButton icon={Download01} label="Descargar" variant="surface" size="sm" />
          </div>
          <div className="kit-wrap kit-wrap--spread kit-gap-top">
            <IconButton icon={Play} label="Reproducir" variant="ink" size="lg" />
            <IconButton icon={PauseIcon} label="Pausar" variant="accent" size="lg" />
            <IconButton icon={Microphone01} label="Grabar" variant="neu" size="lg" />
          </div>
        </Section>

        <Section title="Onda">
          <Card padding="lg">
            <Waveform peaks={peaks} progress={0.38} height={64} />
          </Card>
          <Card padding="lg" className="kit-gap-top">
            <Waveform peaks={peaks} selection={[range[0] / 60, range[1] / 60]} height={56} barWidth={2} gap={2} />
            <RangeSlider
              value={range}
              min={0}
              max={60}
              minGap={2}
              onChange={setRange}
              ariaLabel="Selección"
              format={(v) => `0:${String(v).padStart(2, '0')}`}
            />
          </Card>
        </Section>

        <Section title="Progreso">
          <div className="kit-wrap kit-wrap--center">
            <ProgressRing value={0.64} size={132} stroke={4}>
              <span className="kit-ring-label tabular">64 %</span>
            </ProgressRing>
            <ProgressRing value={0} size={84} stroke={3} indeterminate>
              <Icon icon={MusicNote01} size={24} className="kit-faint" />
            </ProgressRing>
            <Spinner size={24} label="Cargando" />
          </div>
        </Section>

        <Section title="Controles">
          <Card padding="lg" className="kit-controls">
            <Segmented
              full
              value={hands}
              onChange={setHands}
              ariaLabel="Manos"
              options={[
                { value: 'both', label: 'Ambas' },
                { value: 'right', label: 'Derecha' },
                { value: 'left', label: 'Izquierda' },
              ]}
            />
            <div className="kit-field">
              <span className="kit-label">Velocidad</span>
              <Slider value={speed} min={50} max={150} step={5} onChange={setSpeed} ariaLabel="Velocidad" format={(v) => `${v} %`} showValue />
            </div>
            <div className="kit-field kit-field--row">
              <span className="kit-label">Tempo</span>
              <Stepper value={tempo} min={40} max={220} onChange={setTempo} ariaLabel="Tempo" format={(v) => `${v} ppm`} />
            </div>
            <div className="kit-field kit-field--row">
              <span className="kit-label">Vista</span>
              <Segmented
                size="sm"
                value={view}
                onChange={setView}
                ariaLabel="Vista"
                options={[
                  { value: 'grid', icon: Grid01, ariaLabel: 'Cuadrícula' },
                  { value: 'list', icon: Rows01, ariaLabel: 'Lista' },
                ]}
              />
            </div>
          </Card>
        </Section>

        <Section title="Búsqueda">
          <SearchField value={query} onChange={setQuery} placeholder="Buscar partituras" />
          <ChipRow ariaLabel="Filtros">
            {['todas', 'favoritas', 'grabaciones', 'importadas', 'demos'].map((c) => (
              <Chip key={c} selected={chip === c} onClick={() => setChip(c)} icon={c === 'favoritas' ? Star01 : undefined}>
                {c[0].toUpperCase() + c.slice(1)}
              </Chip>
            ))}
          </ChipRow>
        </Section>

        <Section title="Listas">
          <Card padding="none">
            <ListRow
              leading={<Cover seed="minueto" size={48} />}
              title="Minueto en Sol"
              subtitle="Demo · Sol mayor · 3/4"
              trailing="1:12"
              onClick={() => toast.show('Abrir partitura')}
            />
            <ListRow
              leading={<Cover seed="para-elisa" size={48} />}
              title="Para Elisa"
              subtitle="Demo · La menor · 3/8"
              trailing={<Icon icon={Star01} size={16} />}
              onClick={() => toast.show('Abrir partitura')}
            />
            <ListRow
              leading={<Cover seed="grabacion-0941" size={48} />}
              title="Grabación 27 oct, 09:41"
              subtitle="Micrófono · 0:48"
              trailing={<Spinner size={18} />}
            />
          </Card>
          <div className="kit-gap-top">
            <SettingsGroup title="Reproducción" footer="Se aplica a todas las partituras nuevas.">
              <ListRow title="Metrónomo" trailing={<Toggle checked={metronome} onChange={setMetronome} ariaLabel="Metrónomo" />} />
              <ListRow title="Cuenta previa" trailing={<Toggle checked={countIn} onChange={setCountIn} ariaLabel="Cuenta previa" />} />
              <ListRow title="Volumen" trailing={`${speed - 50} %`}>
                <Slider value={speed} min={50} max={150} step={5} onChange={setSpeed} ariaLabel="Volumen" />
              </ListRow>
              <ListRow title="Nombres de notas" trailing="Do Re Mi" chevron onClick={() => setSheet(true)} />
              <ListRow title="Borrar biblioteca" tone="danger" onClick={() => setConfirm(true)} />
            </SettingsGroup>
          </div>
        </Section>

        <Section title="Portadas">
          <div className="kit-covers">
            <Cover seed="a" size={112} />
            <Cover seed="b" size={112} />
            <Cover seed="c" size={112} shape="circle" spinning={playing} />
          </div>
          <div className="kit-covers kit-gap-top">
            {['d', 'e', 'f', 'g', 'h', 'i'].map((s) => (
              <Cover key={s} seed={s} size={48} />
            ))}
          </div>
        </Section>

        <Section title="Tarjetas">
          <div className="kit-cards">
            <Card padding="lg" onClick={() => toast.show('Tarjeta pulsada')} ariaLabel="Escuchar">
              <Icon icon={Microphone01} size={28} className="kit-accent" />
              <p className="kit-card-title">Escuchar</p>
              <p className="kit-card-sub">Micrófono</p>
            </Card>
            <Card padding="lg" interactive>
              <Icon icon={Upload01} size={28} />
              <p className="kit-card-title">Importar</p>
              <p className="kit-card-sub">Audio o vídeo</p>
            </Card>
          </div>
          <div className="kit-glass-demo kit-gap-top">
            <Cover seed="glass" size={400} className="kit-glass-bg" />
            <Card glass padding="md" className="kit-glass-card">
              <p className="kit-card-title">Superficie translúcida</p>
              <p className="kit-card-sub">glass</p>
            </Card>
          </div>
        </Section>

        <Section title="Vacío">
          <Card padding="none">
            <EmptyState
              image={<Vinyl size={120} plinth={false} />}
              title="Aún no hay partituras"
              action={{ label: 'Escuchar', onClick: () => toast.show('Escuchar'), icon: Microphone01 }}
            />
          </Card>
        </Section>

        <Section title="Superposiciones">
          <div className="kit-wrap">
            <Button variant="secondary" onClick={() => setSheet(true)} className="kit-open-sheet">
              Hoja
            </Button>
            <Button variant="secondary" onClick={() => setActions(true)} className="kit-open-actions">
              Acciones
            </Button>
            <Button variant="secondary" onClick={() => setConfirm(true)} className="kit-open-confirm">
              Confirmar
            </Button>
            <Button variant="secondary" onClick={() => setPrompt(true)} className="kit-open-prompt">
              Renombrar
            </Button>
            <Button variant="secondary" onClick={() => toast.show('Partitura guardada', { tone: 'success' })} className="kit-open-toast">
              Aviso
            </Button>
            <Button variant="ghost" onClick={() => toast.show('No se pudo leer el archivo', { tone: 'danger' })}>
              Error
            </Button>
          </div>
        </Section>

        <Section title="Navegación">
          <div className="kit-nav">
            <BackButton />
            <TabBar visible floating={false} current="/library" />
          </div>
        </Section>
      </motion.div>


      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        title="Ajustes de reproducción"
        footer={
          <Button full size="lg" onClick={() => setSheet(false)}>
            Listo
          </Button>
        }
      >
        <div className="kit-sheet-body">
          <div className="kit-field">
            <span className="kit-label">Velocidad</span>
            <Slider value={speed} min={50} max={150} step={5} onChange={setSpeed} ariaLabel="Velocidad" format={(v) => `${v} %`} showValue />
          </div>
          <Segmented
            full
            value={hands}
            onChange={setHands}
            ariaLabel="Manos"
            options={[
              { value: 'both', label: 'Ambas' },
              { value: 'right', label: 'Derecha' },
              { value: 'left', label: 'Izquierda' },
            ]}
          />
          <SettingsGroup>
            <ListRow title="Metrónomo" trailing={<Toggle checked={metronome} onChange={setMetronome} ariaLabel="Metrónomo" />} />
            <ListRow title="Cuenta previa" trailing={<Toggle checked={countIn} onChange={setCountIn} ariaLabel="Cuenta previa" />} />
          </SettingsGroup>
        </div>
      </Sheet>

      <ActionSheet
        open={actions}
        onClose={() => setActions(false)}
        title={title}
        actions={[
          { label: 'Renombrar', icon: Edit02, onSelect: () => setPrompt(true) },
          { label: 'Compartir', icon: Share07, onSelect: () => toast.show('Compartido') },
          { label: 'Exportar MusicXML', icon: Download01, onSelect: () => toast.show('Exportado', { tone: 'success' }) },
          { label: 'Eliminar', icon: Trash01, tone: 'danger', onSelect: () => setConfirm(true) },
        ]}
      />

      <ConfirmDialog
        open={confirm}
        title="¿Eliminar partitura?"
        message="No se puede deshacer."
        confirmLabel="Eliminar"
        tone="danger"
        onConfirm={() => {
          setConfirm(false)
          toast.show('Eliminada')
        }}
        onCancel={() => setConfirm(false)}
      />

      <PromptDialog
        open={prompt}
        title="Renombrar"
        initialValue={title}
        placeholder="Título"
        maxLength={80}
        onConfirm={(v) => {
          setTitle(v)
          setPrompt(false)
          toast.show('Guardado', { tone: 'success' })
        }}
        onCancel={() => setPrompt(false)}
      />
    </Page>
  )
}
