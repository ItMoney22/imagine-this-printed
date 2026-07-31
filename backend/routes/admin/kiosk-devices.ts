// Admin kiosk device provisioning. Mounted at /api/admin/kiosks.
//
// Watchtower ITP Closeout campaign, 2026-07-28 (task 83eb5c5b) — answers
// "how are per-device secrets generated/distributed": an admin (or founder,
// matching the existing /admin/kiosks page's RoleRoute allowedRoles in
// src/App.tsx) generates one here per physical terminal. The raw secret is
// returned exactly once in the response body and is never retrievable
// again — only its SHA-256 hash is stored (supabase/migrations/
// 20260728_kiosk_device_sessions.sql). Distribution is out-of-band: build a
// one-time provisioning link (`/kiosk/:kioskId?provision=<secret>`), open
// it once on that terminal (typed in, or via a QR code shown once), and
// KioskAuthContext stores the secret into that browser's localStorage and
// strips it from the URL. Losing a terminal? Revoke its device row here —
// every other device for the same kiosk keeps working.
import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import { requireAuth, requireRole } from '../../middleware/supabaseAuth.js'
import { supabase } from '../../lib/supabase.js'
import { hashKioskToken } from '../../middleware/requireKioskSession.js'

const router = Router()

router.use(requireAuth)
router.use(requireRole(['admin', 'founder']))

// GET /api/admin/kiosks/:kioskId/devices — list devices (no secrets).
router.get('/:kioskId/devices', async (req: Request, res: Response) => {
  try {
    const { kioskId } = req.params
    const { data, error } = await supabase
      .from('kiosk_devices')
      .select('id, label, created_at, revoked_at, last_seen_at')
      .eq('kiosk_id', kioskId)
      .order('created_at', { ascending: false })

    if (error) {
      res.status(500).json({ error: 'Failed to list devices' })
      return
    }
    res.json(data || [])
  } catch (err: any) {
    console.error('[admin/kiosk-devices] list error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /api/admin/kiosks/:kioskId/devices — provision a new device secret.
router.post('/:kioskId/devices', async (req: Request, res: Response) => {
  try {
    const { kioskId } = req.params
    const { label } = req.body || {}

    const { data: kiosk } = await supabase.from('kiosks').select('id').eq('id', kioskId).maybeSingle()
    if (!kiosk) {
      res.status(404).json({ error: 'Kiosk not found' })
      return
    }

    const rawSecret = crypto.randomBytes(32).toString('hex')
    const secretHash = hashKioskToken(rawSecret)

    const { data: device, error } = await supabase
      .from('kiosk_devices')
      .insert({ kiosk_id: kioskId, label: typeof label === 'string' ? label.slice(0, 200) : null, secret_hash: secretHash })
      .select('id, label, created_at')
      .single()

    if (error || !device) {
      console.error('[admin/kiosk-devices] provision error:', error)
      res.status(500).json({ error: 'Failed to provision device' })
      return
    }

    res.json({
      deviceId: device.id,
      label: device.label,
      createdAt: device.created_at,
      // Shown exactly once. Copy it into the provisioning link now — it
      // cannot be recovered from the database afterward.
      deviceSecret: rawSecret,
      provisionUrl: `/kiosk/${kioskId}?provision=${rawSecret}`
    })
  } catch (err: any) {
    console.error('[admin/kiosk-devices] provision error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// DELETE /api/admin/kiosks/:kioskId/devices/:deviceId — revoke one device.
// Also revokes any live sessions it already minted, so a stolen terminal
// with an active session doesn't keep working until natural expiry.
router.delete('/:kioskId/devices/:deviceId', async (req: Request, res: Response) => {
  try {
    const { kioskId, deviceId } = req.params
    const now = new Date().toISOString()

    const { error: deviceError } = await supabase
      .from('kiosk_devices')
      .update({ revoked_at: now })
      .eq('id', deviceId)
      .eq('kiosk_id', kioskId)

    if (deviceError) {
      res.status(500).json({ error: 'Failed to revoke device' })
      return
    }

    await supabase
      .from('kiosk_sessions')
      .update({ revoked_at: now })
      .eq('device_id', deviceId)
      .is('revoked_at', null)

    res.json({ revoked: true })
  } catch (err: any) {
    console.error('[admin/kiosk-devices] revoke error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
