import React, { createContext, useContext, useReducer } from 'react'
import type { ReactNode } from 'react'
import type { CartItem, Product } from '../types'

interface CartState {
  items: CartItem[]
  total: number
}

interface CartContextType {
  state: CartState
  addToCart: (product: Product, quantity?: number, selectedSize?: string, selectedColor?: string, customDesign?: string, designData?: CartItem['designData']) => void
  removeFromCart: (itemId: string) => void
  updateQuantity: (itemId: string, quantity: number) => void
  clearCart: () => void
}

const CartContext = createContext<CartContextType | undefined>(undefined)

type CartAction =
  | { type: 'ADD_TO_CART'; payload: { product: Product; quantity: number; selectedSize?: string; selectedColor?: string; customDesign?: string; designData?: CartItem['designData'] } }
  | { type: 'REMOVE_FROM_CART'; payload: string }
  | { type: 'UPDATE_QUANTITY'; payload: { itemId: string; quantity: number } }
  | { type: 'CLEAR_CART' }

const calculateTotal = (items: CartItem[]): number => {
  // Separate eligible and non-eligible items
  const eligibleItems = items.filter(item =>
    item.product.isThreeForTwentyFive || item.product.metadata?.isThreeForTwentyFive
  )
  const nonEligibleItems = items.filter(item =>
    !item.product.isThreeForTwentyFive && !item.product.metadata?.isThreeForTwentyFive
  )

  // Calculate total for non-eligible items
  const nonEligibleTotal = nonEligibleItems.reduce((sum, item) => sum + (item.product.price * item.quantity), 0)

  // Calculate total for eligible items
  const totalEligibleQty = eligibleItems.reduce((sum, item) => sum + item.quantity, 0)

  const numSetsOfThree = Math.floor(totalEligibleQty / 3)
  const remainder = totalEligibleQty % 3

  // 3 items for $25. Remainder items at $25 each (assuming eligible items are priced at $25)
  const eligibleTotal = (numSetsOfThree * 25) + (remainder * 25)

  return nonEligibleTotal + eligibleTotal
}

const cartReducer = (state: CartState, action: CartAction): CartState => {
  switch (action.type) {
    case 'ADD_TO_CART': {
      const { product, quantity, selectedSize, selectedColor, customDesign, designData } = action.payload
      const existingItem = state.items.find(item =>
        item.product.id === product.id &&
        item.customDesign === customDesign &&
        item.selectedSize === selectedSize &&
        item.selectedColor === selectedColor
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
          designData
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

  const addToCart = (product: Product, quantity = 1, selectedSize?: string, selectedColor?: string, customDesign?: string, designData?: CartItem['designData']) => {
    dispatch({ type: 'ADD_TO_CART', payload: { product, quantity, selectedSize, selectedColor, customDesign, designData } })
  }

  const removeFromCart = (itemId: string) => {
    dispatch({ type: 'REMOVE_FROM_CART', payload: itemId })
  }

  const updateQuantity = (itemId: string, quantity: number) => {
    dispatch({ type: 'UPDATE_QUANTITY', payload: { itemId, quantity } })
  }

  const clearCart = () => {
    dispatch({ type: 'CLEAR_CART' })
  }

  return (
    <CartContext.Provider value={{ state, addToCart, removeFromCart, updateQuantity, clearCart }}>
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
