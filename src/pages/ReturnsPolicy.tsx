import { Link } from 'react-router-dom'
import { ArrowLeft, RotateCcw, Mail, MapPin, CheckCircle, XCircle, AlertCircle } from 'lucide-react'

export default function ReturnsPolicy() {
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
            <RotateCcw className="w-12 h-12 text-white" />
            <div>
              <h1 className="text-4xl font-bold text-white">Returns & Refunds</h1>
              <p className="text-white/80 mt-2">Last updated: January 1, 2026</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="bg-card rounded-2xl shadow-lg p-8 space-y-8">

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">Our Satisfaction Guarantee</h2>
            <p className="text-muted leading-relaxed">
              At Imagine This Printed, we take pride in the quality of our custom products. Since each item is made-to-order specifically for you, we have a specialized return policy. We want you to love what you receive, and we're here to make it right if something goes wrong.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">What's Eligible for Returns/Refunds</h2>
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 bg-green-50 dark:bg-green-900/20 rounded-xl">
                <CheckCircle className="w-6 h-6 text-green-600 mt-0.5" />
                <div>
                  <p className="font-semibold text-text">We WILL Replace or Refund:</p>
                  <ul className="list-disc list-inside ml-2 mt-2 text-muted space-y-1">
                    <li>Defective or damaged items (print quality issues, tears, stains)</li>
                    <li>Wrong item received (different from what you ordered)</li>
                    <li>Significant color discrepancy from the preview</li>
                    <li>Missing items from your order</li>
                    <li>Items damaged during shipping</li>
                  </ul>
                </div>
              </div>

              <div className="flex items-start gap-3 p-4 bg-red-50 dark:bg-red-900/20 rounded-xl">
                <XCircle className="w-6 h-6 text-red-600 mt-0.5" />
                <div>
                  <p className="font-semibold text-text">NOT Eligible for Returns:</p>
                  <ul className="list-disc list-inside ml-2 mt-2 text-muted space-y-1">
                    <li>Change of mind or no longer wanted</li>
                    <li>Incorrect size ordered by customer</li>
                    <li>Design errors made by customer (typos, wrong image uploaded)</li>
                    <li>Minor color variations (due to monitor differences)</li>
                    <li>Items that have been worn, washed, or altered</li>
                  </ul>
                </div>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">How to Request a Return/Refund</h2>
            <div className="space-y-4 text-muted leading-relaxed">
              <div className="flex items-start gap-4 p-4 border border-gray-200 dark:border-gray-700 rounded-xl">
                <div className="w-8 h-8 bg-purple-600 text-white rounded-full flex items-center justify-center font-bold flex-shrink-0">1</div>
                <div>
                  <p className="font-semibold text-text">Contact Us Within 14 Days</p>
                  <p className="text-sm mt-1">Email us at wecare@imaginethisprinted.com with your order number and a description of the issue.</p>
                </div>
              </div>

              <div className="flex items-start gap-4 p-4 border border-gray-200 dark:border-gray-700 rounded-xl">
                <div className="w-8 h-8 bg-purple-600 text-white rounded-full flex items-center justify-center font-bold flex-shrink-0">2</div>
                <div>
                  <p className="font-semibold text-text">Provide Photo Evidence</p>
                  <p className="text-sm mt-1">Include clear photos showing the defect, damage, or issue. This helps us process your request faster.</p>
                </div>
              </div>

              <div className="flex items-start gap-4 p-4 border border-gray-200 dark:border-gray-700 rounded-xl">
                <div className="w-8 h-8 bg-purple-600 text-white rounded-full flex items-center justify-center font-bold flex-shrink-0">3</div>
                <div>
                  <p className="font-semibold text-text">Wait for Our Response</p>
                  <p className="text-sm mt-1">We'll review your request within 1-2 business days and provide next steps.</p>
                </div>
              </div>

              <div className="flex items-start gap-4 p-4 border border-gray-200 dark:border-gray-700 rounded-xl">
                <div className="w-8 h-8 bg-purple-600 text-white rounded-full flex items-center justify-center font-bold flex-shrink-0">4</div>
                <div>
                  <p className="font-semibold text-text">Receive Resolution</p>
                  <p className="text-sm mt-1">We'll either send a replacement, issue a refund, or provide store credit based on the situation.</p>
                </div>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">Refund Processing</h2>
            <div className="space-y-4 text-muted leading-relaxed">
              <p><strong className="text-text">Refund Method:</strong> Refunds are issued to the original payment method used for the purchase.</p>

              <p><strong className="text-text">Processing Time:</strong> Once approved, refunds typically appear within 5-10 business days, depending on your bank or credit card company.</p>

              <p><strong className="text-text">Partial Refunds:</strong> In some cases, we may offer a partial refund if the issue is minor or if only part of your order was affected.</p>

              <p><strong className="text-text">ITC Credits:</strong> Instead of a refund, you may choose to receive ITC (Imagine This Coin) credits to your wallet for future purchases. ITC credits are issued instantly and include a 10% bonus.</p>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">Replacements</h2>
            <div className="space-y-4 text-muted leading-relaxed">
              <p>For defective or damaged items, we're happy to send a replacement at no additional cost. Replacement orders are prioritized and typically ship within 2-3 business days.</p>

              <p>You do not need to return the defective item in most cases. We may ask you to dispose of it or donate it locally.</p>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">Exchanges</h2>
            <div className="flex items-start gap-3 p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-xl text-muted">
              <AlertCircle className="w-6 h-6 text-yellow-600 mt-0.5" />
              <div>
                <p className="font-semibold text-text">Size/Color Exchanges</p>
                <p className="text-sm mt-1">
                  Because all items are custom-made, we cannot offer direct exchanges. If you need a different size or color,
                  you'll need to place a new order. If the issue was our error (wrong item sent), we'll send the correct item at no charge.
                </p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">Cancellations</h2>
            <div className="space-y-4 text-muted leading-relaxed">
              <p><strong className="text-text">Before Production:</strong> Orders can be cancelled for a full refund if production has not started (usually within 2-4 hours of placing the order).</p>

              <p><strong className="text-text">During Production:</strong> Once production begins, orders cannot be cancelled as materials have been customized for your order.</p>

              <p><strong className="text-text">After Shipping:</strong> Shipped orders cannot be cancelled. Please refer to our return policy above.</p>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">Creator/Vendor Products</h2>
            <p className="text-muted leading-relaxed">
              For products created by our community creators or vendors, the same return policy applies. We handle all customer service and quality issues directly. Creators receive their royalties only after the return/refund period has passed.
            </p>
          </section>

          <section className="bg-purple-50 dark:bg-purple-900/20 rounded-xl p-6">
            <h2 className="text-2xl font-bold text-text mb-4">Need Help?</h2>
            <p className="text-muted leading-relaxed mb-4">
              We're here to help resolve any issues with your order. Contact our friendly support team:
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
            <p className="text-sm text-muted mt-4">
              Response time: Within 24-48 hours (Monday-Friday)
            </p>
          </section>

        </div>
      </div>
    </div>
  )
}
