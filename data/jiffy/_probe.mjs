import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const t = fs.readFileSync(path.join(os.tmpdir(), 'hanes054.html'), 'utf8')

console.log('=== Quantity @ 1044325 ===')
console.log(t.slice(1044100, 1045300))

console.log('\n=== unit-price first ===')
const u = t.indexOf('unit-price')
console.log(t.slice(u - 400, u + 900))