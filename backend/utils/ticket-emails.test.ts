import { describe, it, expect } from 'vitest'
import { nameFromTicketDescription, ticketReplyEmail, ticketTopic, replierName } from './ticket-emails.js'

describe('nameFromTicketDescription', () => {
  it('reads the name the contact form wrote on the first line', () => {
    expect(nameFromTicketDescription('Name: Maria Lopez\n\nDo you print hoodies in navy?')).toBe('Maria Lopez')
  })

  it('ignores the placeholder, emails and a missing line', () => {
    expect(nameFromTicketDescription('Name: Not provided\n\nhi')).toBeNull()
    expect(nameFromTicketDescription('Name: maria@example.com\n\nhi')).toBeNull()
    expect(nameFromTicketDescription('Customer pressed Talk to a person')).toBeNull()
    expect(nameFromTicketDescription(null)).toBeNull()
  })

  it('never reads a Name: line out of the customer message', () => {
    expect(nameFromTicketDescription('Order question\n\nName: Bobby Tables')).toBeNull()
  })
})

describe('ticketReplyEmail', () => {
  const base = { ticketId: '61b69961-0000-4000-8000-000000000000', agentMessageHtml: 'Yes, we print navy hoodies.' }

  it('greets the typed name, not Friend, and names who wrote back about what', () => {
    const { subject, html } = ticketReplyEmail({ ...base, subject: 'Hoodies in navy?', agentName: 'Christina', customerName: 'Maria Lopez' })
    expect(subject).toBe('Christina wrote back: Hoodies in navy?')
    expect(html).toContain('Hi Maria Lopez, Christina wrote back')
    expect(html).toContain('About &ldquo;Hoodies in navy?&rdquo; &middot; Ref 61B69961')
    expect(html).not.toMatch(/Friend|New Reply From Support|Support Agent/)
    expect(html).toContain('Reply to Christina')
  })

  it('reads well with no typed name', () => {
    const { html } = ticketReplyEmail({ ...base, subject: 'Live chat: sizing help', agentName: 'Christina' })
    expect(html).toContain('>Christina wrote back<')
    expect(html).toContain('&ldquo;sizing help&rdquo;')
  })

  it('escapes what the customer typed', () => {
    const { html } = ticketReplyEmail({ ...base, subject: '<script>x</script>', customerName: 'Al <b>', agentName: 'Christina' })
    expect(html).not.toContain('<script>')
    expect(html).toContain('Hi Al &lt;b&gt;, Christina wrote back')
  })

  it('a reply from the generic admin seat is signed by the shop', () => {
    expect(replierName('Support Team')).toBe('Imagine This Printed')
    expect(replierName('')).toBe('Imagine This Printed')
    expect(replierName('Christina')).toBe('Christina')
  })

  it('drops the Live chat filing prefix from the topic', () => {
    expect(ticketTopic('Live chat: where is my order')).toBe('where is my order')
    expect(ticketTopic('')).toBe('your message')
  })
})
