// @vitest-environment jsdom
// Jev mailbox triage badges (Watchtower 2a83afec / 98d10929). AdminEmail.tsx
// pulls in auth, toast, polling and a compose modal, so this exercises just
// the exported presentational pieces — same pattern as PhraseChips.test.tsx.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { TriageLabelChip, NeedsReplyBadge } from './AdminEmail'
import type { EmailTriage } from '../lib/email-api'

afterEach(cleanup)

const triage = (overrides: Partial<EmailTriage> = {}): EmailTriage => ({
  label: 'sales_lead',
  needs_reply: 'today',
  needs_review: false,
  ...overrides,
})

describe('TriageLabelChip', () => {
  it('renders the human-readable label', () => {
    render(<TriageLabelChip label="customer_issue" />)
    expect(screen.getByText('Customer issue')).toBeTruthy()
  })

  it('renders nothing when the label is null', () => {
    const { container } = render(<TriageLabelChip label={null} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('NeedsReplyBadge', () => {
  it('flags a message that needs a reply today', () => {
    render(<NeedsReplyBadge triage={triage({ needs_reply: 'today' })} />)
    expect(screen.getByText('Reply today')).toBeTruthy()
  })

  it('flags a message that can wait this week', () => {
    render(<NeedsReplyBadge triage={triage({ needs_reply: 'this_week' })} />)
    expect(screen.getByText('Reply this week')).toBeTruthy()
  })

  it('shows a review marker when Jev had no confident answer', () => {
    render(<NeedsReplyBadge triage={triage({ needs_reply: 'unsure' })} />)
    expect(screen.getByText('Needs review')).toBeTruthy()
  })

  it('renders nothing for a message that needs no reply', () => {
    const { container } = render(<NeedsReplyBadge triage={triage({ needs_reply: 'no' })} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when triage is absent (sent folder, or the lane is off)', () => {
    const { container } = render(<NeedsReplyBadge triage={undefined} />)
    expect(container.firstChild).toBeNull()
  })
})
