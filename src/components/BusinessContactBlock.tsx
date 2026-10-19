import { MapPin, Phone } from 'lucide-react'
import {
  BUSINESS_ADDRESS_LINE,
  BUSINESS_LEGAL_NAME,
  BUSINESS_PHONE
} from '../config/business-info'

export default function BusinessContactBlock() {
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3 text-muted">
        <MapPin className="w-5 h-5 text-purple-600 mt-0.5 shrink-0" />
        <span>
          <strong className="text-text">{BUSINESS_LEGAL_NAME}</strong>
          <br />
          {BUSINESS_ADDRESS_LINE}
        </span>
      </div>
      {BUSINESS_PHONE && (
        <div className="flex items-center gap-3 text-muted">
          <Phone className="w-5 h-5 text-purple-600 shrink-0" />
          <a href={`tel:${BUSINESS_PHONE.replace(/[^+\d]/g, '')}`} className="text-purple-600 hover:underline">
            {BUSINESS_PHONE}
          </a>
        </div>
      )}
    </div>
  )
}
