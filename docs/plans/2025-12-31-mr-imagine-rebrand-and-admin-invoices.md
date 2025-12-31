# Mr. Imagine Rebrand & Admin Invoices

**Date**: 2025-12-31
**Status**: Approved

## Overview

Two changes:
1. Replace site logo/favicon with new Mr. Imagine mascot image
2. Add branded invoice system for admin users

---

## Part 1: Logo & Favicon Rebrand

### New Logo
- Source: `Mr Imagine - LOGO.jpeg` (project root)
- Character: Purple fluffy Mr. Imagine wearing black shirt with "IMAGINE THIS PRINTED" and lightbulb
- Brand name remains: "Imagine This Printed"
- Mr. Imagine is the mascot

### File Changes

**New files to create:**
- `public/assets/branding/mr-imagine-logo.png` - main logo (from source)
- `public/favicon.ico` - favicon from Mr. Imagine head
- `public/favicon-16x16.png`
- `public/favicon-32x32.png`
- `public/apple-touch-icon.png`

**Files to modify:**
- `index.html` - update favicon references
- `src/components/Header.tsx` - update logo src
- `src/components/Footer.tsx` - update logo if present

### Implementation Notes
- Keep existing `itp-logo-*` files as backup
- Logo should work on both light and dark backgrounds
- Favicon crops Mr. Imagine's head/face for recognition at small sizes

---

## Part 2: Admin Branded Invoices

### Stripe Branding (Manual Setup)
Configure in Stripe Dashboard → Settings → Branding:
- Logo: Mr. Imagine logo
- Colors: Purple (#A855F7) primary
- Business name: "Imagine This Printed"

### Invoice Content
- **Header**: Mr. Imagine logo (via Stripe branding)
- **Footer**:
  - "Imagine This Printed"
  - https://imaginethisprinted.com
  - wecare@imaginethisprinted.com

### Admin UI

**Location**: Admin Dashboard → new "Invoices" tab

**Features**:
- Create invoice button → opens modal
- Invoice list with columns: Client, Amount, Status, Due Date, Actions
- Actions: Send (draft), View (external link), Void
- Status badges: Draft, Sent, Paid, Overdue, Void

**CreateInvoiceModal (simplified for admin)**:
- Client email (required)
- Client name (optional)
- Line items (description, amount, quantity)
- Memo/notes
- Due date (7/14/30/60 days)
- Send immediately checkbox

### Backend Changes

**`backend/routes/invoices.ts`**:
- Admin route: no founder_id, no earnings split
- 100% goes to business
- Stripe invoice metadata includes branding

**Endpoints**:
- `GET /api/admin/invoices` - list all invoices
- `POST /api/admin/invoices` - create invoice
- `POST /api/admin/invoices/:id/send` - send invoice
- `POST /api/admin/invoices/:id/void` - void invoice
- `GET /api/admin/invoices/stats` - invoice statistics

### Database
Reuse existing `founder_invoices` table, add `invoice_type` column:
- `founder` - founder invoice with 35% split
- `admin` - admin invoice, no split

---

## Files to Modify

### Logo/Favicon
1. `index.html`
2. `src/components/Header.tsx`
3. `src/components/Footer.tsx`

### Admin Invoices
1. `src/pages/AdminDashboard.tsx` - add Invoices tab
2. `src/components/CreateInvoiceModal.tsx` - adapt for admin
3. `backend/routes/invoices.ts` - add admin routes
4. `supabase/migrations/20251231_founder_invoices.sql` - add invoice_type column

---

## Acceptance Criteria

### Logo
- [ ] New Mr. Imagine logo displays in header/navbar
- [ ] Favicon shows Mr. Imagine head in browser tab
- [ ] Works on both light and dark theme

### Admin Invoices
- [ ] Admin can create invoices from dashboard
- [ ] Invoices sent via Stripe with branding
- [ ] Invoice footer shows: brand name, website, email
- [ ] Admin can view, send, and void invoices
- [ ] Invoice status updates when paid (webhook)
