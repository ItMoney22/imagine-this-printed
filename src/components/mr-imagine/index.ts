// Mr. Imagine - The ImagineThisPrinted Mascot System
// Export all Mr. Imagine components for easy importing

export { MrImagineAvatar, type MrImagineAvatarProps } from './MrImagineAvatar'
// MrImagineChatWidget (nested) was a 315-line dead duplicate of the active
// /src/components/MrImagineChatWidget.tsx. Removed in cycle #16 re-audit.
// Confirmed via grep: nothing imports it from this barrel.
export { MrImagineHero } from './MrImagineHero'
export { MrImagineMockup, type MrImagineMockupProps } from './MrImagineMockup'
export { MrImagineCartNotification } from './MrImagineCartNotification'
export {
  MR_IMAGINE_CONFIG,
  MR_IMAGINE_VOICE_ID,
  type MrImagineExpression,
  type MrImaginePose
} from './config'
