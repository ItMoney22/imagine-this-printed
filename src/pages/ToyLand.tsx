// The Toy Factory — the kid-facing home of the 3D toy line (David 2026-08-19:
// "a dedicated Toy page that looks like an amazing experience for kids" +
// "use real images of something we will really print").
// Every image on this page is a REAL toy render from user_3d_models — actual
// meshes sitting in GCS that our printers can run today — served through the
// permanent /api/media proxy (concept.png only; STL/GLB stay license-gated).
// The page palette is a 4-spool filament set (the AMS limit) on printer-bed
// navy, and it commits to that look in both site themes.
import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Product } from '../types'
import ThreeDPrintRequestModal from '../components/ThreeDPrintRequestModal'

interface PaletteEntry { hex: string; pct?: number }

const API_BASE = import.meta.env.VITE_API_BASE || 'https://api.imaginethisprinted.com'
const MEDIA = (modelId: string) => `${API_BASE}/api/media/3d-models/${modelId}/concept.png`

// The 4-spool page palette (filament colors, not web colors).
const SPOOLS = {
  red: '#ff4d6d',
  yellow: '#ffc93c',
  teal: '#2ec4b6',
  purple: '#9d5cff'
}

// Real, print-ready models from the creator lab (status 'ready', mesh on GCS).
// Curated 2026-08-19 from live user_3d_models — these are actual toys we can
// print today, not stock art. Full-color renders lead; the unpainted grey
// sculpts are honestly labeled PAINT ME and feed the paint-kit story.
const SHOWCASE: { modelId: string; name: string; tag?: 'NEW' | 'PAINT ME' }[] = [
  { modelId: '684d282e-89f5-4dd2-a30e-cf4e428643ff', name: 'The Wizard Beast', tag: 'NEW' },
  { modelId: '2d7eaa60-fb44-4a12-9357-cebeccb408f5', name: 'Robo Rascal', tag: 'NEW' },
  { modelId: 'b9024e35-c410-411b-9317-fd66c4d25247', name: 'The Fearless One' },
  { modelId: '880f4a78-55dd-4303-97bc-f405899e3ef7', name: 'Foxfire' },
  { modelId: '1c197777-16b4-4438-a726-16cb9cef09c6', name: 'Storm Boy' },
  { modelId: 'f5542e6c-cc21-437a-90f7-ca51f04ca04e', name: 'Tiger & Fox' },
  { modelId: '8638333f-7bf1-4a71-bc94-4e18b4027f96', name: 'Battle Dragon' },
  { modelId: '6b54089f-d328-4a6a-b567-e0db44713e03', name: 'Sir Barksalot', tag: 'PAINT ME' },
  { modelId: '5642d08e-425e-4f65-9da7-20ee353d0eea', name: 'Sky King', tag: 'PAINT ME' },
  { modelId: 'ac11efde-9283-4f78-a7fb-8d3804482d85', name: 'Balloon Buddy', tag: 'PAINT ME' }
]

// Named picks for the fixed layout spots.
const BARKSALOT = '6b54089f-d328-4a6a-b567-e0db44713e03'

const ToyLand: React.FC = () => {
  const [toys, setToys] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
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

  const hero = SHOWCASE[0]
  const shelf = SHOWCASE.slice(1, 3)

  return (
    <div className="tf-page">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&display=swap');

        .tf-page {
          --red: ${SPOOLS.red};
          --yellow: ${SPOOLS.yellow};
          --teal: ${SPOOLS.teal};
          --purple: ${SPOOLS.purple};
          --bed: #151f4d;
          --bed-deep: #0e1538;
          --pla: #fff8f0;
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
        .tf-hero { position: relative; padding: 3.5rem 0 1rem; }
        .tf-hero-grid { display: grid; grid-template-columns: 1.05fr .95fr; gap: 2.5rem; align-items: center; }
        @media (max-width: 880px) { .tf-hero-grid { grid-template-columns: 1fr; } }
        .tf-h1 {
          font-size: clamp(2.6rem, 6.5vw, 4.4rem);
          line-height: .98; font-weight: 800; margin: .75rem 0 1rem;
        }
        .tf-h1 .tf-real {
          white-space: nowrap;
          background: linear-gradient(90deg, var(--red), var(--purple));
          -webkit-background-clip: text; background-clip: text; color: transparent;
        }
        .tf-lede { font-size: 1.1rem; line-height: 1.6; color: #cdd3f2; max-width: 30rem; }
        .tf-cta-row { display: flex; flex-wrap: wrap; gap: .9rem; margin-top: 1.6rem; align-items: center; }
        .tf-cta {
          display: inline-block; font-family: 'Baloo 2', sans-serif; font-weight: 800;
          font-size: 1.25rem; padding: .85rem 2rem; border-radius: 999px;
          background: var(--yellow); color: #3a2c00; text-decoration: none; border: none; cursor: pointer;
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

        /* ---------- the real-toy shelf (hero right) ---------- */
        .tf-shelf { position: relative; min-height: 420px; }
        @media (max-width: 880px) { .tf-shelf { min-height: 360px; margin-top: .5rem; } }
        .tf-polaroid {
          position: absolute; background: #fff; border-radius: 14px; padding: 10px 10px 12px;
          box-shadow: 0 18px 40px rgba(0,0,0,.45);
          transition: transform .2s ease;
        }
        .tf-polaroid:hover { transform: rotate(0deg) scale(1.03) !important; z-index: 5; }
        .tf-polaroid img { display: block; border-radius: 8px; object-fit: cover; background: #fff; }
        .tf-polaroid figcaption {
          font-family: 'Baloo 2', sans-serif; font-weight: 700; color: #2b2b45;
          text-align: center; padding-top: .45rem; font-size: 1rem;
        }
        .tf-sticker {
          position: absolute; top: -14px; right: -12px; z-index: 2;
          font-family: 'Baloo 2', sans-serif; font-weight: 800; font-size: .75rem; letter-spacing: .04em;
          background: var(--red); color: #fff; padding: .4rem .8rem; border-radius: 999px;
          transform: rotate(8deg); box-shadow: 0 6px 14px rgba(0,0,0,.35);
        }
        @media (prefers-reduced-motion: no-preference) {
          .tf-sway { animation: tfSway 6s ease-in-out infinite; }
          .tf-float { animation: tfFloat 5s ease-in-out infinite; }
        }
        @keyframes tfSway { 0%,100% { translate: 0 0; } 50% { translate: 0 -8px; } }
        @keyframes tfFloat { 0%,100% { transform: translateY(0) rotate(-6deg); } 50% { transform: translateY(-10px) rotate(6deg); } }

        /* ---------- sections ---------- */
        .tf-section { padding: 4.5rem 0 0; }
        .tf-h2 { font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800; line-height: 1.05; margin: .5rem 0 .75rem; }
        .tf-sub { color: #cdd3f2; max-width: 34rem; line-height: 1.6; }

        .tf-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-top: 2rem; }
        @media (max-width: 820px) { .tf-steps { grid-template-columns: 1fr; } }
        .tf-step {
          border-radius: 20px; padding: 1.4rem 1.3rem 1.5rem;
          background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.09);
        }
        .tf-step-num { font-family: 'Baloo 2', sans-serif; font-weight: 800; font-size: 2.4rem; line-height: 1; }
        .tf-step h3 { font-family: 'Baloo 2', sans-serif; font-weight: 700; font-size: 1.25rem; margin: .5rem 0 .35rem; }
        .tf-step p { color: #c3c9ea; font-size: .95rem; line-height: 1.55; }

        .tf-feature { display: grid; grid-template-columns: 1fr 1fr; gap: 2.5rem; align-items: center; margin-top: 2rem; }
        @media (max-width: 820px) { .tf-feature { grid-template-columns: 1fr; } }
        .tf-addon-chips { display: flex; flex-wrap: wrap; gap: .7rem; margin-top: 1.2rem; }
        .tf-chip {
          font-family: 'Baloo 2', sans-serif; font-weight: 700; font-size: .95rem;
          padding: .55rem 1rem; border-radius: 999px;
          background: rgba(255,255,255,.07); color: var(--pla);
          border: 2px solid rgba(255,255,255,.16);
        }
        .tf-chip b { color: var(--yellow); font-weight: 800; }

        .tf-pots { display: flex; gap: 1rem; margin-top: 1.2rem; }
        .tf-pot { width: 3rem; height: 3.4rem; border-radius: .6rem .6rem 1rem 1rem; position: relative; box-shadow: inset 0 -8px 0 rgba(0,0,0,.2); }
        .tf-pot::after { content: ''; position: absolute; top: -7px; left: 50%; transform: translateX(-50%); width: 70%; height: 8px; border-radius: 4px; background: rgba(255,255,255,.85); }

        /* ---------- toy grid ---------- */
        .tf-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 1.1rem; margin-top: 2rem; }
        .tf-card {
          display: block; text-decoration: none; border-radius: 22px; overflow: hidden;
          background: #fff; color: #23253c; position: relative;
          transform: rotate(var(--tilt, 0deg));
          transition: transform .18s ease, box-shadow .18s ease;
          box-shadow: 0 10px 24px rgba(0,0,0,.35);
        }
        .tf-card:hover { transform: rotate(0deg) translateY(-6px) scale(1.02); box-shadow: 0 18px 40px rgba(0,0,0,.45); }
        .tf-card img { width: 100%; height: 230px; object-fit: cover; display: block; background: #fff; }
        .tf-card-body { padding: .9rem 1rem 1.1rem; }
        .tf-card-name { font-family: 'Baloo 2', sans-serif; font-weight: 700; font-size: 1.05rem; line-height: 1.15; }
        .tf-card-meta { display: flex; align-items: center; justify-content: space-between; margin-top: .6rem; }
        .tf-card-price { font-family: 'Baloo 2', sans-serif; font-weight: 800; font-size: 1.15rem; color: #6b21a8; }
        .tf-card-cta { font-family: 'Baloo 2', sans-serif; font-weight: 700; font-size: .85rem; color: #0d7f74; }
        .tf-dots { display: flex; gap: .3rem; }
        .tf-dot { width: .8rem; height: .8rem; border-radius: 50%; border: 2px solid rgba(0,0,0,.12); }
        .tf-badge {
          position: absolute; top: .7rem; left: .7rem; z-index: 2; font-family: 'Baloo 2', sans-serif;
          font-weight: 700; font-size: .7rem; letter-spacing: .05em; padding: .25rem .6rem;
          border-radius: 999px; background: var(--red); color: white;
        }
        .tf-badge[data-tag='PAINT ME'] { background: var(--teal); color: #04302b; }

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
              Every toy on this page started as someone's idea and came off our
              printers as a real full-color figure — magnets in the hands, magic
              in the base. Yours is next.
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

          {/* Real toys, straight from the creator lab. */}
          <div className="tf-shelf" aria-label="Real toys from our printers">
            <figure className="tf-polaroid tf-sway" style={{ width: 'min(300px, 62%)', right: '4%', top: 0, transform: 'rotate(2.5deg)', zIndex: 3 }}>
              <span className="tf-sticker">Printed this week!</span>
              <img src={MEDIA(hero.modelId)} alt={hero.name} width={300} height={280} />
              <figcaption>{hero.name}</figcaption>
            </figure>
            <figure className="tf-polaroid" style={{ width: 'min(190px, 42%)', left: '2%', top: '14%', transform: 'rotate(-6deg)', zIndex: 2 }}>
              <img src={MEDIA(shelf[0].modelId)} alt={shelf[0].name} width={190} height={170} loading="lazy" />
              <figcaption style={{ fontSize: '.85rem' }}>{shelf[0].name}</figcaption>
            </figure>
            <figure className="tf-polaroid" style={{ width: 'min(180px, 40%)', left: '18%', bottom: '-4%', transform: 'rotate(5deg)' }}>
              <img src={MEDIA(shelf[1].modelId)} alt={shelf[1].name} width={180} height={160} loading="lazy" />
              <figcaption style={{ fontSize: '.85rem' }}>{shelf[1].name}</figcaption>
            </figure>
          </div>
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

      {/* ==================== MAGNET HANDS + PAINT KITS ==================== */}
      <section className="tf-section">
        <div className="tf-wrap tf-feature">
          <div>
            <span className="tf-eyebrow">Magnet hands</span>
            <h2 className="tf-h2 tf-display">Snap! New sword. Snap! Pet dragon.</h2>
            <p className="tf-sub">
              Every figure hides tiny magnets in its palms, so extra parts click
              right into its hands — collect them all:
            </p>
            <div className="tf-addon-chips">
              <span className="tf-chip">🗡️ Weapon pack <b>$6.99</b></span>
              <span className="tf-chip">🐉 Pet companion <b>$9.99</b></span>
              <span className="tf-chip">🧲 Extra magnets <b>$2.99</b></span>
            </div>
            <div style={{ marginTop: '2.2rem' }}>
              <span className="tf-eyebrow" style={{ color: SPOOLS.teal }}>Paint your own</span>
              <h2 className="tf-h2 tf-display" style={{ fontSize: '1.7rem' }}>The exact paints for YOUR toy</h2>
              <p className="tf-sub">
                Order it plain and we'll pack a paint kit with the very colors
                your toy was designed in — nothing missing, nothing extra.
                Rainy-day project: solved.
              </p>
              <div className="tf-pots" aria-hidden="true">
                <span className="tf-pot" style={{ background: SPOOLS.red }} />
                <span className="tf-pot" style={{ background: SPOOLS.yellow }} />
                <span className="tf-pot" style={{ background: SPOOLS.teal }} />
                <span className="tf-pot" style={{ background: SPOOLS.purple }} />
              </div>
            </div>
          </div>
          <div style={{ position: 'relative' }}>
            <figure className="tf-polaroid" style={{ position: 'relative', width: 'min(340px, 90%)', margin: '0 auto', transform: 'rotate(-2deg)' }}>
              <img src={MEDIA(BARKSALOT)} alt="Sir Barksalot, an unpainted printed bulldog figure" style={{ width: '100%', height: 320, objectFit: 'cover' }} loading="lazy" />
              <figcaption>Sir Barksalot — printed plain, waiting for your paint</figcaption>
            </figure>
          </div>
        </div>
      </section>

      {/* ============================== TOY GRID ============================== */}
      <section className="tf-section" id="toys">
        <div className="tf-wrap">
          <span className="tf-eyebrow">Fresh off the printers</span>
          <h2 className="tf-h2 tf-display">Meet the toys</h2>
          <p className="tf-sub">
            Real designs from our creator lab — every one of these already has a
            print-ready 3D model waiting for the printer.
          </p>
          {loading ? (
            <div className="tf-grid">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="tf-card" style={{ height: 300, opacity: .15 }} />
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
                    style={{ ['--tilt' as any]: `${(i % 3) - 1}deg` }}
                  >
                    {fullColor && <span className="tf-badge">FULL COLOR</span>}
                    <img src={toy.images?.[0] || MEDIA(SHOWCASE[i % SHOWCASE.length].modelId)} alt={toy.altText || toy.name} loading="lazy" />
                    <div className="tf-card-body">
                      <div className="tf-card-name">{toy.name.replace(/^Toy:\s*/i, '')}</div>
                      <div className="tf-card-meta">
                        <span className="tf-card-price">${Number(toy.price).toFixed(2)}</span>
                        {palette.length > 0 ? (
                          <span className="tf-dots">
                            {palette.slice(0, 4).map((p, j) => (
                              <span key={j} className="tf-dot" style={{ background: p.hex }} />
                            ))}
                          </span>
                        ) : (
                          <span className="tf-card-cta">View toy →</span>
                        )}
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          ) : (
            <div className="tf-grid">
              {SHOWCASE.map((item, i) => (
                <Link
                  key={item.modelId}
                  to="/toy-creator"
                  className="tf-card"
                  style={{ ['--tilt' as any]: `${(i % 3) - 1}deg` }}
                >
                  {item.tag && <span className="tf-badge" data-tag={item.tag}>{item.tag}</span>}
                  <img src={MEDIA(item.modelId)} alt={item.name} loading="lazy" />
                  <div className="tf-card-body">
                    <div className="tf-card-name">{item.name}</div>
                    <div className="tf-card-meta">
                      <span className="tf-card-cta">Make one like this →</span>
                    </div>
                  </div>
                </Link>
              ))}
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
