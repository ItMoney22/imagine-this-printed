import React, { createContext, useContext, useReducer, useState, useCallback, useEffect } from 'react'
import type { ReactNode } from 'react'
import type { CartItem, CartAddon, Product, AppliedCoupon } from '../types'
import { addonsUnitTotal, addonsSignature } from '../lib/product-kind'
import { garmentTierUpcharge } from '../lib/garment-tiers'

interface CartState {
  items: CartItem[]
  total: number
}

const API_BASE = import.meta.env.VITE_API_BASE || ''

// localStorage keys are versioned so a future schema change can ignore
// old persisted carts instead of crashing on mismatched shape. Bump the
// suffix when CartItem or AppliedCoupon get a breaking change.
const CART_STORAGE_KEY = 'itp_cart_v1'
const COUPON_STORAGE_KEY = 'itp_cart_coupon_v1'

// Module-level monotonic counter appended to every generated line-item id.
// A plain `${product.id}-${Date.now()}` collides when two distinct variants
// (different size/color/addons) are added within the same millisecond —
// rapid clicks or a programmatic bulk add (restoreFromOrder) both hit this.
// Both items then share an id, so removeFromCart/updateQuantity act on both
// instead of one. The counter never resets and is strictly increasing for
// the lifetime of the module, so it stays unique even under a pinned/fake
// clock. See task 6593e839.
let lineItemIdCounter = 0
const nextLineItemId = (prefix: string): string => {
  lineItemIdCounter += 1
  return `${prefix}-${Date.now()}-${lineItemIdCounter}`
}

function loadCartFromStorage(): CartState {
  if (typeof window === 'undefined') return { items: [], total: 0 }
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY)
    if (!raw) return { items: [], total: 0 }
    const parsed = JSON.parse(raw) as { items?: CartItem[] }
    const items = Array.isArray(parsed.items) ? parsed.items : []
    // Recompute total — pricing rules (3-for-$25 deal, plus-size upcharge)
    // can change between sessions, and we never want a stored total to
    // disagree with the current calculator.
    return { items, total: calculateTotal(items) }
  } catch {
    return { items: [], total: 0 }
  }
}

const isDataUrl = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('data:')

// Strip the fields that blow up localStorage before every persisted write.
// Full-size base64 data: URLs (product.images / designData.mockupUrl), the
// entire layer array, and the JSON-stringified canvas snapshot can put a
// single Imagination Sheet cart item well past 1MB; two or three of them
// blow past the ~5MB localStorage quota entirely (see task 428a05df). The
// in-memory redux state keeps the full item for the current session —
// only what actually reaches localStorage is trimmed. Real GCS URLs
// (http/https, e.g. designData.printReadyUrl) are cheap strings and pass
// through untouched.
function sanitizeItemForStorage(item: CartItem): CartItem {
  const images = item.product.images
  const sanitizedImages = images?.some(isDataUrl)
    ? images.filter(img => !isDataUrl(img))
    : images

  const sanitizedProduct = sanitizedImages === images
    ? item.product
    : { ...item.product, images: sanitizedImages as string[] }

  if (!item.designData) {
    return sanitizedProduct === item.product ? item : { ...item, product: sanitizedProduct }
  }

  const { elements: _elements, canvasSnapshot: _canvasSnapshot, mockupUrl, ...restDesignData } = item.designData
  return {
    ...item,
    product: sanitizedProduct,
    designData: {
      ...restDesignData,
      elements: [], // shape requires the field; contents never needed after add-to-cart
      mockupUrl: isDataUrl(mockupUrl) ? '' : mockupUrl
    }
  }
}

// Cross-browser QuotaExceededError detection. Chrome/Edge/Safari use
// name === 'QuotaExceededError' (code 22); old Firefox uses
// NS_ERROR_DOM_QUOTA_REACHED (code 1014).
function isQuotaExceededError(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === 'QuotaExceededError' ||
      err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      err.code === 22 ||
      err.code === 1014)
  )
}

function loadCouponFromStorage(): AppliedCoupon | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(COUPON_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as AppliedCoupon) : null
  } catch {
    return null
  }
}

interface CartContextType {
  state: CartState
  addToCart: (product: Product, quantity?: number, selectedSize?: string, selectedColor?: string, customDesign?: string, designData?: CartItem['designData'], paymentMethod?: 'usd' | 'itc', selectedAddons?: CartAddon[], printLocation?: CartItem['printLocation'], selectedTier?: string) => void
  removeFromCart: (itemId: string) => void
  updateQuantity: (itemId: string, quantity: number) => void
  clearCart: () => void
  restoreFromOrder: (orderItems: any[]) => void
  appliedCoupon: AppliedCoupon | null
  discount: number
  finalTotal: number
  applyCoupon: (code: string, userId?: string) => Promise<{ success: boolean; error?: string }>
  removeCoupon: () => void
  couponLoading: boolean
  // Set when the most recent localStorage write failed (quota, private-mode,
  // etc). The in-memory cart still works — this only means it may not
  // survive a refresh. Never silently swallowed; see the persist effect.
  persistError: string | null
  dismissPersistError: () => void
}

const CartContext = createContext<CartContextType | undefined>(undefined)

type CartAction =
  | { type: 'ADD_TO_CART'; payload: { product: Product; quantity: number; selectedSize?: string; selectedColor?: string; customDesign?: string; designData?: CartItem['designData']; paymentMethod?: 'usd' | 'itc'; selectedAddons?: CartAddon[]; printLocation?: CartItem['printLocation']; selectedTier?: string } }
  | { type: 'REMOVE_FROM_CART'; payload: string }
  | { type: 'UPDATE_QUANTITY'; payload: { itemId: string; quantity: number } }
  | { type: 'CLEAR_CART' }
  | { type: 'RESTORE_FROM_ORDER'; payload: CartItem[] }

// Sizes that incur an additional $2.50 upcharge
const PLUS_SIZES = ['2XL', '2X', 'XXL', '3XL', '3X', 'XXXL', '4XL', '4X', 'XXXXL', '5XL', '5X', 'XXXXXL']
const PLUS_SIZE_UPCHARGE = 2.50

// Check if a size is a plus size (2XL and above)
const isPlusSize = (size?: string): boolean => {
  if (!size) return false
  return PLUS_SIZES.some(ps => size.toUpperCase().includes(ps))
}

const calculateTotal = (items: CartItem[]): number => {
  // Separate eligible and non-eligible items
  const eligibleItems = items.filter(item =>
    item.product.isThreeForTwentyFive || item.product.metadata?.isThreeForTwentyFive
  )
  const nonEligibleItems = items.filter(item =>
    !item.product.isThreeForTwentyFive && !item.product.metadata?.isThreeForTwentyFive
  )

  // Calculate plus size upcharge for non-eligible items
  const nonEligiblePlusSizeUpcharge = nonEligibleItems.reduce((sum, item) => {
    if (isPlusSize(item.selectedSize)) {
      return sum + (PLUS_SIZE_UPCHARGE * item.quantity)
    }
    return sum
  }, 0)

  // Calculate total for non-eligible items (base price + plus size upcharge)
  const nonEligibleTotal = nonEligibleItems.reduce((sum, item) => sum + (item.product.price * item.quantity), 0) + nonEligiblePlusSizeUpcharge

  // Calculate total for eligible items (3 for $25 deal)
  const totalEligibleQty = eligibleItems.reduce((sum, item) => sum + item.quantity, 0)

  const numSetsOfThree = Math.floor(totalEligibleQty / 3)
  const remainder = totalEligibleQty % 3

  // 3 items for $25. Remainder items at $25 each (assuming eligible items are priced at $25)
  const eligibleTotal = (numSetsOfThree * 25) + (remainder * 25)

  // Add plus size upcharge to eligible items as well (even in the 3 for $25 deal)
  const eligiblePlusSizeUpcharge = eligibleItems.reduce((sum, item) => {
    if (isPlusSize(item.selectedSize)) {
      return sum + (PLUS_SIZE_UPCHARGE * item.quantity)
    }
    return sum
  }, 0)

  // Add-on upsells (e.g. metal-art easel stand / wall mount) are priced per
  // unit and apply to every item regardless of the 3-for-$25 deal.
  const addonsTotal = items.reduce((sum, item) => sum + addonsUnitTotal(item.selectedAddons) * item.quantity, 0)

  // Garment quality tier upcharge (Gildan classic vs Softstyle / Bella+Canvas /
  // Comfort Colors). Per unit; mirrors GARMENT_TIER_UPCHARGE_CENTS server-side.
  const tierTotal = items.reduce((sum, item) => sum + garmentTierUpcharge(item.selectedTier) * item.quantity, 0)

  return nonEligibleTotal + eligibleTotal + eligiblePlusSizeUpcharge + addonsTotal + tierTotal
}

const cartReducer = (state: CartState, action: CartAction): CartState => {
  switch (action.type) {
    case 'ADD_TO_CART': {
      const { product, quantity, selectedSize, selectedColor, customDesign, designData, paymentMethod, selectedAddons, printLocation, selectedTier } = action.payload
      const existingItem = state.items.find(item =>
        item.product.id === product.id &&
        item.customDesign === customDesign &&
        item.selectedSize === selectedSize &&
        item.selectedColor === selectedColor &&
        item.paymentMethod === paymentMethod &&
        item.printLocation === printLocation &&
        item.selectedTier === selectedTier &&
        addonsSignature(item.selectedAddons) === addonsSignature(selectedAddons)
      )

      let newItems: CartItem[]
      if (existingItem) {
        newItems = state.items.map(item =>
          item.id === existingItem.id
            ? { ...item, quantity: item.quantity + quantity }
            : item
        )
      } else {
        const newItem: CartItem = {
          id: nextLineItemId(product.id),
          product,
          quantity,
          selectedSize,
          selectedColor,
          printLocation,
          selectedTier,
          selectedAddons,
          customDesign,
          designData,
          paymentMethod
        }
        newItems = [...state.items, newItem]
      }

      const newTotal = calculateTotal(newItems)
      return { items: newItems, total: newTotal }
    }

    case 'REMOVE_FROM_CART': {
      const newItems = state.items.filter(item => item.id !== action.payload)
      const newTotal = calculateTotal(newItems)
      return { items: newItems, total: newTotal }
    }

    case 'UPDATE_QUANTITY': {
      const { itemId, quantity } = action.payload
      const newItems = state.items.map(item =>
        item.id === itemId ? { ...item, quantity } : item
      ).filter(item => item.quantity > 0)

      const newTotal = calculateTotal(newItems)
      return { items: newItems, total: newTotal }
    }

    case 'CLEAR_CART':
      return { items: [], total: 0 }

    case 'RESTORE_FROM_ORDER': {
      const restoredItems = action.payload
      const newTotal = calculateTotal(restoredItems)
      return { items: restoredItems, total: newTotal }
    }

    default:
      return state
  }
}

export const CartProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Lazy initializers so we read localStorage exactly once on mount, not
  // on every render. The third arg to useReducer + the initializer
  // function form of useState are the canonical patterns for this.
  const [state, dispatch] = useReducer(cartReducer, undefined, loadCartFromStorage)
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(loadCouponFromStorage)
  const [couponLoading, setCouponLoading] = useState(false)
  const [persistError, setPersistError] = useState<string | null>(null)

  // Persist cart on every change. Items are sanitized first (large base64
  // data and layer/canvas data stripped — see sanitizeItemForStorage) so a
  // handful of Imagination Sheets can't blow the ~5MB localStorage quota by
  // themselves. If the write still fails, surface it — a cart that silently
  // fails to save is how customers lose their work on refresh.
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const sanitizedItems = state.items.map(sanitizeItemForStorage)
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ items: sanitizedItems }))
      setPersistError(null)
    } catch (err) {
      console.error('[CartContext] Failed to persist cart to localStorage:', err)
      setPersistError(
        isQuotaExceededError(err)
          ? "Your cart couldn't be fully saved — there's too much design data to store locally. It'll keep working in this tab, but may not survive a refresh. Check out soon, or remove an item."
          : "Your cart couldn't be saved and may not survive a refresh. Check out soon to avoid losing it."
      )
    }
  }, [state])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      if (appliedCoupon) {
        window.localStorage.setItem(COUPON_STORAGE_KEY, JSON.stringify(appliedCoupon))
      } else {
        window.localStorage.removeItem(COUPON_STORAGE_KEY)
      }
    } catch {
      // ignore — see CART_STORAGE_KEY effect
    }
  }, [appliedCoupon])

  const addToCart = (product: Product, quantity = 1, selectedSize?: string, selectedColor?: string, customDesign?: string, designData?: CartItem['designData'], paymentMethod?: 'usd' | 'itc', selectedAddons?: CartAddon[], printLocation?: CartItem['printLocation'], selectedTier?: string) => {
    dispatch({ type: 'ADD_TO_CART', payload: { product, quantity, selectedSize, selectedColor, customDesign, designData, paymentMethod, selectedAddons, printLocation, selectedTier } })
  }

  const removeFromCart = (itemId: string) => {
    dispatch({ type: 'REMOVE_FROM_CART', payload: itemId })
  }

  const updateQuantity = (itemId: string, quantity: number) => {
    dispatch({ type: 'UPDATE_QUANTITY', payload: { itemId, quantity } })
  }

  const clearCart = () => {
    dispatch({ type: 'CLEAR_CART' })
    setAppliedCoupon(null)
  }

  // Restore cart from order metadata (for resuming draft orders)
  const restoreFromOrder = useCallback((orderItems: any[]) => {
    const cartItems: CartItem[] = orderItems.map((item: any, index: number) => ({
      id: nextLineItemId(`restored-${item.product?.id || item.id || index}`),
      product: item.product || {
        id: item.id || item.product_id || `unknown-${index}`,
        name: item.name || item.product_name || 'Unknown Product',
        description: item.description || '',
        price: item.price || item.product?.price || 0,
        images: item.product?.images || (item.imageUrl ? [item.imageUrl] : []) || (item.image_url ? [item.image_url] : []),
        category: item.product?.category || 'shirts',
        inStock: true,
        isThreeForTwentyFive: item.product?.isThreeForTwentyFive || false
      },
      quantity: item.quantity || 1,
      selectedSize: item.selectedSize || item.variations?.size,
      selectedColor: item.selectedColor || item.variations?.color,
      printLocation: item.printLocation || item.print_location || item.variations?.printLocation,
      selectedTier: item.selectedTier || item.tier || undefined,
      customDesign: item.customDesign,
      designData: item.designData,
      paymentMethod: item.paymentMethod || 'usd'
    }))

    dispatch({ type: 'RESTORE_FROM_ORDER', payload: cartItems })
  }, [])

  const applyCoupon = useCallback(async (code: string, userId?: string): Promise<{ success: boolean; error?: string }> => {
    setCouponLoading(true)
    try {
      const params = new URLSearchParams({
        code: code.toUpperCase(),
        orderTotal: state.total.toString()
      })
      if (userId) {
        params.append('userId', userId)
      }

      const response = await fetch(`${API_BASE}/api/coupons/validate?${params}`)
      const data = await response.json()

      if (!data.valid) {
        setCouponLoading(false)
        return { success: false, error: data.error || 'Invalid coupon code' }
      }

      setAppliedCoupon({
        code: data.coupon.code,
        type: data.coupon.type,
        value: data.coupon.value,
        discount: data.discount,
        couponId: data.coupon.id,
        freeShipping: data.freeShipping || false
      })
      setCouponLoading(false)
      return { success: true }
    } catch (error: any) {
      setCouponLoading(false)
      return { success: false, error: error.message || 'Failed to validate coupon' }
    }
  }, [state.total])

  const removeCoupon = useCallback(() => {
    setAppliedCoupon(null)
  }, [])

  const dismissPersistError = useCallback(() => {
    setPersistError(null)
  }, [])

  const discount = appliedCoupon?.discount || 0
  const finalTotal = Math.max(0, state.total - discount)

  return (
    <CartContext.Provider value={{
      state,
      addToCart,
      removeFromCart,
      updateQuantity,
      clearCart,
      restoreFromOrder,
      appliedCoupon,
      discount,
      finalTotal,
      applyCoupon,
      removeCoupon,
      couponLoading,
      persistError,
      dismissPersistError
    }}>
      {persistError && (
        <div
          role="alert"
          aria-live="assertive"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '10px 16px',
            background: '#dc2626',
            color: '#fff',
            fontSize: '14px'
          }}
        >
          <span>{persistError}</span>
          <button
            onClick={dismissPersistError}
            aria-label="Dismiss cart save warning"
            style={{ background: 'transparent', border: 'none', color: '#fff', fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
          >
            Dismiss
          </button>
        </div>
      )}
      {children}
    </CartContext.Provider>
  )
}

export const useCart = (): CartContextType => {
  const context = useContext(CartContext)
  if (!context) {
    throw new Error('useCart must be used within a CartProvider')
  }
  return context
}
