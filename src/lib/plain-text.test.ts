import { describe, expect, it } from 'vitest'
import { plainDescription } from './plain-text'

describe('plainDescription', () => {
  it('drops markdown marks a shopper should never see', () => {
    const md = '**The Design:** A lion mid-roar.\n\n**Sizing:** Unisex fit.\n- Soft cotton\n- Printed in GA\n## Care'
    expect(plainDescription(md)).toBe('The Design: A lion mid-roar.\n\nSizing: Unisex fit.\nSoft cotton\nPrinted in GA\nCare')
  })

  it('keeps ordinary text, apostrophes and asterisk-free words intact', () => {
    expect(plainDescription("It's a roar in fabric form. Perfect for 2-for-1 days.")).toBe("It's a roar in fabric form. Perfect for 2-for-1 days.")
  })

  it('unwraps a description stored inside quote marks', () => {
    expect(plainDescription('"Ever wanted to make a statement?"')).toBe('Ever wanted to make a statement?')
  })

  it('handles empty input', () => {
    expect(plainDescription(null)).toBe('')
  })
})
