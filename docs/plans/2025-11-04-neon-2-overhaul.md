# Neon 2.0 Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild entire site with high-end neon dark/light themes, professional asset structure, and CSS variable-based design system.

**Architecture:** Centralized theme system using CSS variables + Tailwind extensions. ThemeProvider manages light/dark mode with localStorage persistence and system preference detection. All components use semantic color tokens (bg, card, text, primary, etc.) that swap based on theme class.

**Tech Stack:** React, TypeScript, Tailwind CSS, Vite, CSS Variables

---

## Task 1: Project Structure & Asset Organization

**Files:**
- Create: `public/assets/branding/.gitkeep`
- Create: `public/assets/bg/.gitkeep`
- Modify: Root directory (move existing files)
- Create: `.env` (if not exists)
- Modify: `.env`

**Step 1: Create public asset folders**

```bash
mkdir -p public/assets/branding
mkdir -p public/assets/bg
```

**Step 2: Move existing logo to branding folder**

```bash
# Move the dark neon logo from root to branding
mv itp-logo-dark.png public/assets/branding/itp-logo-dark.png
mv itp-logo-light.svg public/assets/branding/itp-logo-light.svg
```

Expected: Files moved successfully, no errors

**Step 3: Create circuit background SVG**

Create: `public/assets/bg/bg-circuit.svg`

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" fill="none">
  <defs>
    <pattern id="circuit" x="0" y="0" width="120" height="120" patternUnits="userSpaceOnUse">
      <!-- Horizontal lines -->
      <line x1="0" y1="20" x2="40" y2="20" stroke="currentColor" stroke-width="0.5" opacity="0.3"/>
      <line x1="60" y1="20" x2="120" y2="20" stroke="currentColor" stroke-width="0.5" opacity="0.3"/>
      <!-- Vertical lines -->
      <line x1="40" y1="0" x2="40" y2="20" stroke="currentColor" stroke-width="0.5" opacity="0.3"/>
      <line x1="40" y1="40" x2="40" y2="80" stroke="currentColor" stroke-width="0.5" opacity="0.3"/>
      <!-- Nodes -->
      <circle cx="40" cy="20" r="2" fill="currentColor" opacity="0.4"/>
      <circle cx="60" cy="20" r="1.5" fill="currentColor" opacity="0.3"/>
      <!-- More circuit elements -->
      <line x1="20" y1="60" x2="60" y2="60" stroke="currentColor" stroke-width="0.5" opacity="0.3"/>
      <line x1="60" y1="40" x2="60" y2="80" stroke="currentColor" stroke-width="0.5" opacity="0.3"/>
      <circle cx="60" cy="60" r="2" fill="currentColor" opacity="0.4"/>
      <rect x="58" y="18" width="4" height="4" fill="currentColor" opacity="0.3"/>
    </pattern>
  </defs>
  <rect width="1920" height="1080" fill="url(#circuit)"/>
</svg>
```

**Step 4: Add environment variables**

Update `.env`:

```env
# Branding Assets
VITE_LOGO_DARK=/assets/branding/itp-logo-dark.png
VITE_LOGO_LIGHT=/assets/branding/itp-logo-light.svg
```

**Step 5: Verify asset paths**

```bash
ls -la public/assets/branding/
ls -la public/assets/bg/
```

Expected: Should see both logos and bg-circuit.svg

**Step 6: Commit**

```bash
git add public/assets/ .env
git commit -m "feat: organize assets into public folder structure with env vars"
```

---

## Task 2: Design System - Tailwind Configuration

**Files:**
- Modify: `tailwind.config.js`

**Step 1: Backup existing config**

```bash
cp tailwind.config.js tailwind.config.js.backup
```

**Step 2: Update Tailwind config with theme extensions**

Replace `tailwind.config.js`:

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        card: "var(--card)",
        text: "var(--text)",
        muted: "var(--muted)",
        primary: "var(--primary)",
        secondary: "var(--secondary)",
        accent: "var(--accent)",
      },
      boxShadow: {
        glow: "0 0 24px rgba(179, 98, 255, 0.45)",
        glowSm: "0 0 12px rgba(0, 191, 255, 0.35)",
        glowLg: "0 0 36px rgba(179, 98, 255, 0.6)",
      },
      fontFamily: {
        display: ["Poppins", "ui-sans-serif", "system-ui", "sans-serif"],
        tech: ["Orbitron", "Poppins", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      animation: {
        'glow-pulse': 'glow-pulse 2s ease-in-out infinite',
      },
      keyframes: {
        'glow-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
      },
    },
  },
  plugins: [],
}
```

**Step 3: Verify config syntax**

```bash
node -e "require('./tailwind.config.js'); console.log('Config valid')"
```

Expected: "Config valid"

**Step 4: Commit**

```bash
git add tailwind.config.js
git commit -m "feat: extend Tailwind with CSS var colors and neon shadows"
```

---

## Task 3: CSS Theme Variables & Utilities

**Files:**
- Create: `src/styles/theme.css`
- Modify: `src/main.tsx`

**Step 1: Create theme CSS file**

Create: `src/styles/theme.css`

```css
/* ============================================
   CSS CUSTOM PROPERTIES - LIGHT & DARK THEMES
   ============================================ */

:root {
  /* Light Theme */
  --bg: #ffffff;
  --card: #f7f7fb;
  --text: #1b1b1f;
  --muted: #555555;
  --primary: #6A11CB;
  --secondary: #2575FC;
  --accent: #FF00FF;
}

:root.dark {
  /* Dark Theme */
  --bg: #0e0a1f;
  --card: #14122a;
  --text: #f3ecff;
  --muted: #a9a9c5;
  --primary: #b362ff;
  --secondary: #00bfff;
  --accent: #ff5cff;
}

/* ============================================
   UTILITY CLASSES
   ============================================ */

.neon-gradient {
  background: linear-gradient(135deg, var(--primary), var(--secondary));
}

.neon-gradient-light {
  background: linear-gradient(135deg, #eef3ff, #f7f7fb);
}

.text-glow {
  text-shadow: 0 0 18px color-mix(in oklab, var(--primary) 60%, transparent);
}

.btn-glow {
  box-shadow: 0 0 0 2px color-mix(in oklab, var(--secondary) 55%, transparent) inset;
  transition: all 0.3s ease;
}

.btn-glow:hover {
  box-shadow: 0 0 0 2px color-mix(in oklab, var(--secondary) 70%, transparent) inset,
              0 0 16px color-mix(in oklab, var(--secondary) 40%, transparent);
}

.card-border {
  border: 1px solid rgba(255, 255, 255, 0.1);
}

:root.dark .card-border {
  border: 1px solid rgba(255, 255, 255, 0.1);
}

:root:not(.dark) .card-border {
  border: 1px solid rgba(0, 0, 0, 0.08);
}

.glass {
  background: rgba(10, 8, 24, 0.55);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

:root:not(.dark) .glass {
  background: rgba(255, 255, 255, 0.7);
  border-color: rgba(0, 0, 0, 0.1);
}

/* ============================================
   TRANSITIONS
   ============================================ */

* {
  transition-property: background-color, border-color, color, fill, stroke;
  transition-duration: 200ms;
  transition-timing-function: ease-in-out;
}

button, a, input, textarea, select {
  transition-property: all;
}
```

**Step 2: Import theme CSS in main.tsx**

Find the imports section in `src/main.tsx` and add:

```typescript
import './styles/theme.css'
```

Place it BEFORE `import './index.css'` if that exists, or at the top of style imports.

**Step 3: Verify CSS is loaded**

```bash
npm run dev
```

Open browser DevTools, check Computed styles for `--bg` variable - should exist.

**Step 4: Commit**

```bash
git add src/styles/theme.css src/main.tsx
git commit -m "feat: add CSS variable theme system with light/dark modes"
```

---

## Task 4: Theme Provider & Toggle Component

**Files:**
- Create: `src/components/ThemeProvider.tsx`
- Create: `src/components/ThemeToggle.tsx`
- Modify: `src/App.tsx`

**Step 1: Create ThemeProvider**

Create: `src/components/ThemeProvider.tsx`

```typescript
import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

type Theme = 'light' | 'dark'

interface ThemeContextType {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    // Check localStorage first
    const stored = localStorage.getItem('theme') as Theme | null
    if (stored) return stored

    // Check system preference
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark'
    }

    return 'light'
  })

  useEffect(() => {
    const root = document.documentElement

    if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }

    localStorage.setItem('theme', theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light')
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider')
  }
  return context
}
```

**Step 2: Create ThemeToggle component**

Create: `src/components/ThemeToggle.tsx`

```typescript
import { useTheme } from './ThemeProvider'

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()

  return (
    <button
      onClick={toggleTheme}
      className="relative w-12 h-12 rounded-xl border card-border bg-card/50 hover:bg-card transition-all flex items-center justify-center group"
      aria-label="Toggle theme"
      title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
    >
      {theme === 'light' ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          className="w-5 h-5 text-text group-hover:text-secondary transition-colors"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z"
          />
        </svg>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          className="w-5 h-5 text-text group-hover:text-accent transition-colors"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"
          />
        </svg>
      )}
    </button>
  )
}
```

**Step 3: Wrap App with ThemeProvider**

Modify `src/App.tsx` or `src/main.tsx` (wherever the root component is):

Find the root render and wrap with ThemeProvider:

```typescript
import { ThemeProvider } from './components/ThemeProvider'

// In the render or component:
<ThemeProvider>
  {/* existing app content */}
</ThemeProvider>
```

**Step 4: Test theme switching**

```bash
npm run dev
```

1. Open browser
2. Check localStorage - should have 'theme' key
3. Toggle theme button - should switch light/dark
4. Refresh - theme should persist

**Step 5: Commit**

```bash
git add src/components/ThemeProvider.tsx src/components/ThemeToggle.tsx src/App.tsx
git commit -m "feat: add ThemeProvider with localStorage persistence and toggle"
```

---

## Task 5: Header Component Rebuild

**Files:**
- Create: `src/components/Header.tsx` (or modify if exists)
- Modify: `src/App.tsx` (or layout component)

**Step 1: Create new Header component**

Create: `src/components/Header.tsx`

```typescript
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
```

**Step 2: Add Header to layout**

Update the main layout file (App.tsx or similar):

```typescript
import { Header } from './components/Header'

function App() {
  return (
    <div className="min-h-screen bg-bg text-text">
      <Header />
      {/* rest of app */}
    </div>
  )
}
```

**Step 3: Verify header renders**

```bash
npm run dev
```

Check:
- Logo displays correctly (switches based on theme)
- Navigation links visible
- Theme toggle works
- Header is sticky on scroll
- Glass effect visible

**Step 4: Commit**

```bash
git add src/components/Header.tsx src/App.tsx
git commit -m "feat: rebuild header with glass effect and theme-aware logo"
```

---

## Task 6: Hero Section Component

**Files:**
- Create: `src/components/Hero.tsx`
- Modify: Home page component

**Step 1: Create Hero component**

Create: `src/components/Hero.tsx`

```typescript
import { Link } from 'react-router-dom'

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Gradient Background */}
      <div className="neon-gradient dark:neon-gradient light:neon-gradient-light">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-24 sm:py-32 lg:py-40">
          <div className="text-center relative z-10">
            {/* Main Heading */}
            <h1 className="font-display text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold text-white text-glow tracking-tight">
              Imagine This Printed
            </h1>

            {/* Subheading */}
            <p className="mt-6 max-w-2xl mx-auto text-base sm:text-lg md:text-xl text-white/90 font-medium">
              Transform your creative vision into reality with custom DTF transfers,
              premium apparel, and cutting-edge 3D printing solutions.
            </p>

            {/* CTA Buttons */}
            <div className="mt-10 flex flex-col sm:flex-row justify-center gap-4">
              <Link
                to="/products"
                className="group relative px-8 py-4 bg-white dark:bg-text text-bg rounded-2xl font-bold text-lg shadow-glowLg hover:scale-[1.02] transition-all duration-300"
              >
                <span className="relative z-10">Shop Products</span>
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-primary to-secondary opacity-0 group-hover:opacity-20 transition-opacity"></div>
              </Link>

              <Link
                to="/designer"
                className="px-8 py-4 border-2 border-white/30 dark:border-white/30 text-white rounded-2xl font-semibold text-lg hover:bg-white/10 dark:hover:bg-white/10 shadow-glowSm transition-all duration-300 backdrop-blur-sm"
              >
                Create Design
              </Link>
            </div>

            {/* Feature Pills */}
            <div className="mt-12 flex flex-wrap justify-center gap-3">
              <div className="px-4 py-2 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white text-sm font-medium">
                ⚡ Same-Day Printing
              </div>
              <div className="px-4 py-2 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white text-sm font-medium">
                🎨 Custom Designs
              </div>
              <div className="px-4 py-2 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white text-sm font-medium">
                🚀 Fast Shipping
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Circuit Pattern Overlay */}
      <img
        src="/assets/bg/bg-circuit.svg"
        alt=""
        aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover mix-blend-overlay opacity-20 pointer-events-none text-white dark:text-purple-300"
      />
    </section>
  )
}
```

**Step 2: Add Hero to home page**

Update home page (e.g., `src/pages/Home.tsx` or similar):

```typescript
import { Hero } from '../components/Hero'

export function Home() {
  return (
    <div>
      <Hero />
      {/* rest of home content */}
    </div>
  )
}
```

**Step 3: Verify hero section**

```bash
npm run dev
```

Check:
- Gradient displays correctly
- Text is readable and glows in dark mode
- Buttons have hover effects
- Circuit overlay visible
- Responsive on mobile

**Step 4: Commit**

```bash
git add src/components/Hero.tsx src/pages/Home.tsx
git commit -m "feat: add hero section with gradient and circuit overlay"
```

---

## Task 7: Product Card Component

**Files:**
- Create: `src/components/ProductCard.tsx`
- Create: `src/components/ProductGrid.tsx`

**Step 1: Create ProductCard component**

Create: `src/components/ProductCard.tsx`

```typescript
import { Link } from 'react-router-dom'

interface ProductCardProps {
  id: string
  name: string
  description: string
  price: number
  image: string
  category?: string
}

export function ProductCard({ id, name, description, price, image, category }: ProductCardProps) {
  return (
    <article className="group rounded-3xl bg-card card-border shadow-sm hover:shadow-glow transition-all duration-300 overflow-hidden will-change-transform hover:-translate-y-1">
      {/* Image */}
      <div className="relative aspect-[4/3] overflow-hidden bg-muted/10">
        <img
          src={image}
          alt={name}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        />
        {category && (
          <div className="absolute top-3 left-3 px-3 py-1 rounded-full bg-primary/90 backdrop-blur-sm text-white text-xs font-semibold uppercase tracking-wide">
            {category}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-5">
        <h3 className="font-display text-lg font-semibold text-text group-hover:text-primary transition-colors">
          {name}
        </h3>

        <p className="mt-2 text-sm text-muted line-clamp-2">
          {description}
        </p>

        {/* Footer */}
        <div className="mt-5 flex items-center justify-between">
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-secondary to-accent font-bold text-xl">
            ${price.toFixed(2)}
          </span>

          <Link
            to={`/products/${id}`}
            className="px-5 py-2.5 rounded-xl border-2 border-secondary/50 text-secondary hover:bg-secondary/10 font-medium text-sm transition-all duration-300 hover:border-secondary"
          >
            View Details
          </Link>
        </div>
      </div>
    </article>
  )
}
```

**Step 2: Create ProductGrid component**

Create: `src/components/ProductGrid.tsx`

```typescript
import { ProductCard } from './ProductCard'

interface Product {
  id: string
  name: string
  description: string
  price: number
  image: string
  category?: string
}

interface ProductGridProps {
  products: Product[]
  title?: string
}

export function ProductGrid({ products, title }: ProductGridProps) {
  return (
    <section className="py-16 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        {title && (
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-text mb-8 text-center">
            {title}
          </h2>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
          {products.map((product) => (
            <ProductCard key={product.id} {...product} />
          ))}
        </div>
      </div>
    </section>
  )
}
```

**Step 3: Add ProductGrid to home page**

Update home page with sample products:

```typescript
import { ProductGrid } from '../components/ProductGrid'

const featuredProducts = [
  {
    id: '1',
    name: 'Custom DTF Transfer',
    description: 'High-quality direct-to-film transfers for vibrant, long-lasting prints on any fabric.',
    price: 15.99,
    image: '/assets/products/dtf-sample.jpg',
    category: 'DTF'
  },
  // Add more sample products
]

export function Home() {
  return (
    <div>
      <Hero />
      <ProductGrid products={featuredProducts} title="Featured Products" />
    </div>
  )
}
```

**Step 4: Verify product cards**

```bash
npm run dev
```

Check:
- Cards display in grid
- Hover effects work (lift, glow, scale image)
- Price gradient displays correctly
- Responsive layout

**Step 5: Commit**

```bash
git add src/components/ProductCard.tsx src/components/ProductGrid.tsx src/pages/Home.tsx
git commit -m "feat: add ProductCard and ProductGrid with hover effects"
```

---

## Task 8: Footer Component

**Files:**
- Create: `src/components/Footer.tsx`
- Modify: Layout component

**Step 1: Create Footer component**

Create: `src/components/Footer.tsx`

```typescript
import { Link } from 'react-router-dom'

export function Footer() {
  const currentYear = new Date().getFullYear()

  return (
    <footer className="bg-card border-t card-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="col-span-1">
            <h3 className="font-display text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-secondary">
              Imagine This Printed
            </h3>
            <p className="mt-3 text-sm text-muted max-w-xs">
              Your one-stop shop for custom printing solutions, from DTF transfers to 3D prints.
            </p>
          </div>

          {/* Products */}
          <div>
            <h4 className="font-semibold text-text mb-4">Products</h4>
            <ul className="space-y-2">
              <li>
                <Link to="/products/dtf" className="text-sm text-muted hover:text-secondary transition-colors">
                  DTF Transfers
                </Link>
              </li>
              <li>
                <Link to="/products/apparel" className="text-sm text-muted hover:text-secondary transition-colors">
                  Custom Apparel
                </Link>
              </li>
              <li>
                <Link to="/products/3d" className="text-sm text-muted hover:text-secondary transition-colors">
                  3D Printing
                </Link>
              </li>
              <li>
                <Link to="/products/stickers" className="text-sm text-muted hover:text-secondary transition-colors">
                  Stickers & Decals
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
                <Link to="/blog" className="text-sm text-muted hover:text-secondary transition-colors">
                  Blog
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
            © {currentYear} Imagine This Printed. All rights reserved.
          </p>

          {/* Social Links */}
          <div className="flex gap-4">
            <a
              href="https://twitter.com"
              target="_blank"
              rel="noopener noreferrer"
              className="w-9 h-9 rounded-lg bg-card/50 hover:bg-primary/20 border card-border flex items-center justify-center text-muted hover:text-primary transition-all"
              aria-label="Twitter"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M23 3a10.9 10.9 0 01-3.14 1.53 4.48 4.48 0 00-7.86 3v1A10.66 10.66 0 013 4s-4 9 5 13a11.64 11.64 0 01-7 2c9 5 20 0 20-11.5a4.5 4.5 0 00-.08-.83A7.72 7.72 0 0023 3z" />
              </svg>
            </a>
            <a
              href="https://instagram.com"
              target="_blank"
              rel="noopener noreferrer"
              className="w-9 h-9 rounded-lg bg-card/50 hover:bg-accent/20 border card-border flex items-center justify-center text-muted hover:text-accent transition-all"
              aria-label="Instagram"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
              </svg>
            </a>
            <a
              href="https://facebook.com"
              target="_blank"
              rel="noopener noreferrer"
              className="w-9 h-9 rounded-lg bg-card/50 hover:bg-secondary/20 border card-border flex items-center justify-center text-muted hover:text-secondary transition-all"
              aria-label="Facebook"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </footer>
  )
}
```

**Step 2: Add Footer to layout**

Update main layout:

```typescript
import { Footer } from './components/Footer'

function App() {
  return (
    <div className="min-h-screen bg-bg text-text flex flex-col">
      <Header />
      <main className="flex-1">
        {/* page content */}
      </main>
      <Footer />
    </div>
  )
}
```

**Step 3: Verify footer**

```bash
npm run dev
```

Check:
- Footer displays at bottom
- Links styled correctly
- Social icons have hover effects
- Responsive layout

**Step 4: Commit**

```bash
git add src/components/Footer.tsx src/App.tsx
git commit -m "feat: add footer with links and social icons"
```

---

## Task 9: Apply Theme to Existing Pages

**Files:**
- Modify: All page components in `src/pages/`

**Step 1: Audit existing pages**

```bash
find src/pages -type f -name "*.tsx" -o -name "*.jsx"
```

List all page files that need updates.

**Step 2: Update Product Detail Page**

Find and update product detail page (e.g., `src/pages/ProductDetail.tsx`):

Replace hardcoded colors with theme tokens:
- `bg-white` → `bg-bg`
- `bg-gray-100` → `bg-card`
- `text-black` → `text-text`
- `text-gray-600` → `text-muted`
- Add `card-border` class to card elements
- Add `shadow-glow` to CTAs

**Step 3: Update Designer Page**

Update designer page to use theme:
- Tool panels: `bg-card card-border`
- Canvas area: `bg-bg`
- Buttons: Use gradient or `btn-glow` class

**Step 4: Update Cart Page**

Update cart page:
- Cart items: `bg-card card-border rounded-2xl`
- Total section: Add gradient background or glow
- Checkout button: `bg-gradient-to-r from-primary to-secondary shadow-glow`

**Step 5: Update Account/Profile Pages**

Update user pages:
- Profile cards: `bg-card card-border`
- Forms: Match new theme
- Buttons: Use theme classes

**Step 6: Verify all pages**

```bash
npm run dev
```

Navigate through all pages and verify:
- Colors switch correctly with theme toggle
- No hardcoded colors remain
- All components use theme tokens
- Consistent visual style

**Step 7: Commit**

```bash
git add src/pages/
git commit -m "feat: apply neon theme to all existing pages"
```

---

## Task 10: Add Google Fonts

**Files:**
- Modify: `index.html`

**Step 1: Add Google Fonts links**

Update `index.html` in the `<head>` section:

```html
<head>
  <!-- ... existing meta tags ... -->

  <!-- Google Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght:600;700&family=Poppins:wght@400;600;700;800&display=swap" rel="stylesheet">

  <!-- ... rest of head ... -->
</head>
```

**Step 2: Verify fonts load**

```bash
npm run dev
```

Open DevTools → Network → Filter by "font" → Should see Poppins and Orbitron loading

**Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add Poppins and Orbitron Google Fonts"
```

---

## Task 11: Quality Assurance & Testing

**Files:**
- N/A (testing only)

**Step 1: Visual regression testing**

Test on multiple devices/browsers:

1. Desktop (Chrome, Firefox, Safari)
   - Light theme
   - Dark theme
   - Theme toggle
   - All pages

2. Tablet (iPad)
   - Responsive layout
   - Touch interactions

3. Mobile (iPhone, Android)
   - Mobile menu (if applicable)
   - Buttons are tappable
   - Text readable

**Step 2: Accessibility check**

```bash
# If lighthouse CLI is available
npx lighthouse http://localhost:5173 --only-categories=accessibility
```

Check:
- Color contrast ratios pass WCAG AA
- Keyboard navigation works
- Screen reader labels present
- Focus indicators visible

**Step 3: Performance check**

```bash
npm run build
npm run preview
```

Check bundle size, lighthouse performance score.

**Step 4: Cross-browser testing checklist**

- [ ] Chrome - light/dark themes work
- [ ] Firefox - CSS vars supported
- [ ] Safari - backdrop-filter works
- [ ] Edge - no issues
- [ ] Mobile Safari - responsive
- [ ] Mobile Chrome - responsive

**Step 5: Create testing report**

Document any issues found in `docs/qa-report.md`

---

## Task 12: Create Feature Branch & Screenshots

**Files:**
- N/A (git operations)

**Step 1: Create feature branch**

```bash
git checkout -b feature/neon-2-themes
```

**Step 2: Push branch**

```bash
git push -u origin feature/neon-2-themes
```

**Step 3: Take screenshots**

Capture screenshots for PR:
1. Home page - dark mode
2. Home page - light mode
3. Product detail - dark
4. Product detail - light
5. Cart page - dark/light
6. Designer - dark/light

Save to `docs/screenshots/neon-2/`

**Step 4: Commit screenshots**

```bash
git add docs/screenshots/
git commit -m "docs: add screenshots for neon 2.0 theme PR"
git push
```

---

## Task 13: Create Pull Request

**Files:**
- N/A (GitHub operations)

**Step 1: Create PR description**

```markdown
# Neon 2.0 Theme Overhaul

## Summary
Complete redesign of Imagine This Printed with high-end neon aesthetic, featuring:
- 🎨 Dual light/dark themes with CSS variables
- ✨ Neon glow effects and gradients
- 🔄 Theme toggle with localStorage persistence
- 📱 Fully responsive across all devices
- ⚡ Optimized asset structure in /public

## Changes
- Reorganized assets into `/public/assets/branding` and `/public/assets/bg`
- Extended Tailwind with custom neon colors and shadows
- Created ThemeProvider with system preference detection
- Rebuilt Header with glass effect and theme-aware logo
- Added Hero section with gradient and circuit overlay
- Designed ProductCard with hover glow effects
- Updated Footer with social links
- Applied theme to all existing pages (PDP, Designer, Cart, Account)
- Added Google Fonts (Poppins, Orbitron)

## Screenshots
### Dark Theme
![Home Dark](docs/screenshots/neon-2/home-dark.png)
![PDP Dark](docs/screenshots/neon-2/pdp-dark.png)

### Light Theme
![Home Light](docs/screenshots/neon-2/home-light.png)
![PDP Light](docs/screenshots/neon-2/pdp-light.png)

## Testing
- ✅ Tested on Chrome, Firefox, Safari, Edge
- ✅ Mobile responsive (iOS/Android)
- ✅ Accessibility (WCAG AA contrast ratios)
- ✅ Theme persistence across sessions
- ✅ No console errors or warnings

## Deployment Notes
- Requires `npm install` (no new dependencies)
- Update `.env` with logo paths (already included)
- Ready for VPS deployment after approval
```

**Step 2: Create PR via GitHub CLI or web interface**

```bash
gh pr create --title "Neon 2.0 Theme Overhaul - Light/Dark Mode" --body "$(cat docs/pr-description.md)"
```

Or create manually on GitHub.

**Step 3: Request reviews**

Tag relevant team members for review.

---

## Task 14: Deployment Preparation

**Files:**
- Create: `docs/deployment-checklist.md`

**Step 1: Create deployment checklist**

Create: `docs/deployment-checklist.md`

```markdown
# Neon 2.0 Deployment Checklist

## Pre-Deployment
- [ ] All PR reviews approved
- [ ] All tests passing
- [ ] No console errors in production build
- [ ] Screenshots added to PR
- [ ] QA testing complete

## Environment Setup
- [ ] `.env` file updated on VPS with:
  ```
  VITE_LOGO_DARK=/assets/branding/itp-logo-dark.png
  VITE_LOGO_LIGHT=/assets/branding/itp-logo-light.svg
  ```
- [ ] Asset files uploaded to `/public/assets/`

## Deployment Steps
1. SSH into VPS
2. Navigate to project directory
3. Pull latest from `feature/neon-2-themes`
4. Run `npm install`
5. Run `npm run build`
6. Restart web server
7. Clear CDN cache (if applicable)

## Post-Deployment Verification
- [ ] Visit production URL
- [ ] Test theme toggle (light/dark)
- [ ] Verify all images load
- [ ] Check responsive layouts (mobile/tablet/desktop)
- [ ] Test navigation links
- [ ] Verify Google Fonts loading
- [ ] Check browser console for errors

## Rollback Plan
If issues occur:
1. Revert to previous branch: `git checkout main`
2. Rebuild: `npm run build`
3. Restart server
4. Investigate issues in staging
```

**Step 2: Run final build test**

```bash
npm run build
```

Expected: No errors, build completes successfully

**Step 3: Test production build locally**

```bash
npm run preview
```

Visit preview URL and do final smoke test.

**Step 4: Commit deployment docs**

```bash
git add docs/deployment-checklist.md
git commit -m "docs: add deployment checklist for neon 2.0"
git push
```

---

## Completion Criteria

✅ All tasks completed when:
- [ ] Asset structure organized in `/public/assets/`
- [ ] Theme system working with CSS variables
- [ ] Light/dark mode toggle functional
- [ ] All components use theme tokens
- [ ] Header, Hero, ProductCard, Footer implemented
- [ ] All existing pages updated with new theme
- [ ] Google Fonts loaded
- [ ] QA testing complete
- [ ] Feature branch created and pushed
- [ ] PR created with screenshots
- [ ] Deployment checklist ready

## Related Skills
- @superpowers:subagent-driven-development - For executing this plan task-by-task
- @superpowers:requesting-code-review - After implementation
- @superpowers:verification-before-completion - Before marking tasks done

---

**Total Estimated Time:** 6-8 hours
**Complexity:** Medium-High
**Dependencies:** React, TypeScript, Tailwind CSS, Vite
