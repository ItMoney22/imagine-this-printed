// @vitest-environment jsdom
// Etsy buyer-note triage badge on the order/print queue (Watchtower 2a83afec /
// 98d10929). OrderManagement.tsx pulls in routing, auth and a dozen modals, so
// this exercises just the exported presentational piece — same pattern as
// PhraseChips.test.tsx / PrintPrepPanel.test.tsx.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { BuyerMessageFlagBadge } from './OrderManagement'

afterEach(cleanup)

describe('BuyerMessageFlagBadge', () => {
  it('flags a personalization note', () => {
    render(<BuyerMessageFlagBadge metadata={{ buyer_message_flag: { flag: 'personalization' } }} />)
    expect(screen.getByText('Personalization in note')).toBeTruthy()
  })

  it('flags a change request', () => {
    render(<BuyerMessageFlagBadge metadata={{ buyer_message_flag: { flag: 'change_request' } }} />)
    expect(screen.getByText('Buyer requested a change')).toBeTruthy()
  })

  it('flags a problem', () => {
    render(<BuyerMessageFlagBadge metadata={{ buyer_message_flag: { flag: 'problem' } }} />)
    expect(screen.getByText('Buyer flagged a problem')).toBeTruthy()
  })

  it('renders nothing when the flag is "none"', () => {
    const { container } = render(<BuyerMessageFlagBadge metadata={{ buyer_message_flag: { flag: 'none' } }} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when there is no buyer_message_flag at all (a non-Etsy order)', () => {
    const { container } = render(<BuyerMessageFlagBadge metadata={{ items: [] }} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when metadata itself is missing', () => {
    const { container } = render(<BuyerMessageFlagBadge metadata={null} />)
    expect(container.firstChild).toBeNull()
  })
})
