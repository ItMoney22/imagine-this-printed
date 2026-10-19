import React from 'react'

/**
 * A form field people never see and form-filling bots do. If it comes back
 * filled, the form pretends it worked and sends nothing.
 *
 * Moved off-screen rather than display:none: many bots skip fields that are
 * display:none but fill anything that is laid out. aria-hidden + tabIndex -1
 * keep it away from screen readers and keyboard users.
 *
 * 2026-10-07: every one of the 152 signups since 2026-09-23 was a bot driving
 * the real Signup form (random first/last names on scraped addresses), each one
 * making us send a confirmation email to a stranger.
 */
interface HoneypotFieldProps {
  value: string
  onChange: (value: string) => void
}

const HoneypotField: React.FC<HoneypotFieldProps> = ({ value, onChange }) => (
  <div
    aria-hidden="true"
    style={{ position: 'absolute', left: '-10000px', top: 'auto', width: 1, height: 1, overflow: 'hidden' }}
  >
    <label>
      Website
      <input
        type="text"
        name="website"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        data-testid="honeypot"
      />
    </label>
  </div>
)

export default HoneypotField
