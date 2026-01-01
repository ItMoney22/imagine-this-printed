import { Link } from 'react-router-dom'
import { ArrowLeft, FileText, Mail, MapPin } from 'lucide-react'

export default function TermsOfService() {
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
            <FileText className="w-12 h-12 text-white" />
            <div>
              <h1 className="text-4xl font-bold text-white">Terms of Service</h1>
              <p className="text-white/80 mt-2">Last updated: January 1, 2026</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="bg-card rounded-2xl shadow-lg p-8 space-y-8">

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">1. Acceptance of Terms</h2>
            <p className="text-muted leading-relaxed">
              By accessing or using Imagine This Printed ("Service"), you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use our Service. We reserve the right to modify these terms at any time, and your continued use constitutes acceptance of any changes.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">2. Account Registration</h2>
            <div className="space-y-4 text-muted leading-relaxed">
              <p>To use certain features, you must create an account. You agree to:</p>
              <ul className="list-disc list-inside ml-4 space-y-2">
                <li>Provide accurate and complete information</li>
                <li>Maintain the security of your account credentials</li>
                <li>Notify us immediately of any unauthorized access</li>
                <li>Be responsible for all activities under your account</li>
                <li>Be at least 18 years old or have parental consent</li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">3. Products and Orders</h2>
            <div className="space-y-4 text-muted leading-relaxed">
              <p><strong className="text-text">Product Descriptions:</strong> We strive for accuracy in product descriptions, images, and pricing. However, we do not warrant that descriptions are error-free. Colors may vary slightly due to monitor settings and printing processes.</p>

              <p><strong className="text-text">Pricing:</strong> All prices are in USD and subject to change without notice. We reserve the right to refuse or cancel orders due to pricing errors.</p>

              <p><strong className="text-text">Order Acceptance:</strong> Your order is an offer to purchase. We may accept or decline orders at our discretion. An order confirmation email does not constitute acceptance until the item ships.</p>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">4. Custom Designs and Intellectual Property</h2>
            <div className="space-y-4 text-muted leading-relaxed">
              <p><strong className="text-text">Your Content:</strong> You retain ownership of designs you upload. By submitting content, you grant us a non-exclusive license to use, reproduce, and display your designs for order fulfillment and promotional purposes.</p>

              <p><strong className="text-text">Prohibited Content:</strong> You may not upload content that:</p>
              <ul className="list-disc list-inside ml-4 space-y-2">
                <li>Infringes on copyrights, trademarks, or other intellectual property</li>
                <li>Is obscene, defamatory, or promotes illegal activity</li>
                <li>Contains hate speech or discriminatory content</li>
                <li>Violates any third party's rights</li>
              </ul>

              <p><strong className="text-text">Creator Program:</strong> If you participate in our creator program, additional terms regarding royalties and content licensing apply as specified in your creator agreement.</p>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">5. Payment Terms</h2>
            <div className="space-y-4 text-muted leading-relaxed">
              <p>Payment is processed securely through Stripe. By placing an order, you:</p>
              <ul className="list-disc list-inside ml-4 space-y-2">
                <li>Authorize us to charge your payment method</li>
                <li>Confirm you are authorized to use the payment method</li>
                <li>Agree to pay all charges including applicable taxes and shipping</li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">6. ITC Tokens and Wallet</h2>
            <div className="space-y-4 text-muted leading-relaxed">
              <p>Our platform uses ITC (Imagine This Coin) tokens as a rewards currency:</p>
              <ul className="list-disc list-inside ml-4 space-y-2">
                <li>ITC tokens have no cash value and cannot be purchased</li>
                <li>Tokens are earned through purchases, referrals, and promotions</li>
                <li>Tokens may be redeemed for discounts on future orders</li>
                <li>We reserve the right to modify or discontinue the token program</li>
                <li>Unused tokens may expire as specified in promotional terms</li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">7. Limitation of Liability</h2>
            <p className="text-muted leading-relaxed">
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, IMAGINE THIS PRINTED SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM YOUR USE OF THE SERVICE. OUR TOTAL LIABILITY SHALL NOT EXCEED THE AMOUNT PAID BY YOU FOR THE SPECIFIC ORDER GIVING RISE TO THE CLAIM.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">8. Indemnification</h2>
            <p className="text-muted leading-relaxed">
              You agree to indemnify and hold harmless Imagine This Printed and its affiliates from any claims, damages, or expenses arising from your use of the Service, your content, or violation of these Terms.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">9. Dispute Resolution</h2>
            <p className="text-muted leading-relaxed">
              Any disputes arising from these Terms or your use of the Service shall be resolved through binding arbitration in accordance with the American Arbitration Association rules. You waive any right to participate in class action lawsuits.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">10. Termination</h2>
            <p className="text-muted leading-relaxed">
              We may terminate or suspend your account at any time for violation of these Terms or for any other reason at our sole discretion. Upon termination, your right to use the Service ceases immediately.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">11. Governing Law</h2>
            <p className="text-muted leading-relaxed">
              These Terms shall be governed by the laws of the State of Delaware, United States, without regard to conflict of law principles.
            </p>
          </section>

          <section className="bg-purple-50 dark:bg-purple-900/20 rounded-xl p-6">
            <h2 className="text-2xl font-bold text-text mb-4">12. Contact Us</h2>
            <p className="text-muted leading-relaxed mb-4">
              If you have questions about these Terms of Service, please contact us:
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
