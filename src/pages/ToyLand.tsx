// The Toy Factory — the kid-facing home of the 3D toy line (David 2026-08-19:
// "a dedicated Toy page that looks like an amazing experience for kids").
// Design is built from the product's own truth: every toy is FDM-printed
// layer by layer from at most 4 filament spools (the AMS limit), so the hero
// is a toy that prints itself slab by slab, and the page palette IS a 4-spool
// filament set on a deep printer-bed navy. Marketed URL: /toys.
// This page commits to its own look in both site themes (explicit colors).
import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Product } from '../types'
import ThreeDPrintRequestModal from '../components/ThreeDPrintRequestModal'

interface PaletteEntry { hex: string; pct?: number }

// The 4-spool page palette (filament colors, not web colors).
const SPOOLS = {
  red: '#ff4d6d',
  yellow: '#ffc93c',
  teal: '#2ec4b6',
  purple: '#9d5cff'
}
const BED = '#151f4d'      // printer-bed navy (page ground)
const BED_DEEP = '#0e1538' // deeper band
const PLA_WHITE = '#fff8f0'

// The factory robot, built from print slabs. `animate` runs the layer-by-layer
// print-in (hero only); the magnet-section copy renders instantly so the snap
// reaction happens right where the kid clicked.
const FactoryBot: React.FC<{ equipped: 'sword' | 'dragon' | null; animate?: boolean; scale?: number }> = ({ equipped, animate = false, scale = 1 }) => {
  const layer = (i: number) => (animate ? { className: 'tf-layer', style: { ['--i' as any]: i } } : { className: '', style: {} })
  const l = (i: number, extra: React.CSSProperties) => ({
    className: `tf-slab ${animate ? 'tf-layer' : ''}`,
    style: { ...(animate ? { ['--i' as any]: i } : {}), ...extra }
  })
  return (
    <div className="tf-printer" style={{ width: `min(${360 * scale}px, 80vw)` }} aria-hidden="true">
      <div className="tf-toy tf-toy-idle" style={{ transform: `scale(${scale})`, transformOrigin: 'bottom center' }}>
        {/* horn */}
        <div {...l(7, { width: 22, height: 20, background: SPOOLS.yellow, borderRadius: '50% 50% 8px 8px' })} />
        {/* head */}
        <div {...l(6, { width: 120, height: 64, background: SPOOLS.teal, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 22 })}>
          <span className="tf-eye" /><span className="tf-eye" />
        </div>
        {/* arms + body */}
        <div {...layer(5)} style={{ ...(animate ? { ['--i' as any]: 5 } : {}) }}>
          <div className="tf-arm-row">
            <div className="tf-hand">
              <div className="tf-slab" style={{ width: 34, height: 62, background: SPOOLS.purple }} />
              <span className="tf-magnet-dot" />
              {equipped === 'sword' && <span className="tf-accessory tf-snap" style={{ left: -20, top: -34 }}>🗡️</span>}
            </div>
            <div className="tf-slab" style={{ width: 108, height: 84, background: SPOOLS.red }} />
            <div className="tf-hand">
              <div className="tf-slab" style={{ width: 34, height: 62, background: SPOOLS.purple }} />
              <span className="tf-magnet-dot" />
              {equipped === 'dragon' && <span className="tf-accessory tf-snap" style={{ right: -26, top: -30 }}>🐉</span>}
            </div>
          </div>
        </div>
        {/* hips */}
        <div {...l(4, { width: 96, height: 26, background: SPOOLS.purple, marginTop: 4 })} />
        {/* legs */}
        <div {...layer(3)} style={{ ...(animate ? { ['--i' as any]: 3 } : {}), display: 'flex', gap: 18, marginTop: 4 }}>
          <div className="tf-slab" style={{ width: 36, height: 44, background: SPOOLS.teal }} />
          <div className="tf-slab" style={{ width: 36, height: 44, background: SPOOLS.teal }} />
        </div>
        {/* feet */}
        <div {...layer(2)} style={{ ...(animate ? { ['--i' as any]: 2 } : {}), display: 'flex', gap: 10, marginTop: 4 }}>
          <div className="tf-slab" style={{ width: 52, height: 18, background: SPOOLS.yellow }} />
          <div className="tf-slab" style={{ width: 52, height: 18, background: SPOOLS.yellow }} />
        </div>
      </div>
      <div className={`tf-bed-plate ${animate ? 'tf-layer' : ''}`} style={animate ? { ['--i' as any]: 0 } : {}} />
      <div className="tf-bed-glow" />
    </div>
  )
}

const ToyLand: React.FC = () => {
  const [toys, setToys] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [equipped, setEquipped] = useState<'sword' | 'dragon' | null>('sword')
  const [showPrintRequestModal, setShowPrintRequestModal] = useState(false)

  useEffect(() => {
    const loadToys = async () => {
      try {
        // Same 3D predicate ProductCatalog's "3D Prints" pill uses, live only.
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .eq('is_active', true)
          .eq('status', 'active')
          .or('category.ilike.%3d%,category.ilike.%toy%,metadata->>product_template.ilike.%3d%,metadata->>category.ilike.%3d%')
          .order('created_at', { ascending: false })
          .limit(24)
        if (error) throw error
        setToys(
          (data || []).map((d: any): Product => ({
            id: d.id,
            slug: d.slug || undefined,
            name: d.name,
            description: d.description || '',
            price: d.price || 0,
            images: d.images || [],
            category: d.category || '3d-prints',
            inStock: true,
            metadata: d.metadata || {},
            altText: d.alt_text || undefined
          }))
        )
      } catch (err) {
        console.error('[ToyFactory] load failed:', err)
      } finally {
        setLoading(false)
      }
    }
    void loadToys()
  }, [])

  return (
    <div className="tf-page">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&display=swap');

        .tf-page {
          --red: ${SPOOLS.red};
          --yellow: ${SPOOLS.yellow};
          --teal: ${SPOOLS.teal};
          --purple: ${SPOOLS.purple};
          --bed: ${BED};
          --bed-deep: ${BED_DEEP};
          --pla: ${PLA_WHITE};
          background: var(--bed);
          color: var(--pla);
          font-family: 'Poppins', system-ui, sans-serif;
          overflow-x: hidden;
        }
        .tf-display { font-family: 'Baloo 2', 'Poppins', system-ui, sans-serif; }
        .tf-wrap { max-width: 72rem; margin: 0 auto; padding: 0 1.25rem; }
        .tf-eyebrow {
          display: inline-flex; align-items: center; gap: .5rem;
          font-size: .75rem; font-weight: 600; letter-spacing: .14em;
          text-transform: uppercase; color: var(--yellow);
        }
        .tf-eyebrow::before { content: ''; width: 1.5rem; height: 3px; border-radius: 2px; background: var(--yellow); }

        /* ---------- hero ---------- */
        .tf-hero { position: relative; padding: 3.5rem 0 0; }
        .tf-hero-grid { display: grid; grid-template-columns: 1.1fr .9fr; gap: 2rem; align-items: center; }
        @media (max-width: 820px) { .tf-hero-grid { grid-template-columns: 1fr; } }
        .tf-h1 {
          font-size: clamp(2.6rem, 6.5vw, 4.6rem);
          line-height: .98; font-weight: 800; margin: .75rem 0 1rem;
        }
        .tf-h1 em { font-style: normal; color: var(--yellow); }
        .tf-h1 .tf-real {
          position: relative; white-space: nowrap;
          background: linear-gradient(90deg, var(--red), var(--purple));
          -webkit-background-clip: text; background-clip: text; color: transparent;
        }
        .tf-lede { font-size: 1.1rem; line-height: 1.6; color: #cdd3f2; max-width: 30rem; }
        .tf-cta-row { display: flex; flex-wrap: wrap; gap: .9rem; margin-top: 1.6rem; align-items: center; }
        .tf-cta {
          display: inline-block; font-family: 'Baloo 2', sans-serif; font-weight: 800;
          font-size: 1.25rem; padding: .85rem 2rem; border-radius: 999px;
          background: var(--yellow); color: #3a2c00; text-decoration: none;
          box-shadow: 0 6px 0 #c99a1a, 0 14px 30px rgba(255, 201, 60, .25);
          transition: transform .12s ease, box-shadow .12s ease;
        }
        .tf-cta:hover { transform: translateY(-2px); box-shadow: 0 8px 0 #c99a1a, 0 18px 34px rgba(255,201,60,.3); }
        .tf-cta:active { transform: translateY(3px); box-shadow: 0 3px 0 #c99a1a; }
        .tf-cta-ghost {
          font-weight: 600; color: var(--pla); text-decoration: none; font-size: 1rem;
          border-bottom: 2px dotted rgba(255,248,240,.4); padding-bottom: .1rem;
        }
        .tf-cta-ghost:hover { border-color: var(--yellow); color: var(--yellow); }
        .tf-spool-note { display: flex; align-items: center; gap: .6rem; margin-top: 1.5rem; color: #aab1dc; font-size: .85rem; }
        .tf-spool { width: 1.1rem; height: 1.1rem; border-radius: 50%; border: 3px solid rgba(255,255,255,.25); box-shadow: inset 0 0 0 2px var(--bed); }

        /* ---------- the self-printing toy ---------- */
        .tf-printer { position: relative; margin: 0 auto; width: min(320px, 80vw); padding-bottom: 1rem; }
        .tf-toy { position: relative; display: flex; flex-direction: column; align-items: center; }
        .tf-slab {
          border-radius: 10px;
          box-shadow: inset 0 -4px 0 rgba(0,0,0,.18);
          background-image: repeating-linear-gradient(0deg, rgba(255,255,255,.07) 0 2px, transparent 2px 6px);
        }
        .tf-bed-plate {
          height: 14px; width: 100%; border-radius: 8px;
          background: linear-gradient(#3a4aa3, #26346f);
          margin-top: 6px;
          box-shadow: 0 10px 30px rgba(0,0,0,.45);
        }
        .tf-bed-glow { position: absolute; inset: auto 0 -30px 0; height: 60px; background: radial-gradient(ellipse at center, rgba(46,196,182,.25), transparent 70%); }
        .tf-arm-row { display: flex; align-items: flex-start; gap: 8px; }
        .tf-hand { position: relative; }
        .tf-magnet-dot {
          position: absolute; bottom: 4px; left: 50%; transform: translateX(-50%);
          width: 8px; height: 8px; border-radius: 50%; background: #cfd6ff;
          box-shadow: 0 0 6px 2px rgba(207,214,255,.65);
        }
        .tf-eye { width: 12px; height: 14px; border-radius: 50%; background: #1b1b2d; }
        .tf-accessory {
          position: absolute; font-size: 2.1rem; filter: drop-shadow(0 4px 6px rgba(0,0,0,.4));
        }
        @media (prefers-reduced-motion: no-preference) {
          .tf-layer { opacity: 0; transform: translateY(14px); animation: tfLayer .45s cubic-bezier(.2,.9,.3,1.2) forwards; animation-delay: calc(var(--i) * .22s); }
          .tf-toy-idle { animation: tfBob 3.4s ease-in-out 2.6s infinite; }
          .tf-eye { animation: tfBlink 4.5s 3s infinite; }
          .tf-snap { animation: tfSnap .35s cubic-bezier(.2,1.4,.4,1.4); }
          .tf-float { animation: tfFloat 5s ease-in-out infinite; }
        }
        @keyframes tfLayer { to { opacity: 1; transform: translateY(0); } }
        @keyframes tfBob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        @keyframes tfBlink { 0%, 92%, 100% { transform: scaleY(1); } 95% { transform: scaleY(.1); } }
        @keyframes tfSnap { 0% { transform: scale(.2) rotate(-30deg); } 100% { transform: scale(1) rotate(0); } }
        @keyframes tfFloat { 0%,100% { transform: translateY(0) rotate(-6deg); } 50% { transform: translateY(-10px) rotate(6deg); } }

        /* ---------- sections ---------- */
        .tf-section { padding: 4.5rem 0 0; }
        .tf-h2 { font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800; line-height: 1.05; margin: .5rem 0 .75rem; }
        .tf-sub { color: #cdd3f2; max-width: 34rem; line-height: 1.6; }

        .tf-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-top: 2rem; }
        @media (max-width: 820px) { .tf-steps { grid-template-columns: 1fr; } }
        .tf-step {
          border-radius: 20px; padding: 1.4rem 1.3rem 1.5rem; position: relative;
          background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.09);
        }
        .tf-step-num {
          font-family: 'Baloo 2', sans-serif; font-weight: 800; font-size: 2.4rem; line-height: 1;
        }
        .tf-step h3 { font-family: 'Baloo 2', sans-serif; font-weight: 700; font-size: 1.25rem; margin: .5rem 0 .35rem; }
        .tf-step p { color: #c3c9ea; font-size: .95rem; line-height: 1.55; }

        .tf-feature { display: grid; grid-template-columns: 1fr 1fr; gap: 2.5rem; align-items: center; margin-top: 2rem; }
        @media (max-width: 820px) { .tf-feature { grid-template-columns: 1fr; } }
        .tf-parts-row { display: flex; gap: .8rem; margin-top: 1.2rem; flex-wrap: wrap; }
        .tf-part {
          font-family: 'Baloo 2', sans-serif; font-weight: 700; font-size: 1rem;
          padding: .6rem 1.1rem; border-radius: 999px; cursor: pointer;
          background: rgba(255,255,255,.07); color: var(--pla);
          border: 2px solid rgba(255,255,255,.16); transition: all .15s ease;
        }
        .tf-part:hover { border-color: var(--teal); transform: translateY(-2px); }
        .tf-part[data-on='true'] { background: var(--teal); border-color: var(--teal); color: #04302b; }

        .tf-pots { display: flex; gap: 1rem; margin-top: 1.2rem; }
        .tf-pot { width: 3rem; height: 3.4rem; border-radius: .6rem .6rem 1rem 1rem; position: relative; box-shadow: inset 0 -8px 0 rgba(0,0,0,.2); }
        .tf-pot::after { content: ''; position: absolute; top: -7px; left: 50%; transform: translateX(-50%); width: 70%; height: 8px; border-radius: 4px; background: rgba(255,255,255,.85); }

        /* ---------- toy grid ---------- */
        .tf-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 1.1rem; margin-top: 2rem; }
        .tf-card {
          display: block; text-decoration: none; border-radius: 22px; overflow: hidden;
          background: var(--pla); color: #23253c;
          transform: rotate(var(--tilt, 0deg));
          transition: transform .18s ease, box-shadow .18s ease;
          box-shadow: 0 10px 24px rgba(0,0,0,.35);
        }
        .tf-card:hover { transform: rotate(0deg) translateY(-6px) scale(1.02); box-shadow: 0 18px 40px rgba(0,0,0,.45); }
        .tf-card img { width: 100%; height: 200px; object-fit: cover; display: block; }
        .tf-card-body { padding: .9rem 1rem 1.1rem; }
        .tf-card-name { font-family: 'Baloo 2', sans-serif; font-weight: 700; font-size: 1.05rem; line-height: 1.15; }
        .tf-card-meta { display: flex; align-items: center; justify-content: space-between; margin-top: .6rem; }
        .tf-card-price { font-family: 'Baloo 2', sans-serif; font-weight: 800; font-size: 1.15rem; color: #6b21a8; }
        .tf-dots { display: flex; gap: .3rem; }
        .tf-dot { width: .8rem; height: .8rem; border-radius: 50%; border: 2px solid rgba(0,0,0,.12); }
        .tf-badge {
          position: absolute; top: .7rem; left: .7rem; font-family: 'Baloo 2', sans-serif;
          font-weight: 700; font-size: .7rem; letter-spacing: .05em; padding: .25rem .6rem;
          border-radius: 999px; background: var(--red); color: white;
        }

        /* ---------- grown-ups ---------- */
        .tf-grownups {
          margin-top: 4.5rem; background: var(--bed-deep); border-top: 1px solid rgba(255,255,255,.08);
          padding: 2.5rem 0 3rem;
        }
        .tf-grownups h2 { font-size: 1.15rem; font-weight: 700; letter-spacing: .02em; }
        .tf-trust { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-top: 1.2rem; }
        @media (max-width: 820px) { .tf-trust { grid-template-columns: repeat(2, 1fr); } }
        .tf-trust div { font-size: .85rem; color: #aab1dc; line-height: 1.5; }
        .tf-trust strong { color: var(--pla); display: block; margin-bottom: .15rem; font-size: .92rem; }
        .tf-quote-btn { background: none; border: none; padding: 0; font: inherit; color: var(--teal); cursor: pointer; text-decoration: underline; }

        .tf-final { text-align: center; padding: 4.5rem 0 5rem; }
      `}</style>

      {/* ============================== HERO ============================== */}
      <header className="tf-hero">
        <div className="tf-wrap tf-hero-grid">
          <div>
            <span className="tf-eyebrow">Imagine This Printed presents</span>
            <h1 className="tf-h1 tf-display">
              Dream up a toy.<br />
              We print it <span className="tf-real">for&nbsp;real</span>.
            </h1>
            <p className="tf-lede">
              Tell us your hero — a taco dragon, a robot mermaid, anything — and our
              printers build it layer by layer in full color. Magnets in the hands,
              magic in the base.
            </p>
            <div className="tf-cta-row">
              <Link to="/toy-creator" className="tf-cta">Make my toy!</Link>
              <a href="#toys" className="tf-cta-ghost">or meet the toys ↓</a>
            </div>
            <p className="tf-spool-note">
              <span className="tf-spool" style={{ background: SPOOLS.red }} />
              <span className="tf-spool" style={{ background: SPOOLS.yellow }} />
              <span className="tf-spool" style={{ background: SPOOLS.teal }} />
              <span className="tf-spool" style={{ background: SPOOLS.purple }} />
              Every toy is printed from 4 colors — yours to pick.
            </p>
          </div>

          {/* The signature: a toy that prints itself, layer by layer. */}
          <FactoryBot equipped={equipped} animate />
        </div>
      </header>

      {/* ============================ HOW IT WORKS ============================ */}
      <section className="tf-section">
        <div className="tf-wrap">
          <span className="tf-eyebrow">How your toy gets made</span>
          <h2 className="tf-h2 tf-display">From your brain to your hands</h2>
          <div className="tf-steps">
            <div className="tf-step">
              <div className="tf-step-num" style={{ color: SPOOLS.red }}>1</div>
              <h3>Dream it up</h3>
              <p>Type or say your wildest idea in the Toy Maker. Our art robot draws it while you watch — change anything until it's perfect.</p>
            </div>
            <div className="tf-step">
              <div className="tf-step-num" style={{ color: SPOOLS.yellow }}>2</div>
              <h3>We print it for real</h3>
              <p>Real 3D printers build your toy layer by layer in up to 4 bright colors. It shows up at your door ready to play.</p>
            </div>
            <div className="tf-step">
              <div className="tf-step-num" style={{ color: SPOOLS.teal }}>3</div>
              <h3>Play, swap, paint</h3>
              <p>Snap weapons and pets onto its magnet hands, tap the base to see it in AR, or paint your own with a matched paint kit.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ============================ MAGNET HANDS ============================ */}
      <section className="tf-section">
        <div className="tf-wrap tf-feature">
          <div>
            <span className="tf-eyebrow">Magnet hands</span>
            <h2 className="tf-h2 tf-display">Snap! New sword. Snap! Pet dragon.</h2>
            <p className="tf-sub">
              Every figure hides tiny magnets in its palms. Weapon packs, pet
              companions and extra parts click right in — try it on our factory
              robot:
            </p>
            <div className="tf-parts-row">
              <button
                className="tf-part"
                data-on={equipped === 'sword'}
                onClick={() => setEquipped(equipped === 'sword' ? null : 'sword')}
              >
                🗡️ Snap on the sword
              </button>
              <button
                className="tf-part"
                data-on={equipped === 'dragon'}
                onClick={() => setEquipped(equipped === 'dragon' ? null : 'dragon')}
              >
                🐉 Snap on the pet dragon
              </button>
            </div>
            {/* Same robot, right where the kid is clicking — snaps react here. */}
            <div style={{ marginTop: '1.5rem' }}>
              <FactoryBot equipped={equipped} scale={0.72} />
            </div>
          </div>
          <div>
            <span className="tf-eyebrow" style={{ color: SPOOLS.teal }}>Paint your own</span>
            <h2 className="tf-h2 tf-display" style={{ fontSize: '1.7rem' }}>The exact paints for YOUR toy</h2>
            <p className="tf-sub">
              Order your toy plain and we'll pack a paint kit with the very colors
              it was designed in — nothing missing, nothing extra. Rainy-day
              project: solved.
            </p>
            <div className="tf-pots" aria-hidden="true">
              <span className="tf-pot" style={{ background: SPOOLS.red }} />
              <span className="tf-pot" style={{ background: SPOOLS.yellow }} />
              <span className="tf-pot" style={{ background: SPOOLS.teal }} />
              <span className="tf-pot" style={{ background: SPOOLS.purple }} />
            </div>
          </div>
        </div>
      </section>

      {/* ============================== TOY GRID ============================== */}
      <section className="tf-section" id="toys">
        <div className="tf-wrap">
          <span className="tf-eyebrow">Fresh off the printers</span>
          <h2 className="tf-h2 tf-display">Meet the toys</h2>
          {loading ? (
            <div className="tf-grid">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="tf-card" style={{ height: 300, opacity: .25 }} />
              ))}
            </div>
          ) : toys.length > 0 ? (
            <div className="tf-grid">
              {toys.map((toy, i) => {
                const print3d = (toy.metadata?.print3d ?? {}) as Record<string, any>
                const palette: PaletteEntry[] = Array.isArray(print3d.palette) ? print3d.palette : []
                const fullColor = print3d.color_mode === 'color4'
                return (
                  <Link
                    key={toy.id}
                    to={`/product/${toy.slug || toy.id}`}
                    className="tf-card"
                    style={{ ['--tilt' as any]: `${(i % 3) - 1}deg`, position: 'relative' }}
                  >
                    {fullColor && <span className="tf-badge">FULL COLOR</span>}
                    <img src={toy.images?.[0] || '/itc-coin.png'} alt={toy.altText || toy.name} loading="lazy" />
                    <div className="tf-card-body">
                      <div className="tf-card-name">{toy.name.replace(/^Toy:\s*/i, '')}</div>
                      <div className="tf-card-meta">
                        <span className="tf-card-price">${Number(toy.price).toFixed(2)}</span>
                        {palette.length > 0 && (
                          <span className="tf-dots">
                            {palette.slice(0, 4).map((p, j) => (
                              <span key={j} className="tf-dot" style={{ background: p.hex }} />
                            ))}
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          ) : (
            <div style={{ marginTop: '2rem', padding: '2.5rem', borderRadius: 22, background: 'rgba(255,255,255,.05)', border: '1px dashed rgba(255,255,255,.2)', textAlign: 'center' }}>
              <p className="tf-display" style={{ fontSize: '1.5rem', fontWeight: 700 }}>
                The first toy drop is on the printers right now 🖨️
              </p>
              <p className="tf-sub" style={{ margin: '0.5rem auto 1.5rem' }}>
                Beat everyone to it — make your own one-of-a-kind toy today.
              </p>
              <Link to="/toy-creator" className="tf-cta">Make my toy!</Link>
            </div>
          )}
        </div>
      </section>

      {/* ============================== FINAL CTA ============================== */}
      <section className="tf-final">
        <div className="tf-wrap">
          <span className="tf-float" style={{ display: 'inline-block', fontSize: '2rem' }}>⭐</span>
          <h2 className="tf-h2 tf-display">What will YOU make?</h2>
          <p className="tf-sub" style={{ margin: '0 auto 1.6rem' }}>
            Toys start at $5.99. Your imagination is the only instruction manual.
          </p>
          <Link to="/toy-creator" className="tf-cta">Make my toy!</Link>
        </div>
      </section>

      {/* ============================== GROWN-UPS ============================== */}
      <section className="tf-grownups">
        <div className="tf-wrap">
          <h2>For grown-ups 👋</h2>
          <div className="tf-trust">
            <div>
              <strong>Kid-safe material</strong>
              Printed in PLA, a rigid plant-based plastic. Magnets are recessed and
              glued — always supervise children under 3.
            </div>
            <div>
              <strong>Printed by us</strong>
              Every toy is made to order on our own printers and hand-finished
              before it ships. No warehouse, no mystery factory.
            </div>
            <div>
              <strong>Checkout is yours</strong>
              Kids design, grown-ups buy. Creating a toy needs your account, and
              nothing prints until you order it.
            </div>
            <div>
              <strong>Have your own 3D file?</strong>
              <button className="tf-quote-btn" onClick={() => setShowPrintRequestModal(true)}>
                Ask us for a print quote
              </button>{' '}
              — we print STL files in the same full color.
            </div>
          </div>
        </div>
      </section>

      <ThreeDPrintRequestModal
        isOpen={showPrintRequestModal}
        onClose={() => setShowPrintRequestModal(false)}
      />
    </div>
  )
}

export default ToyLand
