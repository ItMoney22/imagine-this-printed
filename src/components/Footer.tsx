import { Link } from 'react-router-dom'
import { SHOP_FACTS } from '../lib/shop-facts'

export function Footer() {
  const currentYear = new Date().getFullYear()

  return (
    <footer className="bg-card border-t card-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="col-span-1">
            <Link to="/" className="block mb-4">
              <img src="/mr-imagine/mr-imagine-waist-up.png" alt="Mr. Imagine" className="h-14 w-auto object-contain" />
            </Link>
            <p className="mt-3 text-sm text-muted max-w-xs">
              Your one-stop shop for custom printing solutions, from DTF transfers to 3D prints.
            </p>
            <p className="mt-2 text-sm text-text-secondary">
              {SHOP_FACTS.legalName}, {SHOP_FACTS.town}, {SHOP_FACTS.stateName}
            </p>
          </div>

          {/* Products */}
          <div>
            <h4 className="font-semibold text-text mb-4">Products</h4>
            <ul className="space-y-2">
              {/* Hrefs must be real ProductCatalog category ids — the old
                  dtf/apparel/3d/stickers slugs matched nothing and rendered
                  four permanently-empty catalog pages. */}
              <li>
                <Link to="/catalog/dtf-transfers" className="text-sm text-muted hover:text-secondary transition-colors">
                  DTF Transfers
                </Link>
              </li>
              <li>
                <Link to="/catalog/shirts" className="text-sm text-muted hover:text-secondary transition-colors">
                  Custom Apparel
                </Link>
              </li>
              <li>
                <Link to="/blanks" className="text-sm text-muted hover:text-secondary transition-colors">
                  Blank Tees
                </Link>
              </li>
              <li>
                <Link to="/toys" className="text-sm text-muted hover:text-secondary transition-colors">
                  Toy Factory
                </Link>
              </li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <h4 className="font-semibold text-text mb-4">Company</h4>
            <ul className="space-y-2">
              <li>
                <Link to="/about" className="text-sm text-muted hover:text-secondary transition-colors">
                  About Us
                </Link>
              </li>
              <li>
                <Link to="/community" className="text-sm text-muted hover:text-secondary transition-colors">
                  Community
                </Link>
              </li>
              <li>
                <Link to="/referrals" className="text-sm text-muted hover:text-secondary transition-colors">
                  Referral Program
                </Link>
              </li>
              <li>
                <Link to="/contact" className="text-sm text-muted hover:text-secondary transition-colors">
                  Contact
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="font-semibold text-text mb-4">Legal</h4>
            <ul className="space-y-2">
              <li>
                <Link to="/privacy" className="text-sm text-muted hover:text-secondary transition-colors">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link to="/terms" className="text-sm text-muted hover:text-secondary transition-colors">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link to="/shipping" className="text-sm text-muted hover:text-secondary transition-colors">
                  Shipping Policy
                </Link>
              </li>
              <li>
                <Link to="/returns" className="text-sm text-muted hover:text-secondary transition-colors">
                  Returns
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="mt-12 pt-8 border-t border-muted/20 flex flex-col sm:flex-row justify-between items-center gap-4">
          <p className="text-sm text-muted">
            © {currentYear} Imagine This Printed. All rights reserved. <span className="mx-2 opacity-20">|</span> <span className="italic font-serif opacity-60 hover:opacity-100 transition-opacity cursor-default" title="I AM GOD, Ch. 3">Truth cannot be killed.</span>
          </p>

          {/* Bare twitter/instagram/facebook.com icons pointed at no account of ours; the Etsy shop is real. */}
          <a
            href={SHOP_FACTS.etsyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-muted hover:text-secondary transition-colors"
          >
            Find us on Etsy →
          </a>
        </div>
      </div>
    </footer>
  )
}

