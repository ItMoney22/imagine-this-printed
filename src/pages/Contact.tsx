// The shop's help desk: quick answers first, the chat one tap away, and a message form that reaches Christina.
// Task 5878a61f, built to the mockup David approved on 2026-10-07 (approval dca0616d). The Cloudflare check and
// the honeypot are unchanged from the spam lockdown (task 673c0b4a): the API still refuses a post without a token.
import React, { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, CheckCircle2, HeartHandshake, Mail, Send } from 'lucide-react'
import { useAuth } from '../context/SupabaseAuthContext'
import TurnstileWidget from '../components/TurnstileWidget'
import HoneypotField from '../components/HoneypotField'
import { isCaptchaConfigured } from '../lib/captcha'
import { SUPPORT_EMAIL } from '../lib/help-facts'
import { HelpSearch, PickupCard, QuickAnswers, SupportDoors, SupportHero } from '../components/support/SupportParts'

const TOPICS = [
  { value: 'general', label: 'A question' },
  { value: 'order', label: 'An order I placed' },
  { value: 'custom', label: 'A custom or big order' },
  { value: 'billing', label: 'Billing or payment' },
  { value: 'technical', label: 'Something on the website' },
  { value: 'other', label: 'Something else' },
]

const Contact: React.FC = () => {
  const { user } = useAuth()
  const [params] = useSearchParams()
  const presetTopic = TOPICS.some((t) => t.value === params.get('topic')) ? params.get('topic')! : 'general'
  const [formData, setFormData] = useState({
    name: user?.displayName || user?.username || '',
    email: user?.email || '',
    category: presetTopic,
    subject: '',
    message: '',
    orderId: params.get('order') || '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState<{ ref: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [honeypot, setHoneypot] = useState('') // Spam protection
  // Human check; the API verifies the token (backend/lib/turnstile.ts). Single-use,
  // so a fresh challenge is issued after every attempt.
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaReset, setCaptchaReset] = useState(0)
  const captchaRequired = isCaptchaConfigured()
  const set = (k: keyof typeof formData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setFormData({ ...formData, [k]: e.target.value })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Honeypot check - if filled, it's a bot
    if (honeypot) {
      console.log('[Contact] Honeypot triggered, ignoring submission')
      setSubmitted({ ref: null })
      return
    }

    if (!formData.name || !formData.email || !formData.subject || !formData.message) {
      setError('Please fill in your name, email, a short subject and your message.')
      return
    }

    if (captchaRequired && !captchaToken) {
      setError('Please complete the security check below.')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const apiBase = import.meta.env.VITE_API_BASE || ''
      const response = await fetch(`${apiBase}/api/support/tickets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          subject: formData.subject,
          description: formData.message,
          category: formData.category,
          order_id: formData.orderId || null,
          user_id: user?.id || null,
          ...(captchaToken ? { captchaToken } : {})
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to submit ticket')
      }
      const data = await response.json().catch(() => ({}))
      setSubmitted({ ref: typeof data.ticketId === 'string' ? data.ticketId.slice(0, 8).toUpperCase() : null })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err: any) {
      console.error('[Contact] Error submitting ticket:', err)
      setError(err.message || 'Failed to submit your request. Please try again.')
    } finally {
      setCaptchaToken(null)
      setCaptchaReset((n) => n + 1)
      setSubmitting(false)
    }
  }

  if (submitted) {
    const first = formData.name.trim().split(/\s+/)[0]
    return (
      <div className="sp-root min-h-screen bg-bg">
        <SupportHero
          image="/support/hero.webp"
          eyebrow="Message received"
          title={<>Thanks{first ? `, ${first}` : ''}. <span className="sp-help-word">Got it.</span></>}
          subtitle={`Christina and the team will write back to ${formData.email}, usually within a day.`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <Link to="/catalog" className="sp-btn">Back to the shop <ArrowRight className="w-4 h-4" /></Link>
            {submitted.ref && (
              <p className="text-sm text-text-secondary">
                <CheckCircle2 className="inline w-4 h-4 text-primary mr-1 -mt-0.5" />
                Your reference: <span className="font-semibold text-text">{submitted.ref}</span>
              </p>
            )}
          </div>
        </SupportHero>
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pb-16">
          <h2 className="font-display text-3xl text-text">While you wait</h2>
          <p className="mt-1 mb-5 text-muted">Your answer might already be here.</p>
          <QuickAnswers />
        </div>
      </div>
    )
  }

  return (
    <div className="sp-root min-h-screen bg-bg">
      <SupportHero
        image="/support/hero.webp"
        eyebrow="We're here to help"
        title={<>How can we <span className="sp-help-word">help?</span></>}
        subtitle="We are a small print shop in Rockmart, GA. Real people answer."
      >
        <HelpSearch />
      </SupportHero>

      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pb-16 space-y-14">
        <SupportDoors signedIn={!!user} />

        <section>
          <div className="sp-banner p-6 sm:p-8 mb-5">
            <img src="/support/door-answers.webp" alt="" className="sp-banner-img" />
            <div className="relative z-10">
              <h2 className="font-display text-4xl text-text">Quick answers</h2>
              <p className="mt-1 text-text-secondary">The questions we hear most, answered.</p>
            </div>
          </div>
          <QuickAnswers />
          <p className="mt-4 text-center">
            <Link to="/help" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
              See all answers <ArrowRight className="w-4 h-4" />
            </Link>
          </p>
        </section>

        <section id="message" className="grid gap-6 lg:grid-cols-[1.6fr_1fr] scroll-mt-24">
          <div className="sp-card p-6 sm:p-8">
            <h2 className="font-display text-4xl text-text">Send us a message</h2>
            <p className="mt-1 text-muted">Tell us what you need and we will write back by email.</p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              {/* Honeypot field - hidden from users */}
              <HoneypotField value={honeypot} onChange={setHoneypot} />

              {error && (
                <div role="alert" className="sp-tint rounded-xl border border-border px-4 py-3 text-sm text-text">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <label className="block">
                  <span className="block text-sm font-semibold text-text mb-1.5">Your name</span>
                  <input id="name" type="text" value={formData.name} onChange={set('name')} className="sp-input" autoComplete="name" required />
                </label>
                <label className="block">
                  <span className="block text-sm font-semibold text-text mb-1.5">Email</span>
                  <input id="email" type="email" value={formData.email} onChange={set('email')} className="sp-input" autoComplete="email" placeholder="you@example.com" required />
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <label className="block">
                  <span className="block text-sm font-semibold text-text mb-1.5">What is it about?</span>
                  <select id="category" value={formData.category} onChange={set('category')} className="sp-input">
                    {TOPICS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="block text-sm font-semibold text-text mb-1.5">
                    Order number <span className="font-normal text-muted">(if you have one)</span>
                  </span>
                  <input id="orderId" type="text" value={formData.orderId} onChange={set('orderId')} className="sp-input" placeholder="From your order email" />
                </label>
              </div>

              <label className="block">
                <span className="block text-sm font-semibold text-text mb-1.5">Subject</span>
                <input id="subject" type="text" value={formData.subject} onChange={set('subject')} className="sp-input" placeholder="A few words, like: sizes for a team order" required />
              </label>

              <label className="block">
                <span className="block text-sm font-semibold text-text mb-1.5">Message</span>
                <textarea id="message" rows={6} value={formData.message} onChange={set('message')} className="sp-input resize-none" placeholder="The more you tell us, the faster we can help." required />
              </label>

              <TurnstileWidget
                action="contact"
                onVerify={setCaptchaToken}
                resetSignal={captchaReset}
                className="flex justify-center"
              />

              <button type="submit" disabled={submitting || (captchaRequired && !captchaToken)} className="sp-btn w-full text-base">
                <Send className="w-5 h-5" /> {submitting ? 'Sending your message to the shop' : 'Send message'}
              </button>
              {submitting && <div className="sp-progress" role="progressbar" aria-label="Sending your message"><span /></div>}
            </form>
          </div>

          <aside className="space-y-5">
            <div className="sp-card sp-tint p-6">
              <HeartHandshake className="w-8 h-8 text-primary" />
              <p className="mt-3 font-display text-2xl leading-snug text-text">Christina and the team read every message, usually within a day.</p>
              <p className="mt-3 flex items-center gap-2 text-sm text-text-secondary">
                <Mail className="w-4 h-4 text-primary" />
                <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-primary">{SUPPORT_EMAIL}</a>
              </p>
            </div>
            <PickupCard compact />
          </aside>
        </section>
      </div>
    </div>
  )
}

export default Contact
