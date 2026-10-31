import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, ExternalLink, Heart, Mail, Sparkles } from 'lucide-react'

// The people behind the shop (David 2026-10-31: "a nice page of our team",
// David Trinidad CEO, Darrell McCutchen Vice President). Bios stick to what is
// true and public: no invented credentials.
type Member = {
  name: string
  title: string
  photo: string
  photoAlt: string
  bio: string[]
  link?: { href: string; label: string }
}

const TEAM: Member[] = [
  {
    name: 'David Trinidad',
    title: 'Chief Executive Officer',
    photo: '/team/david-trinidad.webp',
    photoAlt: 'Portrait of David Trinidad, CEO of Imagine This Printed',
    bio: [
      'David started Imagine This Printed on the promise in its name: if you can imagine it, we should be able to print it. Shirts, DTF transfers and 3D-printed pieces, made one order at a time.',
      'He is an entrepreneur and a builder at heart, the person behind the whole Imagine This family of businesses, and the author of I AM GOD: In The Beginning.',
    ],
  },
  {
    name: 'Darrell McCutchen',
    title: 'Vice President',
    photo: '/team/darrell-mccutchen.webp',
    photoAlt: 'Portrait of Darrell McCutchen, Vice President of Imagine This Printed',
    bio: [
      'Darrell is a husband, father and entrepreneur who believes business is at its best when it is built on trust and a higher purpose. He lives by three words: faith, family and friendships.',
      'He helps people and small businesses grow through video marketing and a few partnerships he personally stands behind, and he brings that same care to every customer here.',
    ],
    link: { href: 'https://darrellmccutchen.com', label: 'darrellmccutchen.com' },
  },
]

export default function OurTeam() {
  return (
    <div className="min-h-screen bg-bg">
      <div className="relative overflow-hidden bg-gradient-to-r from-purple-600 to-pink-600 pt-16 pb-36">
        <div className="pointer-events-none absolute -top-24 -right-24 h-80 w-80 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-32 left-1/4 h-72 w-72 rounded-full bg-pink-300/20 blur-3xl" />
        <div className="relative max-w-5xl mx-auto px-4">
          <Link to="/about" className="flex w-fit items-center gap-2 text-white/80 hover:text-white mb-6 transition-colors">
            <ArrowLeft className="w-4 h-4" />
            About Us
          </Link>
          <p className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-sm font-medium text-white">
            <Sparkles className="w-4 h-4" />
            The people behind the prints
          </p>
          <h1 className="mt-4 font-display text-5xl md:text-display-md font-bold text-white">Our Team</h1>
          <p className="mt-3 max-w-2xl text-lg text-white/85">
            Imagine This Printed is a small shop in Rockmart, Georgia. Here are the two people who answer for every order.
          </p>
        </div>
      </div>

      <div className="relative -mt-24 max-w-5xl mx-auto px-4 pb-16">
        <div className="grid gap-8 md:grid-cols-2">
          {TEAM.map((m) => (
            <article key={m.name} className="flex flex-col overflow-hidden rounded-3xl bg-card shadow-soft-xl ring-1 ring-black/5">
              <div className="relative aspect-[4/5] overflow-hidden bg-gradient-to-br from-purple-600 to-pink-600 p-1.5">
                <img
                  src={m.photo}
                  alt={m.photoAlt}
                  className="h-full w-full rounded-[1.25rem] object-cover object-top"
                  loading="eager"
                />
                <span className="absolute bottom-5 left-5 rounded-full bg-white/95 px-4 py-1.5 text-sm font-semibold text-purple-700 shadow-soft">
                  {m.title}
                </span>
              </div>
              <div className="flex flex-1 flex-col p-7">
                <h2 className="font-display text-3xl font-bold text-text">{m.name}</h2>
                <p className="mt-1 text-sm font-semibold uppercase tracking-wider text-pink-600">
                  {m.title} · Imagine This Printed
                </p>
                <div className="mt-4 space-y-3 leading-relaxed text-muted">
                  {m.bio.map((p) => <p key={p.slice(0, 24)}>{p}</p>)}
                </div>
                {m.link && (
                  <a
                    href={m.link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-5 inline-flex items-center gap-2 self-start font-semibold text-primary hover:underline"
                  >
                    {m.link.label}
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>

        <div className="mt-12 rounded-3xl bg-gradient-to-r from-purple-50 to-pink-50 p-8 md:p-10 ring-1 ring-purple-100">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-4">
              <Heart className="mt-1 w-8 h-8 shrink-0 text-pink-600" />
              <div>
                <h2 className="font-display text-2xl md:text-3xl font-bold text-text">Have an idea? Bring it to us.</h2>
                <p className="mt-2 text-muted">We read every message ourselves and print every order after you place it.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3 md:flex-nowrap md:shrink-0">
              <Link
                to="/catalog"
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 px-5 py-3 font-semibold text-white shadow-soft-lg hover:opacity-95"
              >
                Shop our products
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                to="/contact"
                className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 font-semibold text-text ring-1 ring-border hover:bg-purple-50"
              >
                <Mail className="w-4 h-4" />
                Contact us
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
