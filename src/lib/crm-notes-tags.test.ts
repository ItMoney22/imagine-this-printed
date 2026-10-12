import { describe, it, expect } from 'vitest'
import { normalizeCrmTag, groupCrmRows, CRM_TAG_MAX_LENGTH } from './crm-notes-tags'

describe('normalizeCrmTag', () => {
  it('trims and joins words with dashes', () => {
    expect(normalizeCrmTag('  repeat   buyer ')).toBe('repeat-buyer')
  })

  it('rejects blank input', () => {
    expect(normalizeCrmTag('')).toBeNull()
    expect(normalizeCrmTag('   ')).toBeNull()
  })

  it('caps at the database limit without leaving a trailing dash', () => {
    const tag = normalizeCrmTag('a'.repeat(CRM_TAG_MAX_LENGTH - 1) + ' bcd')
    expect(tag).toBe('a'.repeat(CRM_TAG_MAX_LENGTH - 1))
    expect(normalizeCrmTag('x'.repeat(80))!.length).toBe(CRM_TAG_MAX_LENGTH)
  })
})

describe('groupCrmRows', () => {
  const notes = [
    { id: 'n2', customer_id: 'c1', content: 'second', note_type: 'follow_up', created_by: 'a1', created_at: '2026-10-12T10:00:00Z' },
    { id: 'n1', customer_id: 'c1', content: 'first', note_type: 'general', created_by: null, created_at: '2026-10-11T10:00:00Z' },
    { id: 'n3', customer_id: 'c2', content: 'other', note_type: 'bogus', created_by: 'a1', created_at: '2026-10-12T09:00:00Z' },
  ]
  const tags = [
    { customer_id: 'c1', tag: 'wholesale' },
    { customer_id: 'c1', tag: 'vip' },
    { customer_id: 'c2', tag: 'vip' },
  ]

  it('groups notes per customer, newest first, as ContactNote', () => {
    const { notesByCustomer } = groupCrmRows(notes, tags)
    expect(notesByCustomer.c1.map(n => n.id)).toEqual(['n2', 'n1'])
    expect(notesByCustomer.c1[0]).toEqual({
      id: 'n2', content: 'second', createdBy: 'a1', createdAt: '2026-10-12T10:00:00Z', type: 'follow_up',
    })
    expect(notesByCustomer.c1[1].createdBy).toBe('')
  })

  it('falls back to general for an unknown note type', () => {
    expect(groupCrmRows(notes, tags).notesByCustomer.c2[0].type).toBe('general')
  })

  it('groups tags per customer, sorted', () => {
    const { tagsByCustomer } = groupCrmRows(notes, tags)
    expect(tagsByCustomer.c1).toEqual(['vip', 'wholesale'])
    expect(tagsByCustomer.c2).toEqual(['vip'])
    expect(tagsByCustomer.c3).toBeUndefined()
  })

  it('handles empty input', () => {
    expect(groupCrmRows(null, undefined)).toEqual({ notesByCustomer: {}, tagsByCustomer: {} })
  })
})
