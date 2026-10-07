import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Menu, Search, ShoppingCart, MessageCircle, X } from 'lucide-react'
import { useCart } from '../context/CartContext'
import { useSidebar } from '../context/SidebarContext'

/** Ask the chat widget to open (it listens for this; phones have no floating bubble). */
export const OPEN_CHAT_EVENT = 'itp-open-chat'

/**
 * The phone header (task 5e10e099): menu, logo, search, chat and the cart with
 * its count, in one solid bar that never sits on top of the page. It replaces
 * the floating menu button, the floating cart pill and the chat bubble on
 * screens under lg, where those used to cover buttons and text.
 */
export function MobileTopBar() {
  const { toggleMobile } = useSidebar()
  const { state } = useCart()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)

  const count = state.items.reduce((sum, item) => sum + item.quantity, 0)
  // The chat steps aside on the buying pages (3ed8aa2), so its button does too.
  const chatHere = !/^\/(product|cart|checkout)(\/|$)/.test(pathname)

  useEffect(() => setSearching(false), [pathname])
  useEffect(() => {
    if (searching) input.current?.focus()
  }, [searching])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    navigate(q ? `/catalog?q=${encodeURIComponent(q)}` : '/catalog')
    setSearching(false)
  }

  const iconBtn = 'w-11 h-11 flex items-center justify-center rounded-xl text-text hover:bg-border-subtle transition-colors'

  return (
    <header className="lg:hidden fixed top-0 inset-x-0 z-40 bg-card border-b border-border">
      <div className="h-16 px-1.5 flex items-center gap-0.5">
        <button onClick={toggleMobile} className={iconBtn} aria-label="Open menu">
          <Menu className="w-6 h-6" />
        </button>
        <Link to="/" className="flex items-center gap-1.5 min-w-0 flex-1" aria-label="Imagine This Printed home">
          <img src="/icons/itp-bulb.png" alt="" className="h-8 w-auto shrink-0" width={20} height={32} />
          <span className="font-display text-[15px] leading-tight text-text truncate">Imagine This Printed</span>
        </Link>
        <button onClick={() => setSearching((s) => !s)} className={iconBtn} aria-label={searching ? 'Close search' : 'Search the shop'}>
          {searching ? <X className="w-5 h-5" /> : <Search className="w-5 h-5" />}
        </button>
        {chatHere && (
          <button onClick={() => window.dispatchEvent(new CustomEvent(OPEN_CHAT_EVENT))} className={iconBtn} aria-label="Chat with us">
            <MessageCircle className="w-5 h-5" />
          </button>
        )}
        <Link to="/cart" className={`${iconBtn} relative`} aria-label={`Cart, ${count} item${count === 1 ? '' : 's'}`}>
          <ShoppingCart className="w-5 h-5" />
          {count > 0 && (
            <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center">
              {count}
            </span>
          )}
        </Link>
      </div>
      {searching && (
        <form onSubmit={submit} className="px-3 pb-3 flex gap-2">
          <input
            ref={input}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search shirts, toys, metal art..."
            className="flex-1 min-w-0 h-11 px-4 rounded-xl border border-border bg-bg text-text text-base focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button type="submit" className="h-11 px-4 rounded-xl bg-primary text-white font-semibold text-sm">
            Search
          </button>
        </form>
      )}
    </header>
  )
}
