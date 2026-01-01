import { Link } from 'react-router-dom'
import { ArrowLeft, Truck, Clock, MapPin, Mail, Package } from 'lucide-react'

export default function ShippingPolicy() {
  return (
    <div className="min-h-screen bg-bg">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-pink-600 py-16">
        <div className="max-w-4xl mx-auto px-4">
          <Link to="/" className="inline-flex items-center gap-2 text-white/80 hover:text-white mb-6 transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>
          <div className="flex items-center gap-4">
            <Truck className="w-12 h-12 text-white" />
            <div>
              <h1 className="text-4xl font-bold text-white">Shipping Policy</h1>
              <p className="text-white/80 mt-2">Last updated: January 1, 2026</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="bg-card rounded-2xl shadow-lg p-8 space-y-8">

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">1. Processing Time</h2>
            <div className="space-y-4 text-muted leading-relaxed">
              <p>All orders are custom-made just for you! Here's what to expect:</p>
              <div className="bg-purple-50 dark:bg-purple-900/20 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <Clock className="w-5 h-5 text-purple-600" />
                  <span><strong className="text-text">Standard Products:</strong> 2-5 business days</span>
                </div>
                <div className="flex items-center gap-3">
                  <Clock className="w-5 h-5 text-purple-600" />
                  <span><strong className="text-text">Custom Designs:</strong> 3-7 business days</span>
                </div>
                <div className="flex items-center gap-3">
                  <Clock className="w-5 h-5 text-purple-600" />
                  <span><strong className="text-text">Large Orders (10+ items):</strong> 5-10 business days</span>
                </div>
              </div>
              <p className="text-sm">
                Processing time begins after payment confirmation. You'll receive a confirmation email when your order ships.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">2. Shipping Options</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="py-3 px-4 text-text font-semibold">Method</th>
                    <th className="py-3 px-4 text-text font-semibold">Delivery Time</th>
                    <th className="py-3 px-4 text-text font-semibold">Cost</th>
                  </tr>
                </thead>
                <tbody className="text-muted">
                  <tr className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-3 px-4">Standard Ground</td>
                    <td className="py-3 px-4">5-8 business days</td>
                    <td className="py-3 px-4">$5.99+</td>
                  </tr>
                  <tr className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-3 px-4">Express</td>
                    <td className="py-3 px-4">2-4 business days</td>
                    <td className="py-3 px-4">$12.99+</td>
                  </tr>
                  <tr className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-3 px-4">Priority Overnight</td>
                    <td className="py-3 px-4">1-2 business days</td>
                    <td className="py-3 px-4">$24.99+</td>
                  </tr>
                  <tr>
                    <td className="py-3 px-4">Local Delivery</td>
                    <td className="py-3 px-4">Same day - 2 days</td>
                    <td className="py-3 px-4">Varies by distance</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-sm text-muted mt-4">
              * Shipping costs are calculated at checkout based on destination and package weight. Free shipping may be available for orders over a certain amount.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">3. Shipping Locations</h2>
            <div className="space-y-4 text-muted leading-relaxed">
              <p><strong className="text-text">United States:</strong> We ship to all 50 states, including Alaska, Hawaii, and U.S. territories. Remote areas may have longer delivery times.</p>

              <p><strong className="text-text">International:</strong> We currently ship to select international destinations. International orders may be subject to customs duties, taxes, and fees imposed by the destination country. These charges are the responsibility of the recipient.</p>

              <p><strong className="text-text">P.O. Boxes:</strong> We can ship to P.O. Boxes via USPS. Some expedited options may not be available for P.O. Box addresses.</p>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">4. Order Tracking</h2>
            <div className="space-y-4 text-muted leading-relaxed">
              <p>Once your order ships, you'll receive an email with tracking information. You can also track your order by:</p>
              <ul className="list-disc list-inside ml-4 space-y-2">
                <li>Logging into your account and viewing order history</li>
                <li>Using the tracking link in your shipping confirmation email</li>
                <li>Contacting our customer support team</li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">5. Delivery Issues</h2>
            <div className="space-y-4 text-muted leading-relaxed">
              <p><strong className="text-text">Lost Packages:</strong> If your tracking shows delivered but you haven't received your package, please check with neighbors and building management. If still not found, contact us within 7 days of delivery date.</p>

              <p><strong className="text-text">Damaged Packages:</strong> If your package arrives damaged, please take photos of the packaging and contents, then contact us immediately. We'll work to resolve the issue quickly.</p>

              <p><strong className="text-text">Wrong Address:</strong> Please double-check your shipping address before completing your order. We are not responsible for packages delivered to incorrect addresses provided by customers. Address corrections after shipping may incur additional fees.</p>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">6. Shipping Restrictions</h2>
            <div className="space-y-4 text-muted leading-relaxed">
              <p>Certain items may have shipping restrictions based on:</p>
              <ul className="list-disc list-inside ml-4 space-y-2">
                <li>Destination country import regulations</li>
                <li>Product size or weight limitations</li>
                <li>Carrier restrictions</li>
              </ul>
              <p>If your order cannot be shipped to your location, we will contact you to discuss alternatives or issue a refund.</p>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">7. Holiday Shipping</h2>
            <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-xl p-4 text-muted">
              <div className="flex items-start gap-3">
                <Package className="w-5 h-5 text-yellow-600 mt-1" />
                <div>
                  <p className="font-semibold text-text">Plan Ahead for Holidays!</p>
                  <p className="text-sm mt-1">
                    During peak seasons (November-December), shipping carriers experience high volumes which may cause delays.
                    We recommend ordering at least 2 weeks before you need your items to arrive.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="bg-purple-50 dark:bg-purple-900/20 rounded-xl p-6">
            <h2 className="text-2xl font-bold text-text mb-4">Questions About Shipping?</h2>
            <p className="text-muted leading-relaxed mb-4">
              Our customer support team is here to help with any shipping questions:
            </p>
            <div className="space-y-2">
              <div className="flex items-center gap-3 text-muted">
                <Mail className="w-5 h-5 text-purple-600" />
                <a href="mailto:wecare@imaginethisprinted.com" className="text-purple-600 hover:underline">
                  wecare@imaginethisprinted.com
                </a>
              </div>
              <div className="flex items-center gap-3 text-muted">
                <MapPin className="w-5 h-5 text-purple-600" />
                <span>Imagine This Printed, United States</span>
              </div>
            </div>
          </section>

        </div>
      </div>
    </div>
  )
}
