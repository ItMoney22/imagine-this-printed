# ITP holiday social batch: 15 posts in the Outbox (task 78677af0, 2026-10-28)

Owner: mason-blaze. Backstory: Rico's sales diagnosis (task c47c3e66) found 125 TikTok drafts in `social_outbox`
and 0 ever posted. This batch is money move 5 on APPROVE 525d19e3 (line 9).

## What is in the Outbox now

15 Christmas gift posts in ITP Admin > Social Outbox > Draft, the first 15 cards in posting order. All are still
`draft`: the bridge (`GET /api/social-outbox/bridge/next`) only returns `approved` rows, so nothing posts until David
taps Approve. Each has a release time (`scheduled_for`), 7:00 PM ET, three a week. Approve keeps that time.

| Release (ET) | Product | Outbox id | Caption opens with |
|---|---|---|---|
| 11-03 | Gnome Abduction Funny Sci-Fi T-Shirt | `b14a14ea` | Where do garden gnomes go in winter? This one caught a ride on a flying saucer. … |
| 11-05 | Stoic Samurai Cherry Blossom Tee | `4771c7ec` | A quiet samurai under falling cherry blossoms. A calm, bold Christmas pick for a… |
| 11-07 | Neon Koi Galaxy T-Shirt | `119f3a0d` | A neon koi swimming through the stars. A gift for the friend who likes their shi… |
| 11-10 | Vintage Yarn Love Tee - Cozy Crafting Comfort | `8c5b5e88` | Two crochet hooks and a ball of yarn shaped like a heart. A sweet Christmas gift… |
| 11-12 | Midnight Wolves: The Hunt | `a4938deb` | A wolf pack on the hunt under a glowing sky. A Christmas gift for the outdoors l… |
| 11-14 | Beam Me Up Retro Sci-Fi T-Shirt | `4b0bef75` | Beam me up, this place sucks. A retro sci-fi tee for the friend who is ready to … |
| 11-17 | Avian Elegance: A Symphony in Feathers | `52a8d82c` | An eagle and a flock of birds in full flight. A Christmas gift for the bird watc… |
| 11-19 | Graffiti Roaring Lion Face | `4b11e4b8` | A roaring lion in spray-paint color. A loud, bold Christmas gift for the streetw… |
| 11-21 | Cosmic Encounter: Boy Meets Alien | `0cddbcac` | A kid offers a balloon to a friendly alien under the stars. A gentle Christmas g… |
| 11-24 | Celestial Orbit Nautical Metal Wall Art Print | `f1bdd1cc` | A compass, an anchor and orbit rings in copper and navy, printed on metal. A sma… |
| 11-27 | Unleashed Power Athlete Hoodie | `6c76a371` | An athlete in a helmet, charged with electric blue lightning. A warm Christmas g… |
| 11-28 | Midnight Misfits Moon Portrait (Distressed Monochrome) | `740e0aa5` | Four midnight misfits under a cratered moon, in distressed black and white. A co… |
| 12-01 | Toy: The Wizard Beast | `060b6d80` | The Wizard Beast: a 3D printed toy figure in up to 4 colors, printed to order. A… |
| 12-03 | Toy: Robo Rascal | `0dca44b8` | Robo Rascal: a 3D printed robot figure in up to 4 colors, printed to order. A st… |
| 12-05 | Shadow Raptor Toy Charm | `9a404b23` | Shadow Raptor: a little 3D printed creature with a big attitude, in up to 4 colo… |

Every caption ends `Shop it at imaginethisprinted.com: <product url>?utm_source=tiktok&utm_medium=social&utm_campaign=<that row's id>`,
the same tagging as `backend/services/social-utm.ts`, so `orders.attribution->>'utm_campaign'` joins back to the post.
Each has 5 hashtags (TikTok is reported to cap posts at 5). Images are the shopper gallery in `getGalleryImages`
order (`src/lib/product-kind.ts`), at most 4, so a halftone or DTF print file can never be posted. The toys carry the
one concept render they have, and they post last so the pass-1 real photos (2224bf29) can replace it first.

## How the 15 were picked

Of 125 drafts, only 33 point at products the public can open (83 are draft products, 9 archived). From the 33:
- Left out: every Halloween design (Too Cute To Spook, Spooky Hoot, Resting Witch Face, Bad Witch Vibes), the IP holds
  (Folgers, Grumpy Cat, Ghost Face candle holder), Chill Alien (a smoke-break joke with #420apparel),
  Hip-Hop Gorilla (its red-and-white sneakers read as a famous brand's shoe), Walk By Faith (a creator's product),
  two extra lion tees and the second yarn tee (repeats), the School Icon DTF template (not a gift).
- Captions say only what the product page and `src/lib/help-facts.ts` say: printed to order, unisex, "order at least
  two weeks before you need it". No prices, codes, delivery dates or engine names.
- The old July rows were replaced by fresh rows. That gives a new id, so the UTM campaign is new and the posts sit
  first in the newest-first Draft lane. Backup of the 15 old rows:
  `E:/memory/watchtower/projects/imagine-this-printed/2026-10-28-78677af0-social-holiday/backup-old-15.json`.

## Accounts (fleet browser, logged out, 2026-10-28)

| Platform | Result |
|---|---|
| TikTok | **@imaginethisprinted exists**: 76 followers, 380 likes, real product videos up to 14.2K views. The shop address in the bio is plain text, not a link. |
| Instagram | instagram.com/imaginethisprinted: "Profile isn't available" (no account under that name). |
| Pinterest | pinterest.com/imaginethisprinted redirects to `/?show_error=true`: no such profile. Creating one is line 2 of APPROVE 525d19e3. |
| Facebook | login wall; waits on Sifu (LOGIN 93973985). |

## Push-back

TikTok never makes a link inside a caption tappable, and the only tappable link is the bio Website field. Several 2026
guides agree, but I could not confirm it on TikTok's own help page. So the caption UTM link can only credit visits from
people who type it or copy it, and the real click path is the bio. APPROVE 42264b2f asks David to switch to a free
Business account and put a tagged shop link in the bio.

## What still waits

- David: tap Approve per post (525d19e3 line 9); the bio link (42264b2f).
- Posting: no job calls the bridge yet, and the bridge token in the local `backend/.env` got 401 from prod. Both are
  on card 5b95feca.
