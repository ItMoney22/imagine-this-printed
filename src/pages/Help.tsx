// Quick answers: the shop's help page (task 5878a61f, mockup approval dca0616d). Sizing, how long it takes,
// shipping cost, returns, custom orders and pickup in Rockmart, so the chat and the contact form get fewer
// repeat questions. Every answer lives in src/lib/help-facts.ts.
import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { ArrowRight, ChevronDown } from 'lucide-react'
import { HELP_TOPICS, searchHelp, type HelpItem } from '../lib/help-facts'
import { HelpSearch, HelpStrip, PickupCard, SizeChart, SupportHero, TOPIC_ICONS } from '../components/support/SupportParts'

function Answer({ item, open = false }: { item: HelpItem; open?: boolean }) {
  return (
    <details className="sp-acc rounded-xl border border-border bg-card" open={open}>
      <summary className="flex items-center justify-between gap-3 px-4 py-3.5">
        <span className="font-semibold text-text">{item.q}</span>
        <ChevronDown className="sp-acc-chev w-5 h-5 text-muted shrink-0" aria-hidden />
      </summary>
      <div className="px-4 pb-4 -mt-1 text-text-secondary leading-relaxed">
        <p>{item.a}</p>
        {item.link && (
          <Link to={item.link.to} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
            {item.link.label} <ArrowRight className="w-4 h-4" />
          </Link>
        )}
      </div>
    </details>
  )
}

export default function Help() {
  const [params, setParams] = useSearchParams()
  const { hash } = useLocation()
  const [query, setQuery] = useState(params.get('q') || '')
  const results = useMemo(() => searchHelp(query), [query])
  const searching = query.trim().length > 1

  // Quick-answer cards link to /help#<topic>: land on that section once it has rendered.
  useEffect(() => {
    if (!hash) return
    const el = document.getElementById(hash.slice(1))
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  }, [hash])

  const onSearch = (q: string) => {
    setQuery(q)
    setParams(q.trim() ? { q: q.trim() } : {}, { replace: true })
  }

  return (
    <div className="sp-root min-h-screen bg-bg">
      <SupportHero
        image="/support/help-hero.webp"
        eyebrow="Real answers from our Rockmart shop"
        title={<>Quick <span className="sp-help-word">answers</span></>}
        subtitle="The questions people ask us most, answered straight. Can't find yours? Ask us in the chat."
      >
        <HelpSearch initial={query} onSearch={onSearch} />
      </SupportHero>

      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        {/* Topic jump bar */}
        <nav aria-label="Help topics" className="sp-noscrollbar flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
          {HELP_TOPICS.map((t) => {
            const Icon = TOPIC_ICONS[t.id]
            return (
              <a key={t.id} href={`#${t.id}`} className="sp-chip inline-flex items-center gap-1.5 whitespace-nowrap">
                <Icon className="w-4 h-4" /> {t.title}
              </a>
            )
          })}
        </nav>

        {searching ? (
          <section className="mt-8" aria-live="polite">
            <h2 className="font-display text-3xl text-text">
              {results.length ? `${results.length} answer${results.length === 1 ? '' : 's'} for “${query.trim()}”` : `No answers for “${query.trim()}” yet`}
            </h2>
            {results.length ? (
              <div className="mt-5 space-y-3 max-w-3xl">
                {results.map(({ topic, item }) => (
                  <div key={item.q}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-1">{topic.title}</p>
                    <Answer item={item} open />
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-text-secondary max-w-xl">Ask us instead. Christina and the team answer every message.</p>
            )}
            <button type="button" onClick={() => onSearch('')} className="mt-6 text-sm font-semibold text-primary hover:underline">
              Show every topic
            </button>
          </section>
        ) : (
          <div className="mt-8 space-y-14">
            {HELP_TOPICS.map((t) => {
              const Icon = TOPIC_ICONS[t.id]
              return (
                <section key={t.id} id={t.id} className="scroll-mt-24 grid gap-6 lg:grid-cols-[1fr_1.3fr]">
                  <div>
                    <span className="sp-icon-chip w-12 h-12 rounded-full grid place-items-center"><Icon className="w-6 h-6" /></span>
                    <h2 className="mt-3 font-display text-4xl text-text">{t.title}</h2>
                    <p className="mt-2 text-lg text-text-secondary">{t.short}</p>
                    {t.id === 'pickup' && <div className="mt-5 max-w-sm"><PickupCard /></div>}
                  </div>
                  <div className="space-y-3">
                    {t.items.map((item) => <Answer key={item.q} item={item} />)}
                    {t.id === 'sizing' && <SizeChart />}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </div>

      <HelpStrip />
    </div>
  )
}
