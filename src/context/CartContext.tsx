import React, { createContext, useContext, useReducer, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import type { CartItem, Product, AppliedCoupon } from '../types'

interface CartState {
  items: CartItem[]
  total: number
}

const API_BASE = import.meta.env.VITE_API_BASE || ''

interface CartContextType {
  state: CartState
  addToCart: (product: Product, quantity?: number, selectedSize?: string, selectedColor?: string, customDesign?: string, designData?: CartItem['designData'], paymentMethod?: 'usd' | 'itc') => void
  removeFromCart: (itemId: string) => void
  updateQuantity: (itemId: string, quantity: number) => void
  clearCart: () => void
  appliedCoupon: AppliedCoupon | null
  discount: number
  finalTotal: number
  applyCoupon: (code: string, userId?: string) => Promise<{ success: boolean; error?: string }>
  removeCoupon: () => void
  couponLoading: boolean
}

const CartContext = createContext<CartContextType | undefined>(undefined)

type CartAction =
  | { type: 'ADD_TO_CART'; payload: { product: Product; quantity: number; selectedSize?: string; selectedColor?: string; customDesign?: string; designData?: CartItem['designData']; paymentMethod?: 'usd' | 'itc' } }
  | { type: 'REMOVE_FROM_CART'; payload: string }
  | { type: 'UPDATE_QUANTITY'; payload: { itemId: string; quantity: number } }
  | { type: 'CLEAR_CART' }

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

  return nonEligibleTotal + eligibleTotal + eligiblePlusSizeUpcharge
}

const cartReducer = (state: CartState, action: CartAction): CartState => {
  switch (action.type) {
    case 'ADD_TO_CART': {
      const { product, quantity, selectedSize, selectedColor, customDesign, designData, paymentMethod } = action.payload
      const existingItem = state.items.find(item =>
        item.product.id === product.id &&
        item.customDesign === customDesign &&
        item.selectedSize === selectedSize &&
        item.selectedColor === selectedColor &&
        item.paymentMethod === paymentMethod
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
          id: `${product.id}-${Date.now()}`,
          product,
          quantity,
          selectedSize,
          selectedColor,
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

    default:
      return state
  }
}

export const CartProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(cartReducer, { items: [], total: 0 })
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(null)
  const [couponLoading, setCouponLoading] = useState(false)

  const addToCart = (product: Product, quantity = 1, selectedSize?: string, selectedColor?: string, customDesign?: string, designData?: CartItem['designData'], paymentMethod?: 'usd' | 'itc') => {
    dispatch({ type: 'ADD_TO_CART', payload: { product, quantity, selectedSize, selectedColor, customDesign, designData, paymentMethod } })
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

  const discount = appliedCoupon?.discount || 0
  const finalTotal = Math.max(0, state.total - discount)

  return (
    <CartContext.Provider value={{
      state,
      addToCart,
      removeFromCart,
      updateQuantity,
      clearCart,
      appliedCoupon,
      discount,
      finalTotal,
      applyCoupon,
      removeCoupon,
      couponLoading
    }}>
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
