# Etsy holiday relaunch: review sheet (2026-10-28)

Watchtower task a8946dbf (Rico Fernandez). For David's yes or no on **APPROVE: ITP money moves** (525d19e3), **line 3**
(price) and **line 7** (listing copy). **Nothing on this sheet is live.** Every Etsy write today went to DRAFT listings,
which buyers cannot see. The 14 live tees were read back after the work and are byte-for-byte unchanged.

Shop read through the Etsy Open API at 2026-10-28T20:22Z. Scripts, raw reads and logs:
`E:/memory/watchtower/projects/imagine-this-printed/2026-10-28-a8946dbf-etsy-holiday/`.

## 1. Done today, in drafts (invisible to buyers)

| Listing | Title | Price | Photos | Tags | AI note |
|---|---|---|---|---|---|
| 4605156955 | Wizard Beast Fantasy Figure, 3D Printed Collectible, Dragon Wizard Desk Decor, Gamer Gift for Him, Stocking Stuffer | $24.99 | 1 | 13 | yes |
| 4605177426 | Robo Rascal Robot Figure, 3D Printed Collectible Mech, Robot Desk Buddy, Gift for Gamer, Stocking Stuffer for Teens | $15.99 | 1 | 13 | yes |
| 4605177446 | Shadow Raptor Dinosaur Figure, 3D Printed Dino Collectible, Dinosaur Lover Gift, Desk Decor, Stocking Stuffer | $15.99 | 1 | 13 | yes |
| 4580221283 | Graffiti Roaring Lion DTF Transfer, Ready to Press Heat Transfer, Neon Lion Head Design for Shirts, Hoodies and Totes | $12.00 / $20.00 / $28.00 | 3 | 13 | yes |
| 4571126363 | Beam Me Up DTF Transfer, Retro Pop Art UFO Design, Ready to Press Heat Transfer for Shirts and Hoodies, Funny Sci-Fi Gift | $12.00 / $20.00 / $28.00 | 3 | 13 | yes |
| 4571122955 | Gnome Abduction DTF Transfer, Funny UFO Alien Garden Gnome, Ready to Press Heat Transfer for Shirts and Hoodies | $12.00 / $20.00 / $28.00 | 3 | 13 | yes |
| 4571142776 | Beam Me Up PNG, Retro Pop Art UFO Design, Digital Download for Stickers, Small DTF Prints and Crafts | $5.00 | 3 | 13 | yes |
| 4571139278 | Gnome Abduction PNG, Funny UFO Alien Garden Gnome Design, Digital Download for Stickers, Small DTF Prints and Crafts | $5.00 | 3 | 13 | yes |

- **3 new 3D figure drafts** (Wizard Beast 5.9 in, Robo Rascal 3.9 in, Shadow Raptor 3.9 in) at the site's prices, in Art &
  Collectibles > Figurines, made to order with a new 3-5 day print time. The copy says they are PLA, printed in up to 4
  filament colors, that the photo is the design render, and that they are display figures for teens and adults, not toys
  for young children. Each ends with the house AI note: "The character design is a seller-prompted, AI-assisted creation,
  directed and curated by ImagineThisPrinted."
- **Beam Me Up and Gnome Abduction DTF transfers**: the copy promised three sheet sizes but the listing sold only the
  8.5x11 at $12. They now carry the house sheet sizes (8.5x11 $12, 11x17 $20, 13x19 $28), like the Lion transfer.
- **Graffiti Roaring Lion DTF transfer**: added the missing return policy, the house transfer copy, auto-renew, and two
  film cards in the same layout as the other transfers. The copy says the lion prints with its black square background.
- **Gnome PNG and DTF**: the "| Unisex Alien" left over from the tee title is gone from the title and first line.
- **Beam Me Up and Gnome PNG downloads**: the PNG files were already attached (1024 x 1024). Titles now say what the
  file is good for (stickers, small DTF prints, crafts). The descriptions already say honestly that it prints about 3.4
  inches at 300 DPI.

**Before these go live:**
- **3D figures:** a real photo of a printed sample (pass-1 shoot 2224bf29 already lists all three) and a working
  printer (card 6743a98c: both A1s are offline). The render has more colors than the 4-color print, which is why the copy says so.
- **Bigger files:** the transfer and PNG artwork is 1024 px. A full-size 300 DPI file needs the upscaler, about a cent a
  design, but Replicate returned "insufficient credit" (402) on 10/28. Until it's topped up, the PNG stays a small-print file.
- **Test draft:** "Validation Draft Delete Me" (4593902255) can't be deleted through the API (no delete permission). It's
  on Christina's board (f03134a4), and Becky has a note to raise it with her.
- **Publishing:** done by Christina or David in Shop Manager, after the yes. Agents never click in Shop Manager.
- **Christmas name ornament and keychain:** left out of this pass. Card bf353160 (zero-pluto) is still building them,
  and its brief already includes their Etsy drafts.

## 2. Christmas order-by dates (USPS published, read 2026-10-28)

USPS 2026 send-by dates for the lower 48: Ground Advantage **Thu Dec 17**, Priority Mail
**Fri Dec 18**, Priority Mail Express **Sat Dec 19** (https://www.usps.com/holiday/holiday-shipping-dates.htm (read 2026-10-28)). Our Etsy
shipping profile offers no Priority upgrade, so Ground Advantage is the date that counts on Etsy.

- Tees and transfers: **order by Sat Dec 12 (1-3 business days to make: Dec 14-16, ships before USPS Ground Dec 17)**
- 3D figures: **order by Tue Dec 8 (3-5 business days to make: Dec 9-15, ships 2 days before Dec 17)**
- Downloads: instant, any day

The earlier guess was Dec 12 Ground and Dec 15 Priority. USPS's real Ground date (Dec 17) still gives Dec 12 once our
1-3 day make time is added, so Dec 12 stands. Dec 15 only applies to Priority on the website.

**New shop announcement (line 5's banner, Etsy side). Revert 2026-12-26 (put back the current text; the dates mean nothing after Christmas):**

> CHRISTMAS ORDER-BY DATES (US): order tees and DTF transfers by Saturday, December 12, and 3D printed figures by Tuesday, December 8, for delivery before Christmas. Digital downloads arrive instantly, any day.
>
> Welcome to ImagineThisPrinted. Every design here is printed to order in Rockmart, Georgia, on soft, true-to-size tees using DTF transfers that stay bright wash after wash. Tees and transfers leave the shop in 1 to 3 business days, 3D printed figures in 3 to 5. Need something that does not exist yet? Message us, custom work is what we do.

## 3. Price (line 3): correction first

The $22 shown on 11 tees is only the YOUTH price (the listing shows its lowest variation). Read from the inventory 10/28: youth $22, adult S-XL $25, 2XL-3XL $27.50. The 3 older tees (Y2K Burst, Du Bist Gut Genug, Walk By Faith) are $25 in every size. So one adult tee costs a buyer $30 today, not $27.

| | Youth | Adult S-XL | Adult 2XL-3XL | Older 3 tees | Shipping | 1 adult tee | 2 adult tees |
|---|---|---|---|---|---|---|---|
| **A. Today** | $22.00 | $25.00 | $27.50 | $25.00 | $5 + $2 each extra | $30.00 | $57.00 |
| **B. Shipping folded in (recommended)** | $26.99 | $29.99 | $32.49 | $29.99 | free | $29.99 | $59.98 |
| **C. Line 3 as written ($26.99)** | $23.99 | $26.99 | $29.49 | $26.99 | free | $26.99 | $53.98 |

- B is what "the buyer pays the same" means: every size goes up $4.99 and shipping becomes free, so the listing reads
  "from $26.99". C is a real $3.01 cut on every adult tee.
- B costs a 2-tee buyer $2.98 more than today (today the 2nd tee ships for $2); C costs them $3.02 less.
- Fees: Etsy takes 6.5% of item + shipping and 3% + $0.25 processing either way: about $3.10 on a $30 order under A or B.
- Real shipping cost: USPS Ground Advantage for one tee quoted $6.56 at ITP checkout 10/28, so we already eat about $1.50 at $5 shipping; B does not change that, C adds a $3 cut on top.
- Search: third-party 2026 guides say free or under-$6 US shipping ranks better; Etsy does not publish this, so it is a likely lift, not a promise.
- How it's applied on a yes: tee-apply.cjs --price: a new $0/$0 Free US shipping profile via the API (shops_w), every live offering +$4.99 through the inventory endpoint (all variations kept), tees moved to the new profile; dry run proven 10/28 (61 calls listed, 0 written).

## 4. Shop sections (Christmas section)

Etsy shows one section per listing. In the order below, the first section that names a listing gets it.

- **Christmas Gifts**: 4573220449, 4573224859, 4544419854, 4544388862, 4571122903, 4573217686, 4571126257, 3 figure drafts once live, ornament + keychain from bf353160 once live
- **Funny Tees**: 4573224859, 4544388862, 4571122903, 4571126257, 4573217686, 4571212644
- **Witchy and Halloween**: 4571973475, 4571989354, 4571212644, 4571207764, 4571172383
- **3D Printed Figures**: 4605156955, 4605177426, 4605177446
- **DTF Transfers and PNG Files**: 4580221283, 4571126363, 4571122955, 4571142776, 4571139278

Empty sections stay hidden until a listing in them goes live.

## 5. Gift-search titles and tags for the 14 live tees (line 7)

Descriptions don't change. Every title is 140 characters or fewer with no % : &. Every tag list is 13 tags of 20
characters or fewer, checked by `tee-apply.cjs`.

### 1. Bad Witch Vibes Unisex Graphic Tee | Soft Graphic T-Shirt (Halloween / witchy, low priority after 10/31)

- Listing 4571973475 · 0 lifetime views
- **New title:** Bad Witch Vibes Shirt, Funny Witchy Gift for Her, Witch Hat Graphic Tee, Spooky Season Unisex T-Shirt
- **New tags:** witch shirt · bad witch shirt · witchy gift · gift for her · witch aesthetic · funny witch tee · spooky season · witch hat shirt · gift for sister · gothic shirt · witchy vibes · halloween shirt · gift for best friend

### 2. Dope Car Crew Silhouette Badge Unisex Graphic Tee | Soft Graphic T-Shirt

- Listing 4573217686 · 0 lifetime views
- **New title:** Car Guy Shirt, Car Crew Silhouette Graphic Tee, Gift for Car Lover, Car Enthusiast Gift for Him, Unisex T-Shirt
- **New tags:** car guy shirt · car lover gift · car enthusiast · gift for him · car crew shirt · gift for husband · car meet shirt · mechanic gift · gift for boyfriend · car guy gift · gearhead gift · garage shirt · car culture tee

### 3. Merry Christmas Emblem Festive Graphic T-Shirt | Unisex Holiday Tee

- Listing 4573220449 · 0 lifetime views
- **New title:** Merry Christmas Shirt, Christmas Ornament Graphic Tee, Holiday Party Outfit, Family Christmas T-Shirt, Unisex Xmas Gift
- **New tags:** christmas shirt · merry christmas tee · holiday shirt · christmas party · family christmas · xmas shirt · christmas gift · ornament shirt · holiday outfit · matching christmas · gift for her · gift for him · festive tee

### 4. Not a Drill Dad Duties Warning Badge Unisex Graphic Tee

- Listing 4573224859 · 10 lifetime views
- **New title:** Funny Dad Shirt, This Is Not a Drill Dad Duties Tee, Gift for Dad, Handyman Dad Gift, Christmas Gift for Dad
- **New tags:** funny dad shirt · gift for dad · dad gift · handyman gift · dad joke shirt · new dad gift · gift from kids · christmas gift dad · power tool shirt · dad birthday gift · workshop shirt · gift for husband · diy dad shirt

### 5. Crazy Witch Halloween Graphic Unisex Graphic Tee | Soft Graphic T-Shirt (Halloween / witchy, low priority after 10/31)

- Listing 4571989354 · 2 lifetime views
- **New title:** Crazy Witch Shirt, Funny Witch Graphic Tee, Witchy Gift for Her, Witch Silhouette Unisex T-Shirt
- **New tags:** crazy witch shirt · funny witch shirt · witchy gift · gift for her · witch shirt · witch aesthetic · spooky season · gift for mom · witch silhouette · gothic gift · halloween shirt · gift for sister · witchy vibes

### 6. Resting Witch Face Unisex Graphic Tee | Soft Graphic T-Shirt (Halloween / witchy, low priority after 10/31)

- Listing 4571212644 · 1 lifetime views
- **New title:** Resting Witch Face Shirt, Funny Witch on Broom Tee, Sarcastic Gift for Her, Witchy Unisex Graphic T-Shirt
- **New tags:** resting witch face · funny witch shirt · sarcastic shirt · witchy gift · gift for her · witch on broom · witch shirt · gift for coworker · spooky season · witch aesthetic · gift for mom · halloween shirt · gift for friend

### 7. Spooky Hoot Ghost Owl T-Shirt | Halloween Unisex Tee | halloween unisex t-shirt (Halloween / witchy, low priority after 10/31)

- Listing 4571207764 · 0 lifetime views
- **New title:** Spooky Hoot Ghost Owl Shirt, Cute Halloween Owl Tee, Owl Lover Gift, Fall Graphic Unisex T-Shirt
- **New tags:** owl shirt · owl lover gift · ghost owl · cute halloween tee · halloween shirt · fall shirt · spooky season · gift for her · cute ghost shirt · jack o lantern · owl gift · trick or treat · spooky cute

### 8. Too Cute To Spook Ghost T-Shirt | Halloween Unisex Tee (Halloween / witchy, low priority after 10/31)

- Listing 4571172383 · 2 lifetime views
- **New title:** Too Cute To Spook Shirt, Cute Ghost Halloween Tee, Pumpkin Ghost Graphic, Fall Gift for Her, Unisex T-Shirt
- **New tags:** too cute to spook · cute ghost shirt · halloween shirt · ghost tee · pumpkin shirt · spooky season · fall shirt · gift for her · cute halloween · trick or treat · ghost lover gift · spooky cute · retro halloween

### 9. Beam Me Up Retro Pop Art T-Shirt | Unisex Sci-Fi Tee

- Listing 4571126257 · 3 lifetime views
- **New title:** Beam Me Up Shirt, Funny Alien UFO Tee, Retro Pop Art Sci-Fi Gift for Him or Her, Sarcastic Graphic T-Shirt
- **New tags:** ufo shirt · alien shirt · funny alien tee · beam me up shirt · sci fi gift · sarcastic shirt · retro pop art · space lover gift · gift for him · gift for her · alien lover gift · comic book shirt · introvert shirt

### 10. Gnome Abduction Funny Sci-Fi T-Shirt | Unisex Alien | funny gnome abduction t-shirt

- Listing 4571122903 · 0 lifetime views
- **New title:** Funny Gnome Shirt, Gnome Abduction UFO Tee, Garden Gnome Gift, Alien Lover Gift, Gardener Gift Unisex T-Shirt
- **New tags:** gnome shirt · funny gnome tee · garden gnome gift · gnome lover gift · gardener gift · ufo shirt · alien shirt · gift for mom · gift for grandma · gardening shirt · funny alien tee · gift for her · sci fi gift

### 11. Y2K Vibe Geometric Burst T-Shirt | Retro Unisex Graphic Tee

- Listing 4544968561 · 13 lifetime views
- **New title:** Y2K Shirt, Retro Geometric Burst Graphic Tee, 2000s Aesthetic Top, Gift for Teen, Colorful Unisex T-Shirt
- **New tags:** y2k shirt · y2k aesthetic · 2000s shirt · retro graphic tee · gift for teen · teen girl gift · colorful shirt · geometric shirt · y2k top · aesthetic shirt · trendy shirt · gift for her · halftone tee

### 12. Du Bist Gut Genug Retro Varsity T-Shirt | Unisex Graphic Tee

- Listing 4544420168 · 13 lifetime views
- **New title:** Du Bist Gut Genug Shirt, German You Are Enough Tee, Motivational Gift, Retro Varsity Graphic, Unisex T-Shirt
- **New tags:** german shirt · you are enough · motivational shirt · german gift · encouragement gift · retro varsity tee · mental health tee · gift for friend · self love shirt · positive shirt · german saying · varsity shirt · gift for her

### 13. Walk By Faith Inspiration Tee | Unisex Graphic Shirt

- Listing 4544419854 · 0 lifetime views
- **New title:** Walk By Faith Shirt, Christian Tee, Faith Gift for Women and Men, Bible Verse Inspired Graphic, Unisex T-Shirt
- **New tags:** walk by faith · christian shirt · faith shirt · christian gift · religious gift · bible verse shirt · church shirt · gift for her · gift for mom · inspirational tee · faith gift · christmas gift · pastor gift

### 14. Grey Alien Listen Tee |Sci-Fi Extraterrestrial T-Shirt |Humorous

- Listing 4544388862 · 18 lifetime views
- **New title:** Funny Alien Shirt, Grey Alien Listen Tee, Sci-Fi Gift for Him, Alien Lover Gift, Sarcastic Graphic T-Shirt
- **New tags:** funny alien shirt · grey alien tee · alien lover gift · sci fi gift · gift for him · ufo shirt · alien shirt · sarcastic shirt · space shirt · gift for husband · geek gift · gift for brother · nerd gift

## 6. On David's yes (step 4)

`node tee-apply.cjs --copy --announce --sections --price --apply --ruling "<his words + time>"`, using only the flags
for the lines he approved, from the evidence folder. Without `--ruling` it refuses to write. The dry run on 10/28 listed
61 calls and wrote 0. After that: Christina or David publish the drafts, and views get re-read 14 days later against the
baseline in `etsy-live-2026-10-28.json` (62 lifetime views across the 14 tees).
