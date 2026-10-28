// Owner: settings. Acerca de (push screen): app mark, version and the credits of every image,
// sound and library Pauta ships (docs/CREDITS.md).
import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { LinkExternal01 } from '@untitled-ui/icons-react'
import { brandIcons } from '../../assets/images'
import { BackButton, Icon, Page, TopBar, ease, listContainer, listItem, softSpring } from '../../ui'
import { version } from '../../../package.json'
import { SOFTWARE, SOUNDFONT_ATTRIBUTION, SOUNDFONT_LINKS, type SoftwareCredit } from './credits'
import './AboutScreen.css'

const NEW_TAB = ' (se abre en una pestaña nueva)'

function ExternalLink({ href, className, label, children }: { href: string; className?: string; label?: string; children: ReactNode }) {
  return (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer" aria-label={label}>
      {children}
    </a>
  )
}

/** Renders `text` with the given phrases as links; the visible text stays exactly the same. */
function withLinks(text: string, links: Record<string, string>): ReactNode[] {
  const escaped = Object.keys(links).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return text.split(new RegExp(`(${escaped.join('|')})`)).map((part, i) =>
    links[part] ? (
      <ExternalLink key={i} href={links[part]} className="set-inline-link" label={part + NEW_TAB}>
        {part}
      </ExternalLink>
    ) : (
      part
    ),
  )
}

function SoftwareRow({ item }: { item: SoftwareCredit }) {
  return (
    <li className="set-credit">
      <div className="set-credit__text">
        <ExternalLink href={item.url} className="set-credit__title set-credit__stretch" label={`${item.name}, ${item.license}${NEW_TAB}`}>
          {item.name}
        </ExternalLink>
        <span className="set-credit__meta">
          {item.author} · {item.license}
        </span>
      </div>
      <Icon icon={LinkExternal01} size={16} className="set-credit__ext" />
    </li>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <motion.section className="set-about__section" variants={listItem}>
      <h2 className="set-about__heading">{title}</h2>
      {children}
    </motion.section>
  )
}

export function AboutScreen() {
  return (
    <Page className="set-about">
      <TopBar sticky left={<BackButton fallback="/settings" />} />

      <header className="set-about__hero">
        <motion.img
          className="set-about__logo"
          src={brandIcons.logo}
          alt=""
          width={80}
          height={80}
          initial={{ opacity: 0, scale: 0.86 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={softSpring}
        />
        <motion.div
          className="set-about__id"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease, delay: 0.06 }}
        >
          <h1 className="set-about__name">Pauta</h1>
          <p className="set-about__version tabular">Versión {version}</p>
          <p className="set-about__line">Escucha una canción y obtén su partitura de piano.</p>
        </motion.div>
      </header>

      <motion.div className="set-about__sections" variants={listContainer} initial="hidden" animate="show">
        <Section title="Sonidos">
          <p className="set-credits set-attribution">{withLinks(SOUNDFONT_ATTRIBUTION, SOUNDFONT_LINKS)}</p>
        </Section>

        <Section title="Software">
          <ul className="set-credits">
            {SOFTWARE.map((item) => (
              <SoftwareRow key={item.name} item={item} />
            ))}
          </ul>
        </Section>
      </motion.div>
    </Page>
  )
}
