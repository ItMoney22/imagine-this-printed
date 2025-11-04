import { useTheme } from './ThemeProvider'
import { ThemeToggle } from './ThemeToggle'
import { Link } from 'react-router-dom'

export function Header() {
  const { theme } = useTheme()

  // Use light logo in dark mode, dark logo in light mode for contrast
  const logo = theme === 'dark'
    ? import.meta.env.VITE_LOGO_LIGHT
    : import.meta.env.VITE_LOGO_DARK

  return (
    <header className="sticky top-0 z-40 glass border-b card-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center space-x-2">
            <img
              src={logo}
              alt="Imagine This Printed"
              className="h-9 w-auto drop-shadow-lg"
            />
          </Link>

          {/* Navigation */}
          <nav className="hidden md:flex items-center gap-8">
            <Link
              to="/products"
              className="text-sm font-medium text-text hover:text-secondary transition-colors relative group"
            >
              Products
              <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-secondary group-hover:w-full transition-all duration-300"></span>
            </Link>
            <Link
              to="/designer"
              className="text-sm font-medium text-text hover:text-secondary transition-colors relative group"
            >
              Design Studio
              <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-secondary group-hover:w-full transition-all duration-300"></span>
            </Link>
            <Link
              to="/community"
              className="text-sm font-medium text-text hover:text-secondary transition-colors relative group"
            >
              Community
              <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-secondary group-hover:w-full transition-all duration-300"></span>
            </Link>
            <Link
              to="/pricing"
              className="text-sm font-medium text-text hover:text-secondary transition-colors relative group"
            >
              Pricing
              <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-secondary group-hover:w-full transition-all duration-300"></span>
            </Link>
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <ThemeToggle />

            <Link
              to="/cart"
              className="relative p-3 rounded-xl border card-border bg-card/50 hover:bg-card transition-all"
              aria-label="Shopping cart"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="w-5 h-5 text-text"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
                />
              </svg>
              {/* Badge - can be made dynamic */}
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-accent text-white text-xs font-bold rounded-full flex items-center justify-center">
                0
              </span>
            </Link>

            <Link
              to="/login"
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-primary to-secondary text-white font-semibold hover:shadow-glow transition-all hover:scale-[1.02]"
            >
              Sign In
            </Link>
          </div>
        </div>
      </div>
    </header>
  )
}
