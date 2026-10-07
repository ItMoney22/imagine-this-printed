import { Link } from 'react-router-dom'
import { Mail, Shirt, Box, Sparkles } from 'lucide-react'

const WHAT_WE_MAKE = [
  { icon: Shirt, title: 'Custom apparel & DTF transfers', body: 'Tees, hoodies and blanks printed to order with your artwork or one of our designs.' },
  { icon: Sparkles, title: 'Metal art prints', body: 'Wall-ready metal prints in standard sizes, made from artwork you pick or create.' },
  { icon: Box, title: '3D-printed toys', body: 'Figures and toys printed on demand in the tier and colors you choose.' },
]

export default function About() {
  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-4xl mx-auto px-4 py-16 space-y-10">
        <header>
          <h1 className="text-4xl font-bold text-text">About Imagine This Printed</h1>
          <p className="mt-4 text-lg text-muted leading-relaxed">
            Imagine This Printed is a custom printing shop. Every item is made to order: you pick or
            create the artwork, we print it, inspect it and ship it to you.
          </p>
        </header>

        <section className="grid gap-4 sm:grid-cols-3">
          {WHAT_WE_MAKE.map(({ icon: Icon, title, body }) => (
            <div key={title} className="bg-card rounded-2xl border card-border p-6">
              <Icon className="w-8 h-8 text-primary" />
              <h2 className="mt-3 font-semibold text-text">{title}</h2>
              <p className="mt-2 text-sm text-muted">{body}</p>
            </div>
          ))}
        </section>

        <section className="bg-card rounded-2xl border card-border p-6">
          <h2 className="text-2xl font-bold text-text mb-3">Contact us</h2>
          <p className="text-muted">Questions about an order or a design? A real person reads every message.</p>
          <div className="mt-4 flex flex-col sm:flex-row gap-4 sm:items-center">
            <a href="mailto:wecare@imaginethisprinted.com" className="inline-flex items-center gap-2 text-primary hover:underline">
              <Mail className="w-5 h-5" />
              wecare@imaginethisprinted.com
            </a>
            <Link to="/contact" className="text-sm text-muted hover:text-secondary underline">
              Or use the contact form
            </Link>
          </div>
          <p className="mt-4 text-sm text-muted">
            See our <Link to="/shipping" className="underline">shipping</Link> and{' '}
            <Link to="/returns" className="underline">returns</Link> policies.
          </p>
        </section>
      </div>
    </div>
  )
}
