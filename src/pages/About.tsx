import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Store, Printer, Truck, Mail } from 'lucide-react'
import { HelpStrip } from '../components/support/SupportParts'

// Who we are, in plain facts. A store with no About page and no business name
// reads as a dropshipper or a scam to a first-time buyer (2026-10-07 trust pass).
export default function About() {
  return (
    <div className="min-h-screen bg-bg">
      <div className="bg-gradient-to-r from-purple-600 to-pink-600 py-16">
        <div className="max-w-4xl mx-auto px-4">
          <Link to="/" className="inline-flex items-center gap-2 text-white/80 hover:text-white mb-6 transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>
          <div className="flex items-center gap-4">
            <Store className="w-12 h-12 text-white" />
            <div>
              <h1 className="text-4xl font-bold text-white">About Us</h1>
              <p className="text-white/80 mt-2">Imagine This Printed LLC · Rockmart, Georgia</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="bg-card rounded-2xl shadow-lg p-8 space-y-8 text-muted leading-relaxed">
          <p className="text-lg text-text">
            Imagine This Printed is a small print shop in Rockmart, Georgia. We make custom shirts,
            DTF transfers and 3D-printed pieces, one order at a time.
          </p>

          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <Printer className="w-5 h-5 text-purple-600 mt-1 shrink-0" />
              <p><strong className="text-text">Made after you order.</strong> Nothing sits in a warehouse. Your piece is printed for you once you check out.</p>
            </div>
            <div className="flex items-start gap-3">
              <Truck className="w-5 h-5 text-purple-600 mt-1 shrink-0" />
              <p><strong className="text-text">Ships from Rockmart, GA.</strong> Free shipping on orders over $50. See the <Link to="/shipping" className="text-primary underline">shipping policy</Link> for times.</p>
            </div>
            <div className="flex items-start gap-3">
              <Mail className="w-5 h-5 text-purple-600 mt-1 shrink-0" />
              <p><strong className="text-text">Real people answer.</strong> Email wecare@imaginethisprinted.com or use the <Link to="/contact" className="text-primary underline">contact form</Link>. Returns are covered in our <Link to="/returns" className="text-primary underline">returns policy</Link>.</p>
            </div>
          </div>
        </div>

        <Link
          to="/team"
          className="group mt-8 flex items-center gap-5 rounded-2xl bg-card p-6 shadow-lg ring-1 ring-black/5 transition-shadow hover:shadow-xl"
        >
          <div className="flex -space-x-4 shrink-0">
            <img src="/team/david-trinidad.webp" alt="" className="h-16 w-16 rounded-full object-cover object-top ring-4 ring-white" />
            <img src="/team/darrell-mccutchen.webp" alt="" className="h-16 w-16 rounded-full object-cover object-top ring-4 ring-white" />
          </div>
          <div className="flex-1">
            <h2 className="font-display text-2xl font-bold text-text">Meet our team</h2>
            <p className="text-muted">David Trinidad, CEO, and Darrell McCutchen, Vice President.</p>
          </div>
          <ArrowRight className="w-6 h-6 shrink-0 text-purple-600 transition-transform group-hover:translate-x-1" />
        </Link>
      </div>
      <HelpStrip />
    </div>
  )
}
