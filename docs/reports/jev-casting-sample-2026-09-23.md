# Jev casting sample — 2026-09-23

Read-only. 300 real products; Jev asked exactly as `castForDesign` would in
`STEP_FLOW_CASTING_JEV=on`, gated by `evaluateJevCast`. Nothing was written.

## Reading (sifu, Watchtower c3bbbb16)

- **When Jev is confident, it's right.** Every accepted pick that overlaps a recorded
  vision cast matches it exactly. Where it disagrees with the keyword list, Jev
  usually reads better (a few are a toss-up, like artsy vs goth): "Retro Cherry Roller Skate Shirt for Playful Moms" goes to mom
  instead of skater, "Golden Senior Sparkle Tee" to grandpa instead of student, and
  "Retro Cowgirl Ghost Tee" to country instead of goth.
- **Coverage is low.** Only 18% of listings clear the 0.75 bar. The median subject
  confidence is about 0.6, because most names are short slogans that don't point
  at a type of person. With the switch `on`, the other ~80% would fall back to the
  old chain and all be flagged for review, which is too noisy to turn on as-is.
- **Children:** Jev made one child cast, and it was correct: the design brief says
  "youth sports design". Any child cast also needs a kids' keyword in the listing,
  so Jev can never put a child in a photo on its own.
- **Verdict:** keep the switch on `shadow`. Every live cast now records Jev's verdict
  (`metadata.step_flow.shots.*.casting.jev`), which builds the measurement over time.
  Consider `on` once confident coverage improves, for example by passing Etsy tags
  into castForDesign (the Step Flow caller passes only the name and idea today).

## Summary

| | |
|---|---|
| Jev answered | 300 / 300 |
| Accepted (confident, consistent, agrees with keyword band) | 54 (18%) |
| Low confidence → human review | 241 (80%) |
| Rejected (contradiction / keyword-band clash / off-menu) | 5 (2%) |
| Median subject confidence | 0.61 |
| Keyword floor matched anything | 121 / 300 (the rest fall to the plain default today) |
| Jev cast where keywords had nothing | 18 |
| Accepted & same archetype as keywords | 28 / 36 |
| Recorded live casts (vision chain) | 13 |
| …Jev accepted & same archetype | 5 / 5 |
| …Jev accepted & same age band | 5 / 5 |
| Youth (child) casts Jev would make | 1 |
| design_audience | no opinion: 185, either: 78, adult: 25, youth: 12 |
| Cost / time | $0.0166 / 10s |

## Recorded casts vs Jev

| Listing | Keywords | Recorded cast | Jev subject | Jev design_audience | Verdict |
|---|---|---|---|---|---|
| Spartans Warrior Legacy Helmet Tee | - | gym (mrs-imagine) | kid-sporty @ 0.42 | - @ 0.64 | low-confidence |
| Pumpkins Pitchforks Alien Hijinks Retro Chicken T-Shirt / Un | - | country (mrs-imagine) | country @ 0.73 | either @ 0.93 | low-confidence |
| Vintage Cross & Dad Crest Badge (No Text) - Square DTF | dad | dad (mrs-imagine) | dad @ 0.99 | adult @ 0.87 | accepted |
| Not a Drill Dad Duties Warning Badge Unisex Graphic Tee | dad | dad (mrs-imagine) | dad @ 1.00 | adult @ 0.98 | accepted |
| Merry Christmas Emblem Festive Graphic T-Shirt / Unisex Holi | family | classic (mrs-imagine) | family @ 0.38 | either @ 1.00 | low-confidence |
| Dope Car Crew Silhouette Badge | family | streetwear (mrs-imagine) | streetwear @ 0.96 | - @ 0.47 | rejected |
| Midnight Misfits Moon Portrait (Distressed Monochrome) | - | goth (mrs-imagine) | goth @ 0.85 | - @ 0.24 | accepted |
| Crazy Witch Halloween Graphic | goth | goth (mrs-imagine) | kid-playful @ 0.42 | - @ 0.68 | low-confidence |
| Too Cute To Spook Ghost T-Shirt / Halloween Unisex Tee | kid | student (mrs-imagine) | kid-playful @ 0.94 | youth @ 0.82 | low-confidence |
| Spooky Hoot Ghost Owl T-Shirt / Halloween Unisex Tee / hallo | goth | streetwear (mrs-imagine) | kid-playful @ 0.76 | either @ 0.97 | low-confidence |
| Witch Better Have My Candy | goth | goth (mrs-imagine) | kid-playful @ 0.49 | - @ 0.40 | low-confidence |
| Resting Witch Face | goth | goth (mrs-imagine) | goth @ 0.96 | - @ 0.30 | accepted |
| Bad Witch Vibes | goth | goth (mrs-imagine) | goth @ 0.99 | - @ 0.47 | accepted |

## Review list (low confidence / rejected)

| Listing | Keywords | Recorded cast | Jev subject | Jev design_audience | Verdict |
|---|---|---|---|---|---|
| Spartans Warrior Legacy Helmet Tee | - | gym (mrs-imagine) | kid-sporty @ 0.42 | - @ 0.64 | low-confidence |
| Pumpkins Pitchforks Alien Hijinks Retro Chicken T-Shirt / Un | - | country (mrs-imagine) | country @ 0.73 | either @ 0.93 | low-confidence |
| Merry Christmas Emblem Festive Graphic T-Shirt / Unisex Holi | family | classic (mrs-imagine) | family @ 0.38 | either @ 1.00 | low-confidence |
| Crazy Witch Halloween Graphic | goth | goth (mrs-imagine) | kid-playful @ 0.42 | - @ 0.68 | low-confidence |
| Too Cute To Spook Ghost T-Shirt / Halloween Unisex Tee | kid | student (mrs-imagine) | kid-playful @ 0.94 | youth @ 0.82 | low-confidence |
| Spooky Hoot Ghost Owl T-Shirt / Halloween Unisex Tee / hallo | goth | streetwear (mrs-imagine) | kid-playful @ 0.76 | either @ 0.97 | low-confidence |
| Witch Better Have My Candy | goth | goth (mrs-imagine) | kid-playful @ 0.49 | - @ 0.40 | low-confidence |
| Centered Clean Car Silhouette Graphic | - | - | dad @ 0.43 | either @ 0.97 | low-confidence |
| Gnome Abduction Funny Sci-Fi T-Shirt / Unisex Alien Tee | artsy | - | dad @ 0.48 | - @ 0.44 | low-confidence |
| Beam Me Up Retro Sci-Fi T-Shirt / Unisex Pop Art Tee | artsy | - | kid-playful @ 0.20 | - @ 0.69 | low-confidence |
| Stoic Samurai Cherry Blossom Tee | - | - | streetwear @ 0.23 | adult @ 0.92 | low-confidence |
| Neon Koi Galaxy T-Shirt / Cosmic Fish Graphic Tee | - | - | streetwear @ 0.30 | either @ 0.89 | low-confidence |
| Retro Magic Wand Tee - Believe in Your Own Power | - | - | kid-playful @ 0.75 | - @ 0.53 | low-confidence |
| You Are The Magic Hat Retro Positive Affirmation Tee | - | - | kid-playful @ 0.58 | - @ 0.72 | low-confidence |
| Abstract Mind Tee - Monochrome Brain Thought Shirt | - | - | studious @ 0.64 | - @ 0.34 | low-confidence |
| Grammar Enthusiast Tee: Capital Letters & Periods. | - | - | teacher @ 0.59 | - @ 0.51 | low-confidence |
| Daily Shitstorm Survivor Club Tee - Muted Emblem | - | - | streetwear @ 0.28 | adult @ 0.86 | low-confidence |
| Retro Football Champion 1986 Trophy Graphic Tee | kid-sporty | - | kid-sporty @ 0.44 | either @ 0.77 | low-confidence |
| Pixel Pilot Vintage Arcade Gamer Graphic Tee | studious | - | streetwear @ 0.37 | - @ 0.58 | low-confidence |
| Grumpy Cat Cowboy Hat Hoodie - Funny Feline Friend | country | - | kid-playful @ 0.41 | either @ 0.92 | low-confidence |
| Rustic Forest & Stag Metal Wall Clock Art | artsy | - | country @ 0.72 | - @ 0.32 | low-confidence |
| Michigan Great Lakes Metal Wall Art - Industrial State Map | artsy | - | dad @ 0.60 | - @ 0.36 | low-confidence |
| Wonderland Silhouette Metal Wall Art - Alice & Cheshire Cat | artsy | - | kid-playful @ 0.44 | - @ 0.52 | low-confidence |
| Tree of Life Metal Wall Art - Celtic Symbolism Decor | artsy | - | artsy @ 0.63 | - @ 0.31 | low-confidence |
| Minimalist Sarcastic Brain Humor T-Shirt | - | - | studious @ 0.59 | - @ 0.58 | low-confidence |
| Classic American Muscle Car Sunset Highway Metal Art | artsy | - | dad @ 0.33 | - @ 0.64 | low-confidence |
| Celtic Knot Tree of Life Metal Wall Art Decor | artsy | - | artsy @ 0.63 | - @ 0.40 | low-confidence |
| Iced Coffee Skeleton Hand Flat Graphic Tee | - | - | goth @ 0.44 | - @ 0.63 | low-confidence |
| Vintage Brain Anatomy Tee - Witty & Retro Style | - | - | studious @ 0.64 | - @ 0.27 | low-confidence |
| Yearning Emoji Pixel Art Tee - Nostalgic Internet Style | artsy | - | student @ 0.38 | - @ 0.28 | low-confidence |
| Timeless Forest Roman Numeral Metal Wall Art | artsy | - | artsy @ 0.40 | - @ 0.43 | low-confidence |
| Kokopelli Trio Metal Wall Art: Southwestern Desert Dance | artsy | - | country @ 0.60 | - @ 0.60 | low-confidence |
| Whimsical Fairy Garden Gate Metal Wall Art Print | artsy | - | artsy @ 0.39 | - @ 0.71 | low-confidence |
| Celtic Tree of Life Metal Wall Art - Interconnected Roots | artsy | - | artsy @ 0.71 | - @ 0.63 | low-confidence |
| Punctuation Perfection Tee: Grammar Enthusiast Shirt | - | - | teacher @ 0.50 | - @ 0.56 | low-confidence |
| Retro Y2K Brain Swirls Aesthetic Tee for Her | artsy | - | artsy @ 0.24 | - @ 0.72 | low-confidence |
| Midnight Owl Mama and Baby Gift Shirt | mom | - | family @ 0.48 | - @ 0.62 | low-confidence |
| Guilty Raccoon Pizza Snack Graphic Tee | - | - | kid-playful @ 0.74 | either @ 0.79 | low-confidence |
| Shadow Raptor Toy Charm | - | - | kid-playful @ 0.64 | - @ 0.51 | low-confidence |
| Toy: Robo Rascal | - | - | kid-playful @ 0.91 | youth @ 0.80 | low-confidence |
| Toy: The Wizard Beast | - | - | kid-playful @ 0.64 | - @ 0.46 | low-confidence |
| Retro Sunrise Trail Runner Badge Shirt | - | - | kid-sporty @ 0.50 | either @ 0.81 | low-confidence |
| Retro Largemouth Bass Tackle Box Badge Tee | - | - | dad @ 0.68 | - @ 0.63 | low-confidence |
| Smug Tabby Cat Vet Tech Clinic Team Shirt | kid-sporty | - | classic @ 0.23 | - @ 0.28 | low-confidence |
| I CHART THEREFORE I AM / Nurse Nerd Humor Chart Graphic | mom | - | studious @ 0.37 | adult @ 0.90 | low-confidence |
| Zero plucks given — Retro Sassy Turkey Thanksgiving (Copy) | - | - | dad @ 0.14 | - @ 0.38 | low-confidence |
| Leftovers Are for Quitters | - | - | gym @ 0.61 | - @ 0.49 | low-confidence |
| Zero plucks given — Retro Sassy Turkey Thanksgiving | - | - | kid-playful @ 0.13 | - @ 0.36 | low-confidence |
| Let’s Get Basted Thanksgiving Retro Turkey Poster | - | - | dad @ 0.24 | - @ 0.70 | low-confidence |
| Let's Get Basted Thanksgiving Retro Turkey | - | - | dad @ 0.25 | either @ 0.88 | low-confidence |
| Let’s Get Basted Retro Thanksgiving Turkey Poster | - | - | dad @ 0.20 | - @ 0.64 | low-confidence |
| Let’s Get Basted Retro Thanksgiving Turkey Pun | - | - | dad @ 0.57 | either @ 0.89 | low-confidence |
| Let’s Get Basted — Retro Turkey Pun Poster (Black Print) | - | - | dad @ 0.45 | - @ 0.62 | low-confidence |
| Retro Turkey: Stretchy Pants, Tolerable Family | family | - | family @ 0.71 | - @ 0.24 | low-confidence |
| Just Here To Nap Thanksgiving Retro Turkey Poster | - | - | dad @ 0.47 | - @ 0.74 | low-confidence |
| Thanksgiving Sarcasm: Stretchy Pants & Tolerable Family | family | - | dad @ 0.47 | adult @ 0.83 | low-confidence |
| Just Here To Nap Thanksgiving Snoring Turkey Retro Poster | - | - | dad @ 0.54 | - @ 0.73 | low-confidence |
| Neon Y2K Glitch Boo Crew Glow Up Ghost Candy | kid-playful | - | streetwear @ 0.32 | - @ 0.27 | low-confidence |
| Little Neon Boo Crew Glitch Ghost Candy Bucket (Neon Y2K) | kid-playful | - | kid-playful @ 0.61 | youth @ 0.91 | low-confidence |
| Little Neon Boo Crew Y2K Glitch Ghost Candy Bucket | kid-playful | - | kid-playful @ 0.67 | youth @ 0.88 | low-confidence |
| Little Neon Boo Crew Glitch Ghost Candy Pixel Neon Y2K | kid-playful | - | kid-playful @ 0.56 | youth @ 0.84 | low-confidence |
| Trail Bound Retro Mountain Sunrise Badge | - | - | kid-sporty @ 0.20 | either @ 0.87 | low-confidence |
| King of the Roar Roaring Lion Front Graphic | - | - | kid-playful @ 0.65 | - @ 0.34 | low-confidence |
| Create a DTF transfer with a retro badge shape containing a  | - | - | couple @ 0.26 | either @ 0.99 | low-confidence |
| Create an abstract Y2K aesthetic hoodie back design: a simpl | artsy | - | streetwear @ 0.45 | - @ 0.48 | low-confidence |
| Design a wraparound tumbler graphic featuring micro-typograp | artsy | - | artsy @ 0.47 | - @ 0.45 | low-confidence |
| Design a retro colorblock graphic with abstract 'map-like' c | artsy | - | artsy @ 0.58 | either @ 0.89 | low-confidence |
| Create a high-contrast DTF transfer artwork of a clean minim | - | - | artsy @ 0.49 | either @ 0.99 | low-confidence |
| Good Vibes Only Halo Spark | - | - | kid-playful @ 0.59 | either @ 0.99 | low-confidence |
| Walk It Build It Ship It Grid Quote Tile Pattern | - | - | streetwear @ 0.24 | - @ 0.29 | low-confidence |
| Neon City Tactical Soldier Crossover (Cinematic, Edgy) | - | - | streetwear @ 0.51 | adult @ 0.91 | low-confidence |
| Hysterical Aliens Joke Bubbles vs Confused Human | - | - | kid-playful @ 0.38 | - @ 0.42 | low-confidence |
| Alien Pointing Toward Hovercraft Light Beam Metal Panel Art | artsy | - | artsy @ 0.62 | - @ 0.33 | low-confidence |
| Y2K Nostalgia Photo Frame Tee | - | - | streetwear @ 0.37 | - @ 0.32 | low-confidence |
| First Day Energy Back-to-School Tee | student | - | kid-playful @ 0.67 | youth @ 0.89 | low-confidence |
| Customizable School Icon Design Template | student | - | kid @ 0.31 | - @ 0.64 | low-confidence |
| LEVEL UP ACADEMY T-Shirt | student | - | student @ 0.38 | - @ 0.27 | low-confidence |
| Ember Warrior Graphic Tee | - | - | streetwear @ 0.40 | - @ 0.48 | low-confidence |
| Y2K Vibe Geometric Burst | - | - | streetwear @ 0.70 | - @ 0.33 | low-confidence |
| Du bist gut genug Retro Shirt | - | - | kid-playful @ 0.19 | either @ 0.76 | low-confidence |

## Accepted

| Listing | Keywords | Recorded cast | Jev subject | Jev design_audience | Verdict |
|---|---|---|---|---|---|
| Vintage Cross & Dad Crest Badge (No Text) - Square DTF | dad | dad (mrs-imagine) | dad @ 0.99 | adult @ 0.87 | accepted |
| Not a Drill Dad Duties Warning Badge Unisex Graphic Tee | dad | dad (mrs-imagine) | dad @ 1.00 | adult @ 0.98 | accepted |
| Midnight Misfits Moon Portrait (Distressed Monochrome) | - | goth (mrs-imagine) | goth @ 0.85 | - @ 0.24 | accepted |
| Resting Witch Face | goth | goth (mrs-imagine) | goth @ 0.96 | - @ 0.30 | accepted |
| Bad Witch Vibes | goth | goth (mrs-imagine) | goth @ 0.99 | - @ 0.47 | accepted |
| Unleashed Power Athlete Hoodie / Dynamic Sports Graphic | kid-sporty | - | kid-sporty @ 1.00 | youth @ 1.00 | accepted |
| Mystic Circle Distressed Graphic T-Shirt / Unisex Crewneck T | artsy | - | goth @ 0.87 | - @ 0.62 | accepted |
| Heavyweight Garment-Dyed Tee — Blank | - | - | classic @ 0.76 | either @ 0.99 | accepted |
| Premium Retail-Fit Tee — Blank | - | - | classic @ 0.89 | either @ 0.99 | accepted |
| Soft Ring-Spun Tee — Blank | - | - | classic @ 0.89 | either @ 1.00 | accepted |
| Classic Heavy Cotton Tee — Blank | - | - | classic @ 0.96 | either @ 1.00 | accepted |
| Golden Gate Sunset Symphony Metal Print / Aluminum Wall Art | artsy | - | artsy @ 0.94 | - @ 0.36 | accepted |
| Misty Mountain Lake at Sunrise Metal Art | artsy | - | artsy @ 0.77 | either @ 0.97 | accepted |
| Hip-Hop Gorilla Swag T-Shirt / Streetwear Graphic Tee | streetwear | - | streetwear @ 1.00 | - @ 0.24 | accepted |
| Mic Drop Monkey Tee | streetwear | - | streetwear @ 0.97 | - @ 0.13 | accepted |
| Rustic Pine Forest Metal Wall Art for Cabin Decor | artsy | - | country @ 0.91 | - @ 0.32 | accepted |
| Oxidized Metal Bonsai Tree of Life Wall Art Decor | artsy | - | artsy @ 0.89 | - @ 0.27 | accepted |
| Smart Frog Math Teacher Shirt - Education Humor Tee | teacher | - | teacher @ 1.00 | - @ 0.49 | accepted |
| Witty Brain Tee: Abstract Neuron Smirk Graphic | - | - | studious @ 0.81 | - @ 0.34 | accepted |
| Vintage Brain Illustration Tee - Intellectual Humor | - | - | studious @ 0.95 | - @ 0.51 | accepted |
| Cute Cartoon Apple & Books Teacher Appreciation Tee | teacher | - | teacher @ 1.00 | - @ 0.30 | accepted |
| Powered by Coffee & Chaos Funny Mom Life Tee | mom | - | mom @ 1.00 | adult @ 0.99 | accepted |
| Dancing Kokopelli Metal Wall Art - Southwestern Decor | artsy | - | country @ 0.76 | - @ 0.40 | accepted |
| Professor Frog Math Teacher Whimsical Tee | teacher | - | teacher @ 0.91 | - @ 0.23 | accepted |
| Grumpy Bear Teacher Shirt for Elementary Educators | teacher | - | teacher @ 1.00 | adult @ 0.90 | accepted |
| Elegant Fern Silhouette Metal Wall Art for Nature Lovers | artsy | - | artsy @ 0.86 | - @ 0.69 | accepted |
| Retro Cowgirl Ghost Tee - Spooky Western Charm | goth | - | country @ 0.93 | - @ 0.57 | accepted |
| Chaos Coordinator Mom Life T-Shirt - Whimsical Crown | mom | - | mom @ 1.00 | adult @ 0.99 | accepted |
| Bruh Capital Letters & Periods Teacher Shirt | teacher | - | teacher @ 1.00 | - @ 0.68 | accepted |
| Abstract Metal Woman Bust Wall Art - Modern Sculpture | artsy | - | artsy @ 0.98 | - @ 0.69 | accepted |
| Wise Froggy Teacher Tee - Math & Learning Shirt | teacher | - | teacher @ 0.99 | - @ 0.09 | accepted |
| Skeletal Iced Coffee Grunge Aesthetic T-Shirt | artsy | - | goth @ 0.79 | adult @ 0.85 | accepted |
| Retro Cherry Roller Skate Shirt for Playful Moms | skater | - | mom @ 0.97 | adult @ 0.98 | accepted |
| Sunrise Ridge Trail Runner Vintage Race Day Tee | - | - | gym @ 0.91 | - @ 0.41 | accepted |
| Sunrise Ridge Trail Runner Vintage Race Day Shirt | - | - | gym @ 0.87 | - @ 0.46 | accepted |
| Create a split-panel graphic tee design: left panel shows an | streetwear | - | streetwear @ 0.92 | - @ 0.40 | accepted |
| Design an oversized hoodie back graphic featuring a bold sta | artsy | - | streetwear @ 0.81 | either @ 0.82 | accepted |
| Create a streetwear-inspired back print design featuring sta | streetwear | - | streetwear @ 1.00 | - @ 0.26 | accepted |
| Graffiti Roaring Lion Face | streetwear | - | streetwear @ 0.84 | - @ 0.38 | accepted |
| Golden Senior Sparkle Tee | student | - | grandpa @ 0.80 | - @ 0.65 | accepted |
| Discover Your Limits | - | - | gym @ 0.89 | either @ 0.85 | accepted |
| Quitters Never Win | - | - | gym @ 0.85 | - @ 0.73 | accepted |
| Quitters Never Win | - | - | gym @ 0.87 | either @ 0.75 | accepted |
| Quitters Never Win | - | - | gym @ 0.86 | either @ 0.77 | accepted |
| Quitters Never Win | - | - | gym @ 0.84 | - @ 0.72 | accepted |
| Go Hard or Go Home | - | - | gym @ 0.98 | - @ 0.66 | accepted |
| Go Hard or Go Home | - | - | gym @ 0.98 | - @ 0.73 | accepted |
| Toughest Trucker's Wife Ever | - | - | country @ 0.84 | adult @ 0.96 | accepted |
| Higher the Truck, Closer to God | country | - | country @ 0.94 | - @ 0.68 | accepted |
| Higher Truck, Closer to God | country | - | country @ 0.85 | - @ 0.28 | accepted |
| Daddy's Rollin' Style | - | - | dad @ 0.94 | adult @ 0.83 | accepted |
| Truck Life Vibes | country | - | country @ 0.77 | - @ 0.25 | accepted |
| Truck Life Vibes | country | - | country @ 0.79 | - @ 0.32 | accepted |
| Mother Trucker Pride | mom | - | mom @ 0.76 | adult @ 0.75 | accepted |
