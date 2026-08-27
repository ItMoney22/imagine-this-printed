import fs from 'fs'
import path from 'path'
import fetch from 'node-fetch'

const ARTIFACTS_DIR = 'C:/Users/David/.gemini/antigravity-cli/brain/c9371447-34fc-44ff-affd-1aa74fd284fd'
const IMG_DIR = path.join(ARTIFACTS_DIR, 'reproduction_images')

if (!fs.existsSync(IMG_DIR)) {
  fs.mkdirSync(IMG_DIR, { recursive: true })
}

const imagesToDownload = [
  // Run 1 (Black Flat Lay)
  { name: 'run_1_step_a.jpg', url: 'https://replicate.delivery/xezq/JDAXt3dsf904dio5UIByNCYC6GRkiDeguZFJTijXCLDLwBEXA/tmpskjq0e50.jpg' },
  { name: 'run_1_step_b.png', url: 'https://replicate.delivery/xezq/cqobasnRoZpvMtfafPfaFUmec9ucUImTeAbjo1J2eRuKEcAxF/tmpp8zle4u9.png' },
  // Run 2 (Black Flat Lay)
  { name: 'run_2_step_a.jpg', url: 'https://replicate.delivery/xezq/vbXnDfDTDORjPSTGmEMtnYKfiRmieKWhwUQeIBTt9bRRBHQcB/tmpqoh1tzd8.jpg' },
  { name: 'run_2_step_b.png', url: 'https://replicate.delivery/xezq/AJjsgS1SKGoOGB7cYqx8gR4UfaU7TWwJ6v7CrblDtr9M4AiLA/tmpg797e9q5.png' },
  // Run 3 (Black Ghost Mannequin)
  { name: 'run_3_step_a.jpg', url: 'https://replicate.delivery/xezq/LC3U4yADidJXPtZQQc0X3GcfDSluNkyfxeMG62G2IGx4gDIuA/tmpyeu4gv4y.jpg' },
  { name: 'run_3_step_b.png', url: 'https://replicate.delivery/xezq/pJ8wSIhGWy7hP5C94gIHXuAuquM1r9ignfwH0Dk1GNsQ4AiLA/tmpeuzhpbks.png' },
  // Run 4 (Black Ghost Mannequin)
  { name: 'run_4_step_a.jpg', url: 'https://replicate.delivery/xezq/lQc4Hvp3xzawKxVgQsnlMVenUmxD0fLj2fpYQfMmbeCjEOg4C/tmpoej0601j.jpg' },
  { name: 'run_4_step_b.png', url: 'https://replicate.delivery/xezq/XHRkqfYHt5RUHyRe81eAB7FFsAhCWEb8e4MmN7eIyjKIFOg4C/tmpym30cw_7.png' },
  // Run 5 (White Flat Lay)
  { name: 'run_5_step_a.jpg', url: 'https://replicate.delivery/xezq/kM74FT5OqJLWE9ofYiHQvu3cqU77A8n8rT8BwY2EKopW4AiLA/tmpmguc4cny.jpg' },
  { name: 'run_5_step_b.png', url: 'https://replicate.delivery/xezq/YO8F4ecXl9wwBS8ZNLZe2rYVzsx8KTReWhLduOILrdolhDIuA/tmpka2lhj78.png' },
  // Run 6 (White Flat Lay)
  { name: 'run_6_step_a.jpg', url: 'https://replicate.delivery/xezq/jIJDd1hMrC4PMBjoRh9Cw9LLulECKIi0y1w8x3LZFMjNcAxF/tmpcty7l0y7.jpg' },
  { name: 'run_6_step_b.png', url: 'https://replicate.delivery/xezq/ZHDSgFSC9QYGDx67ezOO2YMmVPqDuIbcWTPPI2i0Luod4AiLA/tmpaj7px_b7.png' },
  // Run 7 (White Ghost Mannequin)
  { name: 'run_7_step_a.jpg', url: 'https://replicate.delivery/xezq/sZ7IjJUYe1znGyNIVozon4s2NHLao3aXp2OtbIfV8PYfhDIuA/tmp75546jx3.jpg' },
  { name: 'run_7_step_b.png', url: 'https://replicate.delivery/xezq/LylB7AshXuqtM1ffawesikP32i5y3Szefa5nRV2jKHacIOg4C/tmpjs94jcn6.png' },
  // Run 8 (White Ghost Mannequin)
  { name: 'run_8_step_a.jpg', url: 'https://replicate.delivery/xezq/8HZIazemomV4G63ib2eNe3ScsZEPPRzmIAy7Lkpp9a4OiDIuA/tmp96frfbw_.jpg' },
  { name: 'run_8_step_b.png', url: 'https://replicate.delivery/xezq/Oba7vpdFrsbbPF0cqjeCja5Am4TZgNTl8Blqd8EAOeFMxBEXA/tmpbcrp5m66.png' },
  // Run 9 (Gray Flat Lay)
  { name: 'run_9_step_a.jpg', url: 'https://replicate.delivery/xezq/RQSCCJlVmQomNRQTk3wyAG4NmReuEgFt1BLb0OZo0A0n4AiLA/tmpk4_vt685.jpg' },
  { name: 'run_9_step_b.png', url: 'https://replicate.delivery/xezq/P5sUByPRPi7TAlqsHfJXSwwImOBtUUauQVvW2mC90eZUxBEXA/tmphpg6s68e.png' },
  // Run 10 (Gray Flat Lay)
  { name: 'run_10_step_a.jpg', url: 'https://replicate.delivery/xezq/eCteXeNcclFXRIfg3oxKQeY7izfbeHi3vntvpVfy4HOjXxBEXA/tmp8ab8392a.jpg' },
  { name: 'run_10_step_b.png', url: 'https://replicate.delivery/xezq/2jVM5vQqN25vL5MEBcduACG60pj5yHIj4cW0MK1KNWIXcAxF/tmprymfokws.png' },
  // Run 11 (Gray Ghost Mannequin)
  { name: 'run_11_step_a.jpg', url: 'https://replicate.delivery/xezq/txJFMfXnnZXcKSsHxoTYRsRMMT7iSfhQVbRw1BCZLgogxBEXA/tmplhpaf7iq.jpg' },
  { name: 'run_11_step_b.png', url: 'https://replicate.delivery/xezq/ZQ4LXLU26eUgPygTq7enYZbZe8aMXeWxwAwyISefXfgTy4AiLA/tmp90fpefv9.png' },
  // Run 12 (Gray Ghost Mannequin)
  { name: 'run_12_step_a.jpg', url: 'https://replicate.delivery/xezq/GwWek3vQkIVvPie6peKliooYJcFrTL41GXVOIWUrjrfdGHQcB/tmphsidh75f.jpg' },
  { name: 'run_12_step_b.png', url: 'https://replicate.delivery/xezq/33mrHhNAzRqdNtShGDj1WUN2gmWM6ZtwCI5RqBzia1KbcAxF/tmpwbybz3qz.png' },
]

async function download(name: string, url: string) {
  const dest = path.join(IMG_DIR, name)
  console.log(`Downloading ${name}...`)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`failed to fetch: ${url} (${response.statusText})`)
  const fileStream = fs.createWriteStream(dest)
  await new Promise((resolve, reject) => {
    response.body.pipe(fileStream)
    response.body.on('error', reject)
    fileStream.on('finish', resolve)
  })
}

async function main() {
  for (const img of imagesToDownload) {
    try {
      await download(img.name, img.url)
    } catch (e: any) {
      console.error(`Failed to download ${img.name}:`, e.message)
    }
  }
  console.log('All downloads completed!')
}

main().catch(console.error)
