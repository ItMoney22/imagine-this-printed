// Which of her remembered facts Rico brings into a turn (David 2026-10-26: "the thing that picks memory out, so he can
// quickly find what she's talking about, just like we do in our system. But her memory stuff is separate"). Her facts live in
// vendor_store_assistant_memory, never in the fleet's agent_memory. The fleet's recall ranks by what the turn is about and
// caps what it hands back; this does the same for one store with no extra model call: word overlap with what she is
// saying now (rarer words count more, English and Spanish), a small lean to newer facts, and the last few facts always,
// so "that thing I told you" still has something to hang on. Word overlap cannot cross languages ("maestras" vs "teachers"),
// and she speaks both, so while she has `everythingUnder` facts or fewer all of them ride along (about a thousand tokens);
// the ranking only matters once the shelf is long.

export type MemoryFact = { fact: string; created_at: string }

const STOP = new Set((
  'the a an and or but if of to in on at for with from by as is are was were be been it its this that these those i me my we our you your he she they them ' +
  'do does did have has had not no yes so just can could would should will about what when where who how why which there here also very really more some any ' +
  'el la los las un una unos unas y o pero si de del al en con por para como es son era fue ser mi mis tu tus su sus lo le les se que cuando donde quien ' +
  'cual ese esa eso esto este esta estos estas muy mas tambien yo tu el ella nosotros ellos ya hay tiene tengo quiero'
).split(' '))

/** Lower case, accents dropped, split on non-letters, small words and a trailing plural s/es removed. */
export function memoryTokens(text: string): string[] {
  return (text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().match(/[a-z0-9ñ]+/g) || [])
    .filter(w => w.length >= 3 && !STOP.has(w))
    .map(w => (w.length > 4 && w.endsWith('es') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))
}

export function pickMemories(
  facts: MemoryFact[],
  about: string,
  opts: { max?: number; alwaysNewest?: number; maxChars?: number; everythingUnder?: number; now?: number } = {}
): string[] {
  const { max = 8, alwaysNewest = 3, maxChars = 1500, everythingUnder = 40, now = Date.now() } = opts
  if (!facts.length) return []
  const rows = facts
    .map(f => ({ fact: f.fact, at: Date.parse(f.created_at) || 0, words: new Set(memoryTokens(f.fact)) }))
    .sort((a, b) => b.at - a.at)
  const df = new Map<string, number>()
  for (const r of rows) for (const w of r.words) df.set(w, (df.get(w) || 0) + 1)
  const asked = new Set(memoryTokens(about))
  const scored = rows.map((r, i) => {
    let overlap = 0
    for (const w of asked) if (r.words.has(w)) overlap += Math.log(1 + rows.length / (1 + (df.get(w) || 0)))
    const ageDays = Math.max(0, (now - r.at) / 86_400_000)
    return { ...r, i, overlap, score: overlap + 0.5 * Math.exp(-ageDays / 60) }
  })
  const chosen = new Set<number>()
  if (rows.length <= everythingUnder) {
    for (const s of scored) chosen.add(s.i)
  } else {
    for (const s of scored.slice(0, alwaysNewest)) chosen.add(s.i)
    for (const s of [...scored].filter(s => s.overlap > 0).sort((a, b) => b.score - a.score)) {
      if (chosen.size >= max) break
      chosen.add(s.i)
    }
  }
  const out: string[] = []
  let used = 0
  for (const s of scored.filter(s => chosen.has(s.i))) {
    if (used + s.fact.length > maxChars) continue
    if (out.some(o => o.toLowerCase() === s.fact.toLowerCase())) continue
    out.push(s.fact)
    used += s.fact.length
  }
  return out
}
