// @vitest-environment jsdom
// "Needs Triage" surfacing for support tickets (Watchtower 2a83afec / 98d10929).
// support_tickets has no triage column — the only record of how a ticket was
// classified is the internal system message describeTicketTriage() writes at
// intake (backend/lib/jev-triage.ts). findJevTriageNote() parses that message
// (already loaded for the ticket detail panel) instead of adding a second
// request per ticket. Exercises the exported pure pieces, same pattern as
// PhraseChips.test.tsx / PrintPrepPanel.test.tsx.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { findJevTriageNote, JevTriageBadge } from './AdminSupport'

afterEach(cleanup)

function systemMsg(message: string) {
  return {
    id: 'm1',
    sender: { first_name: '', last_name: '', role: '' },
    sender_type: 'system' as const,
    content: message,
    created_at: new Date().toISOString(),
    is_internal: true,
  }
}

describe('findJevTriageNote', () => {
  it('parses a confident triage note', () => {
    const note = findJevTriageNote([
      systemMsg(
        '[Jev triage · mode on] category=refund_request (jev), priority=high (jev)\n' +
          'Jev: category refund_request @ 0.91, priority high @ 0.88; floor rules: none\n' +
          'Confident — no human triage needed.'
      ),
    ])
    expect(note).not.toBeNull()
    expect(note?.category).toBe('refund_request')
    expect(note?.priority).toBe('high')
    expect(note?.needsReview).toBe(false)
  })

  it('parses a needs-review note and the reason', () => {
    const note = findJevTriageNote([
      systemMsg(
        '[Jev triage · mode on] category=design_help (floor), priority=normal (floor)\n' +
          'Jev: category no answer, priority no answer; floor rules: none\n' +
          'NEEDS HUMAN TRIAGE (jev_unavailable) — nothing was auto-closed or dropped.'
      ),
    ])
    expect(note?.needsReview).toBe(true)
    expect(note?.reviewReason).toBe('jev_unavailable')
  })

  it('ignores customer-visible messages and returns null when there is no triage note', () => {
    const note = findJevTriageNote([
      {
        id: 'm2',
        sender: { first_name: 'Jane', last_name: 'Doe', role: 'user' },
        sender_type: 'user' as const,
        content: 'Where is my order?',
        created_at: new Date().toISOString(),
        is_internal: false,
      },
    ])
    expect(note).toBeNull()
  })

  it('returns null for a ticket with no messages at all (pre-Jev, or JEV_TRIAGE=off)', () => {
    expect(findJevTriageNote([])).toBeNull()
  })
})

describe('JevTriageBadge', () => {
  it('renders "Needs Triage" when the note flags for human review', () => {
    render(
      <JevTriageBadge
        note={{
          mode: 'on',
          category: 'wrong_or_damaged',
          categorySource: 'jev',
          priority: 'urgent',
          prioritySource: 'jev',
          needsReview: true,
          reviewReason: 'low_confidence',
        }}
      />
    )
    expect(screen.getByText('Needs Triage')).toBeTruthy()
  })

  it('renders "Triaged" when Jev was confident', () => {
    render(
      <JevTriageBadge
        note={{
          mode: 'on',
          category: 'order_status',
          categorySource: 'jev',
          priority: 'normal',
          prioritySource: 'jev',
          needsReview: false,
          reviewReason: null,
        }}
      />
    )
    expect(screen.getByText('Triaged')).toBeTruthy()
  })

  it('renders nothing when there is no triage note', () => {
    const { container } = render(<JevTriageBadge note={null} />)
    expect(container.firstChild).toBeNull()
  })
})
