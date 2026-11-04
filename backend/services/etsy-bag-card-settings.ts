// The Etsy shop promo code printed on the Etsy bag card (Watchtower task
// d9a98efc). Christina makes the code in Etsy Shop Manager and types it on
// /admin/etsy-bag-card; it lives in admin_settings so the card picks it up
// with no deploy. Served by GET/PUT /api/admin/coupons/etsy-bag/card.

import { ETSY_BAG_CARD, checkEtsyShopCoupon, readEtsyShopCoupon, type EtsyShopCoupon } from '../shared/etsy-bag.js'

type SettingsDb = { from: (table: string) => any }

export async function loadEtsyShopCoupon(db: SettingsDb): Promise<EtsyShopCoupon | null> {
  const { data, error } = await db
    .from('admin_settings')
    .select('value')
    .eq('key', ETSY_BAG_CARD.settingsKey)
    .maybeSingle()
  if (error) throw new Error(`Failed to load the Etsy bag card code: ${error.message}`)
  return readEtsyShopCoupon(data?.value)
}

export type SaveEtsyShopCouponResult = { ok: true; coupon: EtsyShopCoupon } | { ok: false; error: string }

export async function saveEtsyShopCoupon(
  db: SettingsDb,
  input: { code?: unknown; percentOff?: unknown },
  savedBy: string | null,
  now: Date = new Date()
): Promise<SaveEtsyShopCouponResult> {
  const checked = checkEtsyShopCoupon(input)
  if (!checked.ok) return checked
  const coupon: EtsyShopCoupon = { code: checked.code, percentOff: checked.percentOff, savedAt: now.toISOString(), savedBy }
  const { error } = await db
    .from('admin_settings')
    .upsert({ key: ETSY_BAG_CARD.settingsKey, value: coupon }, { onConflict: 'key' })
  if (error) throw new Error(`Failed to save the Etsy bag card code: ${error.message}`)
  return { ok: true, coupon }
}
