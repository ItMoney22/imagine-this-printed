import { Link } from 'react-router-dom'
import { ArrowRight, Shirt, Boxes, Image as ImageIcon, Layers, Package, Snowflake } from 'lucide-react'
import type { DoorId } from './useHomeShop'
import { useReveal } from './useReveal'

const DOORS: { id: DoorId; to: string; title: string; line: string; img: string; icon: typeof Shirt }[] = [
  { id: 'tees', to: '/catalog/shirts', title: 'T-Shirts', line: 'Original designs, printed to order', img: '/home/cat-tees.webp', icon: Shirt },
  { id: 'hoodies', to: '/catalog/hoodies', title: 'Hoodies', line: 'Heavy, warm, printed to order', img: '/home/cat-hoodies.webp', icon: Snowflake },
  { id: 'toys', to: '/catalog/3d-prints', title: '3D Prints', line: 'Toy figures, charms and decor', img: '/home/cat-toys.webp', icon: Boxes },
  // Metal art is made to order in the Metal Art studio, so its door opens the studio.
  { id: 'metal', to: '/metal-art', title: 'Metal Art', line: 'Your picture on aluminum', img: '/home/cat-metal.webp', icon: ImageIcon },
  { id: 'dtf', to: '/catalog/dtf-transfers', title: 'DTF Transfers', line: 'Press-ready prints for your blanks', img: '/home/cat-dtf.webp', icon: Layers },
  { id: 'blanks', to: '/blanks', title: 'Blank Tees', line: 'Plain shirts in four qualities', img: '/home/cat-blanks.webp', icon: Package },
]

/**
 * Shop by category. A door whose shelf is empty right now stays hidden (the
 * metal door opens the studio, so it always has somewhere to go).
 */
export function CategoryDoors({ counts, loading }: { counts: Record<DoorId, number>; loading: boolean }) {
  const ref = useReveal<HTMLElement>()
  const doors = DOORS.filter((d) => loading || d.id === 'metal' || counts[d.id] > 0)
  return (
    <section ref={ref} className="home-reveal py-12 sm:py-16 bg-bg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="font-display text-2xl sm:text-3xl text-text uppercase tracking-wide mb-6 sm:mb-8">Shop by category</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-5">
          {doors.map(({ id, to, title, line, img, icon: Icon }, i) => {
            // An odd last door spans both phone columns; a wide crop keeps it from towering.
            const spans = i === doors.length - 1 && doors.length % 2 === 1
            return (
            <Link
              key={id}
              to={to}
              className={`home-door home-stagger group bg-card rounded-2xl overflow-hidden border border-border shadow-soft hover:shadow-soft-lg ${spans ? 'col-span-2 md:col-span-1' : ''}`}
              style={{ transitionDelay: `${i * 70}ms` }}
            >
              <div className={`home-door-shine relative overflow-hidden ${spans ? 'aspect-[2/1] md:aspect-[4/3]' : 'aspect-[4/3]'}`}>
                <img src={img} alt="" className="home-door-img w-full h-full object-cover" loading="lazy" width={800} height={598} />
                <span className="absolute left-3 bottom-3 w-9 h-9 rounded-full bg-primary text-white flex items-center justify-center shadow-soft">
                  <Icon className="w-4 h-4" strokeWidth={2} />
                </span>
              </div>
              <div className="p-3 sm:p-4">
                <h3 className="font-display text-base sm:text-lg text-text flex items-center justify-between gap-2">
                  {title}
                  <ArrowRight className="home-door-arrow w-4 h-4 shrink-0 text-primary" />
                </h3>
                <p className="text-xs sm:text-sm text-muted mt-0.5">{line}</p>
              </div>
            </Link>
            )
          })}
        </div>
      </div>
    </section>
  )
}
