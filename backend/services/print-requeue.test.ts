// The re-queue stamp (task 4ef9db82): when it counts as waiting, and how a print status clears it.
import { describe, it, expect } from 'vitest'
import { PRINT_REQUEUE_KEY, REQUEUE_CLEAR_STATUSES, REQUEUE_WINDOW_MS, clearPrintRequeue, isRequeuePending, requeueCutoff } from './print-requeue.js'

const NOW = new Date('2026-11-01T18:00:00.000Z')

describe('isRequeuePending', () => {
  it('is a stamp within the window', () => {
    expect(isRequeuePending({ [PRINT_REQUEUE_KEY]: '2026-11-01T17:59:00.000Z' }, NOW)).toBe(true)
    expect(isRequeuePending({ [PRINT_REQUEUE_KEY]: new Date(NOW.getTime() - REQUEUE_WINDOW_MS).toISOString() }, NOW)).toBe(true)
  })
  it('is not an old stamp, no stamp, or junk', () => {
    expect(isRequeuePending({ [PRINT_REQUEUE_KEY]: new Date(NOW.getTime() - REQUEUE_WINDOW_MS - 1).toISOString() }, NOW)).toBe(false)
    expect(isRequeuePending({}, NOW)).toBe(false)
    expect(isRequeuePending(null, NOW)).toBe(false)
    expect(isRequeuePending({ [PRINT_REQUEUE_KEY]: 'soon' }, NOW)).toBe(false)
    expect(isRequeuePending({ [PRINT_REQUEUE_KEY]: 12 }, NOW)).toBe(false)
  })
  it('compares the same way the queue filter does (ISO strings)', () => {
    expect(requeueCutoff(NOW)).toBe('2026-10-25T18:00:00.000Z')
  })
})

describe('clearPrintRequeue', () => {
  function fakeDb(rows: any[]) {
    const updates: Array<{ id: string; metadata: any }> = []
    const db = {
      from: () => {
        const b: any = {
          select: () => b,
          eq: async (col: string, val: any) => ({ data: rows.filter((r) => r[col] === val), error: null }),
          update: (patch: any) => ({ eq: async (_c: string, id: string) => { updates.push({ id, metadata: patch.metadata }); return { error: null } } }),
        }
        return b
      },
    }
    return { db, updates }
  }

  it("moves every stamped line of the order to print_requeue_cleared, and leaves the rest alone", async () => {
    const { db, updates } = fakeDb([
      { id: 'a', order_id: 'o1', metadata: { print_file_path: 'p/print-spec.json', [PRINT_REQUEUE_KEY]: '2026-11-01T17:00:00.000Z' } },
      { id: 'b', order_id: 'o1', metadata: { print_file_path: 'q.stl' } },
      { id: 'c', order_id: 'o2', metadata: { [PRINT_REQUEUE_KEY]: '2026-11-01T17:00:00.000Z' } },
    ])
    expect(await clearPrintRequeue(db, 'o1', 'printing', NOW)).toBe(1)
    expect(updates).toEqual([{
      id: 'a',
      metadata: {
        print_file_path: 'p/print-spec.json',
        print_requeue_cleared: { requeuedAt: '2026-11-01T17:00:00.000Z', clearedAt: '2026-11-01T18:00:00.000Z', status: 'printing' },
      },
    }])
  })

  it('throws on a read error (the bridge treats it as non-fatal)', async () => {
    const db = { from: () => ({ select: () => ({ eq: async () => ({ data: null, error: { message: 'down' } }) }) }) }
    await expect(clearPrintRequeue(db, 'o1', 'printing', NOW)).rejects.toThrow(/down/)
  })

  it('clears only once the order is on, or past, the printer', () => {
    expect([...REQUEUE_CLEAR_STATUSES].sort()).toEqual(['insert_pause', 'printing', 'ready_for_packing', 'shipped_soon'])
    for (const s of ['received', 'in_production', 'rejected', 'issue']) expect(REQUEUE_CLEAR_STATUSES.has(s)).toBe(false)
  })
})
