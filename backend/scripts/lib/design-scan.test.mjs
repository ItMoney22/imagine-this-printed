// Proves the two things the design-library importer is only allowed to get
// right once: it must see PNGs at every depth, and running it twice must not
// produce a second row for the same file.
//
// Plain .mjs (not .test.ts) on purpose — backend/tsconfig.json excludes
// scripts/ from the TypeScript build, so a .ts test in here would never be
// type-checked and would only look verified.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { walkPngs, importKeyFor, describePng, planImports, groupByCollection } from './design-scan.mjs'

let root

// A miniature of David's real bundle: a flat collection, a collection nested
// one level deeper (the 1,392-design blind spot), a double-nested one, two
// files sharing a basename across sibling folders (the collision case), plus
// non-PNG noise that must be ignored.
const FIXTURE = [
  'Gaming/controller.png',
  'Gaming/controller.ai',
  'Gaming/notes.txt',
  '8. Fishing/Fishing (50 Designs)/bass.png',
  '8. Fishing/Fishing (50 Designs)/pike.png',
  '8. Fishing/Fishing (50 Designs)/Fishing (50 Designs)/bass.png',
  'Dogs/Vol1/paws.PNG',
  'loose-at-the-root.png'
]

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'design-scan-'))
  for (const rel of FIXTURE) {
    const abs = path.join(root, ...rel.split('/'))
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, 'x')
  }
})

afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true })
})

describe('walkPngs', () => {
  it('finds PNGs at every depth and ignores everything else', () => {
    expect(walkPngs(root)).toEqual([
      '8. Fishing/Fishing (50 Designs)/Fishing (50 Designs)/bass.png',
      '8. Fishing/Fishing (50 Designs)/bass.png',
      '8. Fishing/Fishing (50 Designs)/pike.png',
      'Dogs/Vol1/paws.PNG',
      'Gaming/controller.png',
      'loose-at-the-root.png'
    ])
  })
})

describe('importKeyFor', () => {
  it('matches the legacy "<dir>/<design-id>" format at depth 1', () => {
    // The 2,369 rows already in the catalogue carry exactly this string. If it
    // changed, every one of them would re-import as a duplicate.
    expect(importKeyFor('Gaming/controller.png')).toBe('Gaming/controller')
  })

  it('keeps nested folders, so same-named siblings cannot collide', () => {
    const shallow = importKeyFor('8. Fishing/Fishing (50 Designs)/bass.png')
    const deep = importKeyFor('8. Fishing/Fishing (50 Designs)/Fishing (50 Designs)/bass.png')
    expect(shallow).not.toBe(deep)
  })

  it('is case-insensitive about the extension only', () => {
    expect(importKeyFor('Dogs/Vol1/paws.PNG')).toBe('Dogs/Vol1/paws')
  })
})

describe('describePng', () => {
  it('splits a nested path into collection / subfolders / design id', () => {
    expect(describePng('8. Fishing/Fishing (50 Designs)/Fishing (50 Designs)/bass.png')).toEqual({
      relPath: '8. Fishing/Fishing (50 Designs)/Fishing (50 Designs)/bass.png',
      collectionDir: '8. Fishing',
      subDirs: ['Fishing (50 Designs)', 'Fishing (50 Designs)'],
      designId: 'bass',
      importKey: '8. Fishing/Fishing (50 Designs)/Fishing (50 Designs)/bass'
    })
  })
})

describe('planImports', () => {
  it('plans every nested design and skips loose root-level PNGs', () => {
    const plan = planImports(root)
    expect(plan.map(d => d.importKey)).toEqual([
      '8. Fishing/Fishing (50 Designs)/Fishing (50 Designs)/bass',
      '8. Fishing/Fishing (50 Designs)/bass',
      '8. Fishing/Fishing (50 Designs)/pike',
      'Dogs/Vol1/paws',
      'Gaming/controller'
    ])
    expect(plan.every(d => fs.existsSync(d.fullPath))).toBe(true)
  })

  it('produces no duplicate import keys', () => {
    const keys = planImports(root).map(d => d.importKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('honours --dir and --limit per collection', () => {
    expect(planImports(root, new Set(), { dirFilter: 'fishing' })).toHaveLength(3)
    expect(planImports(root, new Set(), { dirFilter: 'fishing', limit: 2 })).toHaveLength(2)
  })

  it('groups by collection for per-folder logging', () => {
    expect([...groupByCollection(planImports(root)).keys()]).toEqual(['8. Fishing', 'Dogs', 'Gaming'])
  })
})

describe('idempotency — the whole point', () => {
  // Stands in for the products table: importDesign() inserts a row and adds
  // the key to the in-memory set exactly like this.
  const runImport = (existingKeys, rows) => {
    for (const design of planImports(root, existingKeys)) {
      rows.push({ import_key: design.importKey })
      existingKeys.add(design.importKey)
    }
    return rows
  }

  it('a second run against the same folder inserts nothing', () => {
    const rows = []
    runImport(new Set(), rows)
    const afterFirst = rows.length
    expect(afterFirst).toBe(5)

    // Second run reloads the keys from "the database" — the same thing
    // loadExisting() does — and must plan zero work.
    const reloaded = new Set(rows.map(r => r.import_key))
    expect(planImports(root, reloaded)).toHaveLength(0)

    runImport(reloaded, rows)
    expect(rows).toHaveLength(afterFirst)
    expect(new Set(rows.map(r => r.import_key)).size).toBe(rows.length)
  })

  it('rows imported by the OLD one-level importer are not re-imported', () => {
    // Legacy keys were "<collection>/<design-id>" with no subfolders — the
    // depth-1 designs. Those must be recognised; only the nested ones are new.
    const legacy = new Set(['Gaming/controller'])
    expect(planImports(root, legacy).map(d => d.importKey)).not.toContain('Gaming/controller')
    expect(planImports(root, legacy)).toHaveLength(4)
  })

  it('picks up designs added to a nested folder after the first run', () => {
    const existing = new Set(planImports(root).map(d => d.importKey))
    const added = path.join(root, '8. Fishing', 'Fishing (50 Designs)', 'trout.png')
    fs.writeFileSync(added, 'x')
    try {
      const plan = planImports(root, existing)
      expect(plan.map(d => d.importKey)).toEqual(['8. Fishing/Fishing (50 Designs)/trout'])
    } finally {
      fs.rmSync(added, { force: true })
    }
  })
})
