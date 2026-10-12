// CRM notes + tags (crm_notes / crm_tags, migration 20261012190000).
//
// A CRM tag is a staff label on a customer ("vip", "wholesale-lead"). It is
// NOT the customer's account role (admin / vendor / customer), which lives on
// user_profiles.role and is shown separately. Keep the two apart in state and
// on screen.
import type { ContactNote } from '../types'

// Matches the crm_tags_tag_shape CHECK in the migration.
export const CRM_TAG_MAX_LENGTH = 40

const NOTE_TYPES: ContactNote['type'][] = ['general', 'order', 'complaint', 'follow_up']

export interface CrmNoteRow {
  id: string
  customer_id: string
  content: string
  note_type: string
  created_by: string | null
  created_at: string
}

export interface CrmTagRow {
  customer_id: string
  tag: string
}

/** Trim, join words with dashes and cap at the DB limit. Null when nothing is left. */
export function normalizeCrmTag(raw: string): string | null {
  const tag = raw.trim().split(/\s+/).join('-').slice(0, CRM_TAG_MAX_LENGTH).replace(/-+$/, '')
  return tag ? tag : null
}

export function toContactNote(row: CrmNoteRow): ContactNote {
  const type = NOTE_TYPES.includes(row.note_type as ContactNote['type'])
    ? (row.note_type as ContactNote['type'])
    : 'general'
  return {
    id: row.id,
    content: row.content,
    createdBy: row.created_by ?? '',
    createdAt: row.created_at,
    type,
  }
}

/** Notes (newest first) and tags (sorted) keyed by customer id. */
export function groupCrmRows(
  notes: CrmNoteRow[] | null | undefined,
  tags: CrmTagRow[] | null | undefined,
): { notesByCustomer: Record<string, ContactNote[]>; tagsByCustomer: Record<string, string[]> } {
  const notesByCustomer: Record<string, ContactNote[]> = {}
  for (const row of notes ?? []) {
    ;(notesByCustomer[row.customer_id] ??= []).push(toContactNote(row))
  }
  for (const list of Object.values(notesByCustomer)) {
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  const tagsByCustomer: Record<string, string[]> = {}
  for (const row of tags ?? []) {
    ;(tagsByCustomer[row.customer_id] ??= []).push(row.tag)
  }
  for (const list of Object.values(tagsByCustomer)) list.sort()

  return { notesByCustomer, tagsByCustomer }
}
