// DEV-only layout demos for the gallery: #/__kit?demo=screen and #/__kit?demo=tab
import { useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { DotsHorizontal, MusicNote01, Star01 } from '@untitled-ui/icons-react'
import {
  BackButton,
  BottomBar,
  Button,
  Card,
  Chip,
  ChipRow,
  Cover,
  Icon,
  IconButton,
  ListRow,
  Page,
  RangeSlider,
  SearchField,
  SectionHeader,
  TabBar,
  TopBar,
  Waveform,
  listContainer,
  listItem,
} from './index'
import './KitGallery.css'


export function demoPeaks(n: number): number[] {
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  return Array.from({ length: n }, (_, i) => {
    const t = i / n
    const envelope = 0.35 + 0.65 * Math.sin(Math.PI * t) ** 0.6
    const phrase = 0.55 + 0.45 * Math.abs(Math.sin(t * Math.PI * 7))
    return envelope * phrase * (0.55 + 0.45 * rand())
  })
}

/** Push screen skeleton: TopBar with back + content + bottom actions above the safe area. */
export function ScreenDemo() {
  const peaks = useMemo(() => demoPeaks(300), [])
  const [range, setRange] = useState<[number, number]>([8, 41])
  return (
    <Page>
      <TopBar
        sticky
        left={<BackButton fallback="/__kit" />}
        title="Recortar"
        subtitle="ensayo-salon.m4a"
        right={<IconButton icon={DotsHorizontal} label="Más opciones" />}
      />
      <div className="kit-screen">
        <Cover seed="ensayo" size={168} className="kit-screen__cover" />
        <p className="kit-screen__time tabular">0:33</p>
        <p className="kit-screen__hint">Selección</p>
        <Card padding="lg" className="kit-screen__card">
          <Waveform peaks={peaks} selection={[range[0] / 60, range[1] / 60]} height={64} />
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
      </div>
      <BottomBar>
        <Button variant="accent" size="lg" icon={MusicNote01}>
          Transcribir
        </Button>
      </BottomBar>
    </Page>
  )
}

const ITEMS = [
  { id: 'minueto', title: 'Minueto en Sol', meta: 'Sol mayor · 3/4', fav: true },
  { id: 'elisa', title: 'Para Elisa', meta: 'La menor · 3/8', fav: false },
  { id: 'gymno', title: 'Gymnopédie n.º 1', meta: 'Re mayor · 3/4', fav: false },
  { id: 'rec-0941', title: 'Grabación 27 oct, 09:41', meta: 'Micrófono · 0:48', cover: '', fav: false },
]

/** Tab screen skeleton: large title, search, chips, list, floating tab bar. */
export function TabDemo() {
  const [query, setQuery] = useState('')
  const [chip, setChip] = useState('todas')
  return (
    <>
      <Page variant="tab" tabBar>
        <TopBar large title="Biblioteca" right={<IconButton icon={DotsHorizontal} label="Más opciones" />} />
        <div className="kit-tab">
          <SearchField value={query} onChange={setQuery} />
          <ChipRow ariaLabel="Filtros">
            {['todas', 'favoritas', 'grabaciones', 'demos'].map((c) => (
              <Chip key={c} selected={chip === c} onClick={() => setChip(c)}>
                {c[0].toUpperCase() + c.slice(1)}
              </Chip>
            ))}
          </ChipRow>
          <SectionHeader title="Recientes" action={{ label: 'Ver todo', onClick: () => {} }} />
          <motion.div className="kit-tab__list" variants={listContainer} initial="hidden" animate="show">
            {ITEMS.map((it) => (
              <motion.div key={it.id} variants={listItem}>
                <Card padding="none" onClick={() => {}} ariaLabel={it.title}>
                  <ListRow
                    leading={<Cover seed={it.id} size={52} />}
                    title={it.title}
                    subtitle={it.meta}
                    trailing={it.fav ? <Icon icon={Star01} size={16} /> : undefined}
                  />
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </Page>
      <TabBar visible current="/library" />
    </>
  )
}
