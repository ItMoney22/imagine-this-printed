/** Ideas to try on the station's welcome scene; each card's picture is public/station/ideas/<slug>.webp. */
export interface IdeaToTry {
  slug: string
  label: string
  prompt: string
}

export const IDEAS_TO_TRY: IdeaToTry[] = [
  { slug: 'vibes', label: 'Good Vibes', prompt: 'Colorful puffy retro bubble lettering that says "GOOD VIBES" with tiny sparkles and a smiling sun' },
  { slug: 'tiger', label: 'Cool Tiger', prompt: 'A cool tiger head wearing neon pink sunglasses, bold sticker style' },
  { slug: 'butterfly', label: 'Rainbow Butterfly', prompt: 'A rainbow butterfly with glowing iridescent wings' },
  { slug: 'sunset', label: 'Retro Sunset', prompt: 'A retro 80s sunset with palm tree silhouettes inside a rounded badge' },
  { slug: 'daisy', label: 'Happy Daisy', prompt: 'A happy 70s groovy daisy flower with a smiling face' },
]
