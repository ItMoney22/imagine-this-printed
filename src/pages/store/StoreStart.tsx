// A seller's first-time sign-up (David 2026-10-26: "a sign up page for her ... go through the whole process of setting up
// her payments ... like a step flow ... use this page sucks"). Built to the approved mock (page_mockup_approvals b1bef451,
// round 2: her own logo character as the hero). Five steps: Welcome, her account, where she ships from, getting paid on
// Stripe, all set. It picks up where she left off: signed in already, ship-from saved, payouts ready.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, BadgeCheck, Check, Landmark, Loader2, Mail, MapPin, Sparkles, Truck, Wallet } from 'lucide-react'
import { useAuth } from '../../context/SupabaseAuthContext'
import TurnstileWidget from '../../components/TurnstileWidget'
import HoneypotField from '../../components/HoneypotField'
import { isCaptchaConfigured, friendlySignupError } from '../../lib/captcha'
import { addressReady, emptyAddress, fetchStore, vendorStoreApi, type ManageData, type ShipAddress, type StoreInfo } from '../../lib/vendor-store'
import StoreAddressFields from './StoreAddressFields'
import './store.css'

const STEPS = [
  { n: 1, label: 'Welcome' },
  { n: 2, label: 'Your account' },
  { n: 3, label: 'Ship-from address' },
  { n: 4, label: 'Get paid' },
  { n: 5, label: 'You are live' },
] as const

// What Rico says at each step: English with a little Spanish, the way he talks everywhere in her store.
const RICO: Record<number, string> = {
  1: 'Hey {name}, let us get your store open. Five minutes, dale.',
  2: 'First, your login. Easy, mira.',
  3: 'Where do you ship from? Your labels print from this address.',
  4: 'Now we get you paid, jefa. Stripe does the bank part, safe and quick.',
  5: 'Wepa, you did it! I am in your store manager whenever you need me.',
}

const plain = (e: any) => String(e?.message || e).replace(/^HTTP \d+: /, '').replace(/^\{"error":"(.*)"\}$/, '$1')

/** First step still to do, given what she already finished. */
function nextStep(signedIn: boolean, data: ManageData | null): number {
  if (!signedIn || !data) return 2
  if (!data.store.shipFrom) return 3
  if (!data.payouts.ready) return 4
  return 5
}

export default function StoreStart() {
  const slug = (useParams().slug || '').toLowerCase()
  const [search] = useSearchParams()
  const { user, loading: authLoading, signUp, signIn, signOut } = useAuth()

  const [store, setStore] = useState<StoreInfo | null>(null)
  const [missing, setMissing] = useState(false)
  const [data, setData] = useState<ManageData | null>(null)
  const [access, setAccess] = useState<'unknown' | 'ok' | 'notmine'>('unknown')
  const [step, setStep] = useState(() => Math.min(5, Math.max(1, Number(search.get('step')) || 1)))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  // Step 2
  const [mode, setMode] = useState<'signup' | 'signin'>('signup')
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [honeypot, setHoneypot] = useState('')
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaReset, setCaptchaReset] = useState(0)
  const captchaRequired = isCaptchaConfigured()

  // Step 3
  const [shipFrom, setShipFrom] = useState<ShipAddress>(emptyAddress())

  useEffect(() => {
    let alive = true
    fetchStore(slug).then(d => alive && setStore(d.store)).catch(() => alive && setMissing(true))
    return () => { alive = false }
  }, [slug])

  useEffect(() => {
    if (!store) return
    const prev = document.title
    document.title = `Open your store | ${store.name}`
    return () => { document.title = prev }
  }, [store])

  // Signed in: is this her store, and how far did she get?
  const refresh = useCallback(async () => {
    try {
      const d = await vendorStoreApi.load(slug)
      setData(d)
      setAccess('ok')
      if (d.store.shipFrom) setShipFrom(s => (s.street1 ? s : d.store.shipFrom!))
      return d
    } catch (e: any) {
      setData(null)
      setAccess(/HTTP (403|404)/.test(String(e?.message)) ? 'notmine' : 'unknown')
      if (!/HTTP (403|404)/.test(String(e?.message))) setMessage(plain(e))
      return null
    }
  }, [slug])

  useEffect(() => {
    if (authLoading) return
    if (!user) { setData(null); setAccess('unknown'); return }
    let alive = true
    refresh().then(d => {
      if (!alive) return
      // Back from the email link or from Stripe: carry on at the first step still open.
      setStep(s => (s <= 2 || search.get('payouts') ? Math.max(s, nextStep(true, d)) : s))
    })
    return () => { alive = false }
  }, [user, authLoading, refresh, search])

  const done = useMemo(() => ({
    1: step > 1,
    2: !!user && access === 'ok',
    3: !!data?.store.shipFrom,
    4: !!data?.payouts.ready,
    5: !!data?.payouts.ready && !!data?.store.shipFrom,
  }), [step, user, access, data])

  const name = store?.theme?.ownerFirst || 'Crystal'
  const hero = store?.theme?.character || `/stores/${slug}/character.webp`
  const back = () => { setMessage(''); setStep(s => Math.max(1, s - 1)) }

  async function submitAccount(e: FormEvent) {
    e.preventDefault()
    setMessage('')
    if (honeypot) { setSentTo(email); return }
    if (captchaRequired && !captchaToken) { setMessage('Please finish the security check below.'); return }
    setBusy(true)
    try {
      if (mode === 'signin') {
        const r = await signIn(email, password, captchaToken)
        if (r.error) setMessage(r.error)
      } else {
        // The confirmation link brings her back to this page (AuthCallback reads this).
        try { localStorage.setItem('auth_return_to', `/start/${slug}?step=2`) } catch { /* private mode: she lands on the home page and comes back here */ }
        const r = await signUp(email, password, { firstName: first, lastName: last }, captchaToken)
        if (r.error) setMessage(friendlySignupError(r.error))
        else setSentTo(email)
      }
    } finally {
      setCaptchaReset(n => n + 1)
      setBusy(false)
    }
  }

  async function saveShipFrom(e: FormEvent) {
    e.preventDefault()
    setMessage('')
    if (!addressReady(shipFrom) || !shipFrom.phone.trim()) { setMessage('Fill in your name, street, city, state, ZIP and a phone number.'); return }
    setBusy(true)
    try {
      await vendorStoreApi.saveStore(slug, { shipFrom })
      const d = await refresh()
      setStep(nextStep(true, d))
    } catch (err: any) {
      setMessage(plain(err))
    } finally {
      setBusy(false)
    }
  }

  async function openStripe() {
    setBusy(true)
    setMessage('')
    try {
      window.location.href = (await vendorStoreApi.payoutsLink(slug, 'start')).url
    } catch (err: any) {
      setMessage(plain(err))
      setBusy(false)
    }
  }

  if (missing) return <div className="vstore grid place-items-center text-center px-6"><p className="vs-display text-3xl">We couldn’t find that store.</p></div>
  if (!store || authLoading) return <div className="vstore grid place-items-center"><div className="w-10 h-10 rounded-full border-2 border-[var(--vs-primary)] border-t-transparent animate-spin" /></div>

  const rootStyle = {
    '--vs-primary': store.theme.primary, '--vs-green': store.theme.green, '--vs-pink': store.theme.pink, '--vs-gold': store.theme.gold, '--vs-ink': store.theme.ink,
  } as React.CSSProperties
  const box = 'w-full rounded-xl border border-[var(--vs-line)] bg-white px-4 h-12 outline-none focus:border-[var(--vs-primary)] focus:ring-2 focus:ring-[var(--vs-primary)]/20'

  return (
    <div className="vstore vs-start" style={rootStyle}>
      <aside className="vs-start-hero" aria-hidden={false}>
        <span className="vs-sparkle" style={{ top: '9%', left: '10%' }}><Sparkles className="w-7 h-7" /></span>
        <span className="vs-sparkle" style={{ top: '32%', right: '8%', animationDelay: '.8s' }}><Sparkles className="w-9 h-9" /></span>
        <span className="vs-sparkle" style={{ bottom: '14%', left: '7%', animationDelay: '1.4s' }}><Sparkles className="w-6 h-6" /></span>
        <div className="vs-start-bubble" role="status" aria-live="polite">
          <img src={`/stores/${slug}/assistant.webp`} alt="" width={36} height={36} className="rounded-full object-cover shrink-0" onError={e => { e.currentTarget.style.display = 'none' }} />
          <p><span className="font-semibold">Rico:</span> {RICO[step].replace('{name}', name)}</p>
        </div>
        <img src={hero} alt={`${store.name}`} className="vs-start-character vs-character" />
      </aside>

      <main className="vs-start-panel">
        <div className="vs-start-card">
          <header className="flex items-center justify-between gap-3 mb-6">
            <Link to={`/store/${slug}`} className="flex items-center gap-2 text-sm font-semibold text-[var(--vs-muted)] hover:text-[var(--vs-primary)]"><ArrowLeft className="w-4 h-4" /> {store.name}</Link>
            {user && <button className="text-sm text-[var(--vs-muted)] underline" onClick={() => signOut()}>Sign out</button>}
          </header>

          <ol className="vs-stepper" aria-label="Your steps">
            {STEPS.map(s => (
              <li key={s.n} className={`vs-step ${step === s.n ? 'is-current' : ''} ${done[s.n] && step !== s.n ? 'is-done' : ''}`} aria-current={step === s.n ? 'step' : undefined}>
                <span className="vs-step-dot">{done[s.n] && step !== s.n ? <Check className="w-4 h-4" /> : s.n}</span>
                <span className="vs-step-label">{s.label}</span>
              </li>
            ))}
          </ol>

          {step === 1 && (
            <section className="vs-start-body">
              <h1 className="vs-display text-3xl md:text-4xl">Let’s open your store, {name}</h1>
              <p className="mt-2 text-[var(--vs-muted)]">Three quick things and you are ready to take orders. It takes about five minutes.</p>
              <ul className="mt-6 grid gap-3">
                {[[Mail, 'Your login', 'One email and password, just for your store.'], [MapPin, 'Where you ship from', 'So your shipping labels print with the right address.'], [Wallet, 'How you get paid', 'Stripe sends your share straight to your bank.']].map(([Icon, title, line]: any) => (
                  <li key={title} className="flex gap-3 items-start rounded-2xl bg-[var(--vs-page)] p-4">
                    <span className="vs-chip-icon !w-11 !h-11 shrink-0" style={{ background: 'var(--vs-primary)' }}><Icon className="w-5 h-5" /></span>
                    <span><span className="block font-semibold">{title}</span><span className="text-sm text-[var(--vs-muted)]">{line}</span></span>
                  </li>
                ))}
              </ul>
              <button className="vs-btn-pink mt-7 w-full rounded-full h-13 py-3.5 font-semibold text-lg inline-flex items-center justify-center gap-2" onClick={() => setStep(nextStep(!!user, data) > 2 ? nextStep(true, data) : 2)}>
                {user && access === 'ok' ? 'Pick up where I left off' : 'Let’s go'} <ArrowRight className="w-5 h-5" />
              </button>
              {!user && <p className="mt-4 text-center text-sm text-[var(--vs-muted)]">Already have your login? <button className="underline font-semibold text-[var(--vs-primary)]" onClick={() => { setMode('signin'); setStep(2) }}>Sign in</button></p>}
            </section>
          )}

          {step === 2 && (
            <section className="vs-start-body">
              {user && access === 'ok' ? (
                <>
                  <h1 className="vs-display text-3xl md:text-4xl">You are signed in</h1>
                  <p className="mt-2 text-[var(--vs-muted)]">{user.email} runs {store.name}. On to the next step.</p>
                  <button className="vs-btn-pink mt-7 w-full rounded-full py-3.5 font-semibold text-lg inline-flex items-center justify-center gap-2" onClick={() => setStep(nextStep(true, data))}>Continue <ArrowRight className="w-5 h-5" /></button>
                </>
              ) : user && access === 'notmine' ? (
                <>
                  <h1 className="vs-display text-3xl md:text-4xl">That email isn’t this store’s</h1>
                  <p className="mt-2 text-[var(--vs-muted)]">You are signed in as {user.email}, but {store.name} was set up with a different email. Sign out and use the email Imagine This Printed has for you.</p>
                  <button className="vs-btn-solid mt-7 w-full rounded-full py-3.5 font-semibold" onClick={() => signOut()}>Sign out and try again</button>
                </>
              ) : sentTo ? (
                <>
                  <h1 className="vs-display text-3xl md:text-4xl">Check your email</h1>
                  <p className="mt-2 text-[var(--vs-muted)]">We sent a link to <span className="font-semibold text-[var(--vs-text)]">{sentTo}</span>. Tap it and you land right back here, on the next step. Open it on this same phone or computer.</p>
                  <div className="mt-6 rounded-2xl bg-[var(--vs-page)] p-4 text-sm text-[var(--vs-muted)]">Nothing there after a minute? Look in spam, or <button className="underline font-semibold text-[var(--vs-primary)]" onClick={() => setSentTo('')}>use a different email</button>.</div>
                </>
              ) : (
                <form onSubmit={submitAccount} noValidate={false}>
                  <h1 className="vs-display text-3xl md:text-4xl">{mode === 'signup' ? 'Create your account' : 'Sign in'}</h1>
                  <p className="mt-2 text-[var(--vs-muted)]">
                    {mode === 'signup' ? <>Already have an account? <button type="button" className="underline font-semibold text-[var(--vs-primary)]" onClick={() => { setMode('signin'); setMessage('') }}>Sign in</button></>
                      : <>New here? <button type="button" className="underline font-semibold text-[var(--vs-primary)]" onClick={() => { setMode('signup'); setMessage('') }}>Create your account</button></>}
                  </p>
                  <div className="mt-6 grid gap-3">
                    <HoneypotField value={honeypot} onChange={setHoneypot} />
                    {mode === 'signup' && (
                      <div className="grid grid-cols-2 gap-3">
                        <input className={box} placeholder="First name" aria-label="First name" autoComplete="given-name" required value={first} onChange={e => setFirst(e.target.value)} />
                        <input className={box} placeholder="Last name" aria-label="Last name" autoComplete="family-name" required value={last} onChange={e => setLast(e.target.value)} />
                      </div>
                    )}
                    <input className={box} type="email" placeholder="Email address" aria-label="Email address" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
                    <input className={box} type="password" placeholder="Password" aria-label="Password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={6} value={password} onChange={e => setPassword(e.target.value)} />
                    <TurnstileWidget action={mode === 'signup' ? 'signup' : 'signin'} onVerify={setCaptchaToken} resetSignal={captchaReset} className="flex justify-center" />
                  </div>
                  <button type="submit" disabled={busy || (captchaRequired && !captchaToken)} className="vs-btn-pink mt-6 w-full rounded-full py-3.5 font-semibold text-lg inline-flex items-center justify-center gap-2">
                    {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : null} {mode === 'signup' ? 'Continue' : 'Sign in'}
                  </button>
                </form>
              )}
            </section>
          )}

          {step === 3 && (
            <section className="vs-start-body">
              <form onSubmit={saveShipFrom}>
                <h1 className="vs-display text-3xl md:text-4xl">Where do you ship from?</h1>
                <p className="mt-2 text-[var(--vs-muted)]">Your shipping labels print from this address, and buyers never see it. A home address is fine.</p>
                <div className="mt-6"><StoreAddressFields value={shipFrom} onChange={setShipFrom} section="section-shipfrom" phoneLabel="Phone number" wide /></div>
                <button type="submit" disabled={busy} className="vs-btn-pink mt-6 w-full rounded-full py-3.5 font-semibold text-lg inline-flex items-center justify-center gap-2">
                  {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Truck className="w-5 h-5" />} Save and continue
                </button>
              </form>
            </section>
          )}

          {step === 4 && (
            <section className="vs-start-body">
              <h1 className="vs-display text-3xl md:text-4xl">{data?.payouts.ready ? 'You are set up to get paid' : 'Get paid'}</h1>
              {data?.payouts.ready ? (
                <>
                  <p className="mt-2 text-[var(--vs-muted)]">Stripe is ready to send your share to your bank after every sale.</p>
                  <p className="mt-5 inline-flex items-center gap-2 rounded-full bg-[var(--vs-green)]/10 text-[var(--vs-green)] px-4 py-2 font-semibold"><BadgeCheck className="w-5 h-5" /> Payouts ready</p>
                  <button className="vs-btn-pink mt-7 w-full rounded-full py-3.5 font-semibold text-lg inline-flex items-center justify-center gap-2" onClick={() => setStep(5)}>Continue <ArrowRight className="w-5 h-5" /></button>
                </>
              ) : (
                <>
                  <p className="mt-2 text-[var(--vs-muted)]">
                    {data?.payouts.detailsSubmitted
                      ? 'Stripe is checking your details. This can take a few minutes. You can finish here once it clears, or carry on.'
                      : 'Stripe is the company that moves the money. You tell them your bank on their own secure page (about five minutes), and every sale sends your share straight there. We never see your bank details.'}
                  </p>
                  <ul className="mt-5 grid gap-2 text-sm text-[var(--vs-muted)]">
                    <li className="flex gap-2"><Landmark className="w-5 h-5 text-[var(--vs-primary)] shrink-0" /> Have your bank routing and account number ready.</li>
                    <li className="flex gap-2"><BadgeCheck className="w-5 h-5 text-[var(--vs-primary)] shrink-0" /> Stripe may ask for the last 4 digits of your SSN to verify you.</li>
                  </ul>
                  <button disabled={busy} onClick={openStripe} className="vs-btn-pink mt-6 w-full rounded-full py-3.5 font-semibold text-lg inline-flex items-center justify-center gap-2">
                    {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wallet className="w-5 h-5" />} {data?.payouts.hasAccount ? 'Finish setting up payouts' : 'Set up payouts'}
                  </button>
                  <button className="mt-3 w-full text-sm text-[var(--vs-muted)] underline" onClick={() => setStep(5)}>I’ll do this later</button>
                </>
              )}
            </section>
          )}

          {step === 5 && (
            <section className="vs-start-body">
              <h1 className="vs-display text-3xl md:text-4xl">You’re all set, {name}!</h1>
              <p className="mt-2 text-[var(--vs-muted)]">Here is where your store stands.</p>
              <ul className="mt-5 grid gap-3">
                {[
                  ['Your account', !!user && access === 'ok'],
                  ['Ship-from address', !!data?.store.shipFrom],
                  ['Payouts', !!data?.payouts.ready],
                ].map(([label, ok]) => (
                  <li key={String(label)} className="flex items-center gap-3 rounded-2xl bg-[var(--vs-page)] p-4">
                    <span className={`grid place-items-center w-8 h-8 rounded-full text-white ${ok ? 'bg-[var(--vs-green)]' : 'bg-[var(--vs-gold)]'}`}>{ok ? <Check className="w-4 h-4" /> : <Loader2 className="w-4 h-4" />}</span>
                    <span className="font-semibold">{label}</span>
                    <span className="ml-auto text-sm text-[var(--vs-muted)]">{ok ? 'Done' : 'Still to do'}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-sm text-[var(--vs-muted)]">{data?.store.status === 'live' ? 'Your store is open for orders.' : 'Your store opens for orders as soon as Imagine This Printed switches it on.'} Everything else, your products, your orders and Rico, is in your store manager.</p>
              <Link to={`/vendor/store/${slug}`} className="vs-btn-pink mt-6 w-full rounded-full py-3.5 font-semibold text-lg inline-flex items-center justify-center gap-2">Open my store manager <ArrowRight className="w-5 h-5" /></Link>
              {!data?.payouts.ready && <button className="mt-3 w-full text-sm text-[var(--vs-primary)] underline font-semibold" onClick={() => setStep(4)}>Finish payouts</button>}
            </section>
          )}

          {message && <p role="alert" className="mt-4 rounded-xl bg-[var(--vs-pink)]/10 text-[var(--vs-pink)] px-4 py-3 text-sm font-medium">{message}</p>}

          {step > 1 && step < 5 && !(step === 2 && !!sentTo) && (
            <button className="mt-5 inline-flex items-center gap-1.5 text-sm text-[var(--vs-muted)] hover:text-[var(--vs-primary)]" onClick={back}><ArrowLeft className="w-4 h-4" /> Back</button>
          )}
        </div>
      </main>
    </div>
  )
}
