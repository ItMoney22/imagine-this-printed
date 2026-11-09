import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, zipStore } from './zip-store'

describe('zipStore', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it('writes a zip that a real unzip tool reads back byte for byte', () => {
    const a = new Uint8Array([137, 80, 78, 71, 1, 2, 3])
    const b = new TextEncoder().encode('second sticker')
    const zip = zipStore([
      { name: 'sticker-1-cartoon.png', data: a },
      { name: 'sticker-2-kawaii.png', data: b },
    ])
    const dir = mkdtempSync(join(tmpdir(), 'zipstore-'))
    writeFileSync(join(dir, 'pack.zip'), zip)
    // A real reader, not our own: unzip where it exists, else Windows' bsdtar (GNU tar can't read zips).
    try {
      execFileSync('unzip', ['-o', '-q', 'pack.zip'], { cwd: dir, stdio: 'pipe' })
    } catch {
      execFileSync(process.platform === 'win32' ? 'C:\\Windows\\System32\\tar.exe' : 'bsdtar', ['-xf', 'pack.zip'], { cwd: dir })
    }
    expect([...readFileSync(join(dir, 'sticker-1-cartoon.png'))]).toEqual([...a])
    expect(readFileSync(join(dir, 'sticker-2-kawaii.png'), 'utf8')).toBe('second sticker')
  })
})
