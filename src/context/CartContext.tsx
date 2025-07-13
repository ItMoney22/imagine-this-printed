import React, { createContext, useContext, useReducer } from 'react'
import type { ReactNode } from 'react'
import type { CartItem, Product } from '../types'

interface CartState {
  items: CartItem[]
  total: number
}

interface CartContextType {
  state: CartState
  addToCart: (product: Product, quantity?: number, customDesign?: string) => void
  removeFromCart: (itemId: string) => void
  updateQuantity: (itemId: string, quantity: number) => void
  clearCart: () => void
}

const CartContext = createContext<CartContextType | undefined>(undefined)

type CartAction = 
  | { type: 'ADD_TO_CART'; payload: { product: Product; quantity: number; customDesign?: string } }
  | { type: 'REMOVE_FROM_CART'; payload: string }
  | { type: 'UPDATE_QUANTITY'; payload: { itemId: string; quantity: number } }
  | { type: 'CLEAR_CART' }

const cartReducer = (state: CartState, action: CartAction): CartState => {
  switch (action.type) {
    case 'ADD_TO_CART': {
      const { product, quantity, customDesign } = action.payload
      const existingItem = state.items.find(item => 
        item.product.id === product.id && item.customDesign === customDesign
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
          customDesign
        }
        newItems = [...state.items, newItem]
      }

      const newTotal = newItems.reduce((sum, item) => sum + (item.product.price * item.quantity), 0)
      return { items: newItems, total: newTotal }
    }

    case 'REMOVE_FROM_CART': {
      const newItems = state.items.filter(item => item.id !== action.payload)
      const newTotal = newItems.reduce((sum, item) => sum + (item.product.price * item.quantity), 0)
      return { items: newItems, total: newTotal }
    }

    case 'UPDATE_QUANTITY': {
      const { itemId, quantity } = action.payload
      const newItems = state.items.map(item =>
        item.id === itemId ? { ...item, quantity } : item
      ).filter(item => item.quantity > 0)
      
      const newTotal = newItems.reduce((sum, item) => sum + (item.product.price * item.quantity), 0)
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

  const addToCart = (product: Product, quantity = 1, customDesign?: string) => {
    dispatch({ type: 'ADD_TO_CART', payload: { product, quantity, customDesign } })
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