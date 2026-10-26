// The address form a store uses twice: the buyer's ship-to in the cart (shipping is priced for it) and the seller's
// ship-from in her settings (her labels are bought from it). Autofill tokens let the browser fill it in one tap.
import type { ChangeEvent } from 'react'
import type { ShipAddress } from '../../lib/vendor-store'

const US_STATES: Array<[string, string]> = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'], ['CO', 'Colorado'],
  ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'],
  ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'],
  ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'],
  ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'],
  ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
  ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'],
  ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'],
  ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
]

export default function StoreAddressFields({ value, onChange, section, phoneLabel, wide = false, onBlur }: {
  value: ShipAddress
  onChange: (next: ShipAddress) => void
  /** The autofill section: 'shipping' for the buyer, 'section-shipfrom' for the seller. */
  section: string
  phoneLabel: string
  /** A roomier layout for a wide card (the cart drawer stays narrow on every screen). */
  wide?: boolean
  onBlur?: () => void
}) {
  const set = (key: keyof ShipAddress) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange({ ...value, [key]: e.target.value })
  const box = 'w-full rounded-xl border border-[var(--vs-line)] bg-white px-3 h-11 outline-none focus:border-[var(--vs-primary)]'
  const span = (narrow: string, roomy: string) => (wide ? `${narrow} ${roomy}` : narrow)
  return (
    <div className="grid grid-cols-6 gap-2" onBlur={onBlur}>
      <input className={`${box} ${span('col-span-6', 'md:col-span-3')}`} placeholder="Full name" aria-label="Full name" autoComplete={`${section} name`} value={value.name} onChange={set('name')} />
      {wide && <input className={`${box} col-span-6 md:col-span-3`} inputMode="tel" placeholder={phoneLabel} aria-label={phoneLabel} autoComplete={`${section} tel`} value={value.phone} onChange={set('phone')} />}
      <input className={`${box} ${span('col-span-6', 'md:col-span-4')}`} placeholder="Street address" aria-label="Street address" autoComplete={`${section} address-line1`} value={value.street1} onChange={set('street1')} />
      <input className={`${box} ${span('col-span-6', 'md:col-span-2')}`} placeholder="Apt or suite (optional)" aria-label="Apartment or suite" autoComplete={`${section} address-line2`} value={value.street2} onChange={set('street2')} />
      <input className={`${box} ${span('col-span-6', 'md:col-span-3')}`} placeholder="City" aria-label="City" autoComplete={`${section} address-level2`} value={value.city} onChange={set('city')} />
      <select className={`${box} ${span('col-span-3', 'md:col-span-1')} ${value.state ? '' : 'text-[var(--vs-muted)]'}`} aria-label="State" autoComplete={`${section} address-level1`} value={value.state} onChange={set('state')}>
        <option value="">State</option>
        {US_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
      </select>
      <input className={`${box} ${span('col-span-3', 'md:col-span-2')}`} inputMode="numeric" placeholder="ZIP code" aria-label="ZIP code" autoComplete={`${section} postal-code`} value={value.zip} onChange={set('zip')} />
      {!wide && <input className={`${box} col-span-6`} inputMode="tel" placeholder={phoneLabel} aria-label={phoneLabel} autoComplete={`${section} tel`} value={value.phone} onChange={set('phone')} />}
    </div>
  )
}
