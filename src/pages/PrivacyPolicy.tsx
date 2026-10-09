import { Link } from 'react-router-dom'
import BusinessContactBlock from '../components/BusinessContactBlock'
import { POLICY_UPDATED } from '../config/business-info'
import { PENDING_REFERRAL_KEY, REFERRAL_LINK_DAYS } from '../utils/referral-capture'
import { ArrowLeft, Shield, Mail } from 'lucide-react'

export default function PrivacyPolicy() {
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
            <Shield className="w-12 h-12 text-white" />
            <div>
              <h1 className="text-4xl font-bold text-white">Privacy Policy</h1>
              <p className="text-white/80 mt-2">Last updated: {POLICY_UPDATED.privacy}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="bg-card rounded-2xl shadow-lg p-8 space-y-8">

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">1. Introduction</h2>
            <p className="text-muted leading-relaxed">
              Welcome to Imagine This Printed ("we," "our," or "us"). We are committed to protecting your personal information and your right to privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you visit our website imaginethisprinted.com and use our services.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">2. Information We Collect</h2>
            <div className="space-y-4 text-muted leading-relaxed">
              <p><strong className="text-text">Personal Information:</strong> When you create an account, place an order, or contact us, we may collect:</p>
              <ul className="list-disc list-inside ml-4 space-y-2">
                <li>Name and email address</li>
                <li>Shipping and billing address</li>
                <li>Phone number</li>
                <li>Payment information (processed securely via Stripe)</li>
                <li>Account credentials</li>
              </ul>

              <p><strong className="text-text">Automatically Collected Information:</strong></p>
              <ul className="list-disc list-inside ml-4 space-y-2">
                <li>IP address and browser type</li>
                <li>Device information</li>
                <li>Pages visited and time spent</li>
                <li>Cookies and similar tracking technologies</li>
              </ul>

              <p><strong className="text-text">User-Generated Content:</strong></p>
              <ul className="list-disc list-inside ml-4 space-y-2">
                <li>Designs and artwork you upload</li>
                <li>Product customizations</li>
                <li>Reviews and feedback</li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">3. How We Use Your Information</h2>
            <ul className="list-disc list-inside ml-4 space-y-2 text-muted">
              <li>Process and fulfill your orders</li>
              <li>Create and manage your account</li>
              <li>Send order confirmations and shipping updates</li>
              <li>Respond to customer service requests</li>
              <li>Send marketing communications (with your consent)</li>
              <li>Improve our website and services</li>
              <li>Detect and prevent fraud</li>
              <li>Comply with legal obligations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">4. Information Sharing</h2>
            <p className="text-muted leading-relaxed mb-4">
              We do not sell your personal information. We may share your information with:
            </p>
            <ul className="list-disc list-inside ml-4 space-y-2 text-muted">
              <li><strong className="text-text">Service Providers:</strong> Payment processors (Stripe), shipping carriers, email services</li>
              <li><strong className="text-text">Business Partners:</strong> Print fulfillment partners who produce your orders</li>
              <li><strong className="text-text">Legal Requirements:</strong> When required by law or to protect our rights</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">5. Data Security</h2>
            <p className="text-muted leading-relaxed">
              We implement industry-standard security measures to protect your information, including SSL encryption, secure payment processing through Stripe, and regular security audits. However, no method of transmission over the Internet is 100% secure.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">6. Your Rights</h2>
            <p className="text-muted leading-relaxed mb-4">You have the right to:</p>
            <ul className="list-disc list-inside ml-4 space-y-2 text-muted">
              <li>Access the personal information we hold about you</li>
              <li>Request correction of inaccurate information</li>
              <li>Request deletion of your information</li>
              <li>Opt-out of marketing communications</li>
              <li>Export your data in a portable format</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">7. Cookies</h2>
            <div className="space-y-4 text-muted leading-relaxed">
              <p>
                We use a small number of cookies and similar technologies to operate the site and to credit referrals. You can control cookies through your browser settings, though some features may not function properly without them.
              </p>
              <p><strong className="text-text">Referral links:</strong></p>
              <ul className="list-disc list-inside ml-4 space-y-2">
                <li><strong className="text-text">{PENDING_REFERRAL_KEY}</strong> — when you open a friend&apos;s referral link, its code is kept in this browser&apos;s <em>localStorage</em> (not a cookie) so your friend can be credited if you make an account. It is deleted the first time you sign in, or after {REFERRAL_LINK_DAYS} days. Choosing Decline on the site banner deletes it and stops new ones being kept.</li>
              </ul>
              <p>
                Essential authentication and cart state are stored in browser <em>localStorage</em>, not cookies, and are not subject to consent because they are required for the site to function.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">8. Children's Privacy</h2>
            <p className="text-muted leading-relaxed">
              Our website, including the Toy Maker on our Toy Factory page, is for people 13 and older. Kids are welcome to dream up a toy with a parent or guardian, but the grown-up types or says the idea, makes any account and places the order. We do not knowingly collect personal information, including typed or recorded ideas, from children under 13. If you believe we have collected such information, please contact us immediately and we will delete it. Our toy figures contain small magnets and are rated ages 14 and up.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-text mb-4">9. Changes to This Policy</h2>
            <p className="text-muted leading-relaxed">
              We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new policy on this page and updating the "Last updated" date.
            </p>
          </section>

          <section className="bg-purple-50 dark:bg-purple-900/20 rounded-xl p-6">
            <h2 className="text-2xl font-bold text-text mb-4">10. Contact Us</h2>
            <p className="text-muted leading-relaxed mb-4">
              If you have questions about this Privacy Policy, please contact us:
            </p>
            <div className="space-y-2">
              <div className="flex items-center gap-3 text-muted">
                <Mail className="w-5 h-5 text-purple-600" />
                <a href="mailto:wecare@imaginethisprinted.com" className="text-purple-600 hover:underline">
                  wecare@imaginethisprinted.com
                </a>
              </div>
              <BusinessContactBlock />
            </div>
          </section>

        </div>
      </div>
    </div>
  )
}
