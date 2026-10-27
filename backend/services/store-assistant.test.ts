import { describe, it, expect } from 'vitest'
import { systemPrompt, type StoreFacts } from './store-assistant.js'
import { PERSONAS } from './voiceGenerator.js'

const facts: StoreFacts = {
  storeName: 'Crystal’s Shirts and More', ownerFirst: 'Crystal', status: 'draft', payoutsReady: false, feePercent: 10,
  instagram: null, items: [], orders: [],
}

describe('Rico, the store assistant', () => {
  it('is Rico Fernandez, speaks Spanglish and keeps David’s nickname to himself', () => {
    const p = systemPrompt(facts)
    expect(p).toContain('You are Rico Fernandez')
    expect(p).toMatch(/English and Spanish/)
    expect(p).toMatch(/Never call her Money/)
    expect(p).toMatch(/no swearing/)
  })
  it('only lists the memories handed to this turn', () => {
    const p = systemPrompt({ ...facts, memories: ['Her best customers are teachers.'] })
    expect(p).toContain('WHAT YOU REMEMBER ABOUT HER\n- Her best customers are teachers.')
    expect(systemPrompt(facts)).not.toContain('WHAT YOU REMEMBER')
  })
  it('speaks in his Gemini voice, Achird', () => {
    expect(PERSONAS['store-assistant'].voice).toBe('Achird')
    expect(PERSONAS['store-assistant'].style).toMatch(/Spanish/)
  })
})

describe('feature requests', () => {
  it('Rico is told to file them on the board, and only real ones are kept', async () => {
    const { featureRequest } = await import('./store-assistant.js')
    expect(systemPrompt(facts)).toMatch(/FEATURE REQUESTS/)
    expect(featureRequest({ title: 'Gift wrap option', details: 'Buyers can add gift wrap at checkout.' })).toEqual({ title: 'Gift wrap option', details: 'Buyers can add gift wrap at checkout.' })
    expect(featureRequest({ title: '', details: 'x' })).toBeNull()
    expect(featureRequest(undefined)).toBeNull()
  })
})
