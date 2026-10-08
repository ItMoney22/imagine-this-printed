import { Link } from 'react-router-dom'
import { ArrowLeft, Store, Printer, Truck, Mail } from 'lucide-react'
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
      </div>
      <HelpStrip />
    </div>
  )
}
