# Jev IP gate — first live sweep (2026-09-23, Watchtower c0fbb4a3)

**What this is.** Every `active` and `draft` product (2,542 rows) run through the
existing regex denylist AND the new Jev IP classifier (`backend/services/jev-ip-gate.ts`),
side by side. Read-only — nothing in the database was changed. Re-run with
`backend/scripts/jev-ip-sweep.ts`. Full per-row JSON:
`E:\memory\watchtower\knowledge\itp-jev-ip-sweep-2026-09-23.json`.

## Findings that matter

1. **An ACTIVE Etsy listing the regex waved through.** *Neon City Tactical Soldier
   Crossover* (`cd03bd0e-26f4-49ad-b358-9800f58b2782`, Etsy primary: **active**) — the
   design prompt literally asks for a "GTA-like" street glow. Jev flagged it at 0.99. The
   title/tags/description are clean, which is why the denylist could never see it: only
   the design prompt carries the reference.
2. **Real marks and people the denylist has no entry for** — Indian Motorcycles,
   Reese's (x2), Dodge, a David Bowie tribute (x2, "Butchest Guy"), Iron Man, Hocus
   Pocus (x5), Road Runner, Cinderella (x2), a Quentin Tarantino riff (x2), Yogi Berra
   quotes. All drafts except the Chiefs youth tee and the Alice/Cheshire metal art.
3. **"Gridiron Glory: Youth Chiefs Tee" is ACTIVE on the storefront** (`15c6e672-…`).
   Green and gold, so possibly a local youth team rather than Kansas City — a human
   call, which is exactly what the gate routes it to.
4. **Jev agreed with the regex on 5 of 7 regex blocks** (Harry Potter, FIFA, 2x
   Argentina World Cup, Team USA). The 2 disagreements are both `supreme` — "Supreme
   Fitness Power" and a mushroom tee — i.e. the denylist's false positives, not Jev's
   misses. They stay blocked (regex is the floor).
5. **Noise to expect.** The low-confidence tail is mostly common-phrase riffs ("Keep Calm
   and …", "Straight Outta …", "Damn the Torpedoes", "Mountains Are Calling" — a public
   domain John Muir line). That is why these are `review`, never `block`: a human glance
   is cheap, a wrong auto-block is not.

## Decision policy (what the gate does with a Jev answer)

| Jev answer | Verdict |
|---|---|
| regex hit | **blocked** — Jev is not asked |
| `definite_brand_or_character`, confidence ≥ 0.80 | **block** (hold for human IP clearance) |
| `likely_ip_reference` or `definite_…` below 0.80 | **review** |
| `clean`/`generic_theme` but clean+generic probability < **0.80** | **review** (low confidence → human) |
| clean+generic probability ≥ 0.80 | pass |
| no answer / lane down | fail open to the regex result |

Mode is `JEV_IP_GATE` = `shadow` (default: computed + logged + shown on the candidates
panel, does not change pass/fail) · `enforce` (review/block hold the Etsy listing as
`blocked`) · `off`. Bar override: `JEV_IP_SAFE_CONFIDENCE`.

At the 0.80 bar on this catalogue, enforcement would hold **142 of 2,535** regex-clean
rows (5.6%): 17 block, 52 IP-flag, 73 low-confidence.

---

## New blocks — Jev is sure these name IP the regex missed (17)

Highest priority for David. Nothing was changed; each needs a keep / rename / pull decision.

| Product | Status | Etsy | Jev tier | Conf | Safe | Id |
|---|---|---|---|---|---|---|
| Neon City Tactical Soldier Crossover (Cinematic, Edgy) | active | primary:active, transfer:removed, download:removed | definite_brand_or_character | 0.99 | 0.00 | `cd03bd0e-26f4-49ad-b358-9800f58b2782` |
| The Legend of Indian Motorcycles | draft | — | definite_brand_or_character | 0.99 | 0.00 | `e3c75511-b51f-4fc6-80fc-05b06327a636` |
| Reese's Rest in Peace | draft | — | definite_brand_or_character | 0.99 | 0.00 | `58da3bb7-dddb-4390-bc00-768628715bde` |
| Wonderland Silhouette Metal Wall Art - Alice & Cheshire Cat | active | primary:removed | definite_brand_or_character | 0.98 | 0.00 | `095d4606-322b-4007-833e-2fc7cbf85326` |
| Big Dodge Truck Driver Pride | draft | — | definite_brand_or_character | 0.97 | 0.01 | `5918f70b-b611-4c44-9141-962c7e4ab81c` |
| Butchest Guy in Town | draft | — | definite_brand_or_character | 0.97 | 0.00 | `e79ea8a3-6e62-48f0-afd7-e91a8e2fc649` |
| Butchest Guy Tribute | draft | — | definite_brand_or_character | 0.97 | 0.00 | `02209a87-a742-487f-bbb2-5622e9413853` |
| Reese's RIP Peace | draft | — | definite_brand_or_character | 0.95 | 0.00 | `30da4bd6-2ec6-44c6-851a-6fea97276697` |
| Cinderella Can't Get This Ball | draft | — | definite_brand_or_character | 0.94 | 0.01 | `e612d318-bf17-42cd-b30f-e15d4dd6cea4` |
| Cinderella Volleyball Challenge | draft | — | definite_brand_or_character | 0.93 | 0.00 | `d1e79601-975f-4c88-b70c-6f80409a9036` |
| Game On Until It's Over | draft | — | definite_brand_or_character | 0.92 | 0.01 | `3b921b04-1452-460e-9caf-3eec89f90d3d` |
| Gridiron Glory: Youth Chiefs Tee | active | — | definite_brand_or_character | 0.86 | 0.02 | `15c6e672-83c3-42e9-a75d-743d6e837209` |
| Quentin's Quarantine Classics | draft | — | definite_brand_or_character | 0.86 | 0.05 | `026c363d-0cd2-4e62-bdb0-b65ec89dd743` |
| American Muscle on Wheels | draft | — | definite_brand_or_character | 0.83 | 0.08 | `0c9e5044-6357-4c3d-900e-c2d630ffa410` |
| Game On, Yogi Style | draft | — | definite_brand_or_character | 0.82 | 0.02 | `4b07cd15-4b89-4f85-8eef-094a2b11c7a7` |
| Directed By Quentin Quarantine | draft | — | definite_brand_or_character | 0.81 | 0.08 | `8c8b3ed0-2d68-45b2-9c39-04a3ff416e55` |
| Mountains Are Calling | draft | — | definite_brand_or_character | 0.80 | 0.09 | `d9e2cecd-46dc-419b-8920-36147318bff4` |

## New IP flags — likely paraphrases (52)

The class of miss the regex cannot see by construction.

| Product | Status | Etsy | Jev tier | Conf | Safe | Id |
|---|---|---|---|---|---|---|
| Iron Man - Strength Reigns | draft | — | definite_brand_or_character | 0.78 | 0.04 | `12b11950-28e2-42cc-8dd3-71904f024d97` |
| Santa's Extreme Holiday - Jet Ski Adventure Tee | active | primary:removed | definite_brand_or_character | 0.73 | 0.19 | `a47729e8-8b5c-4e7a-9d07-69c96afc773d` |
| Hocus Pocus Halloween Charm | draft | — | definite_brand_or_character | 0.62 | 0.18 | `6fde2549-18e1-46b2-aaad-0cbd7dedb437` |
| Witchy Hocus Pocus Vibes | draft | — | definite_brand_or_character | 0.55 | 0.04 | `6bdc9794-d883-4c35-8eac-e537410f961d` |
| Marines Protecting from Sea Monsters | draft | — | definite_brand_or_character | 0.54 | 0.32 | `75a7f486-6e96-4a7f-8419-013394162f35` |
| Flying Monkeys Warning | draft | — | definite_brand_or_character | 0.53 | 0.01 | `cd7efd7c-b729-4597-968c-9cf339e54037` |
| Hocus Pocus Vibes | draft | — | definite_brand_or_character | 0.52 | 0.28 | `af353f6c-44e3-470d-a17e-f99fe9a58cb3` |
| Defiant Patriot Spirit | draft | — | definite_brand_or_character | 0.52 | 0.21 | `efa93393-0649-41e0-bb56-c284db951f49` |
| Straight Outta the Gym | draft | — | likely_ip_reference | 0.50 | 0.22 | `a4c30a18-ff78-409e-a37b-9e9cf406e5f1` |
| Parkhill 4th July Parade | draft | — | definite_brand_or_character | 0.50 | 0.30 | `f272a709-4b6d-4294-b7b3-021948a36fbd` |
| Woman Hear Me Roar | draft | — | definite_brand_or_character | 0.48 | 0.20 | `f0d462a2-0e8f-4985-8c84-04530a0944ed` |
| Straight Outta Quarantine | draft | — | likely_ip_reference | 0.46 | 0.11 | `4f7ee872-0cdd-4254-9945-31daf450b819` |
| Fearless Female Rider | draft | — | definite_brand_or_character | 0.46 | 0.21 | `7f9dd4b3-b88b-4833-bb0c-15baa6dd4cd8` |
| Hocus Pocus Fun | draft | — | definite_brand_or_character | 0.46 | 0.31 | `5a4b4561-3b75-4dfe-b9bb-ca11a9fd4333` |
| Keep Calm and Call a Doctor | draft | — | definite_brand_or_character | 0.45 | 0.14 | `8faf9db4-7b6b-429e-9a85-cef5ad06d4fd` |
| It's Go Time at Mandelbaum's | draft | — | definite_brand_or_character | 0.39 | 0.32 | `c4d6f70a-68da-4c86-a391-21d01fd540c9` |
| Straight Outta Quarantine | draft | — | likely_ip_reference | 0.38 | 0.15 | `3e653940-b9f6-4db7-8600-bb22855ea6fc` |
| Hocus Pocus Halloween Bash | draft | — | definite_brand_or_character | 0.37 | 0.25 | `468194dd-cbb8-4138-bf46-96af424cff23` |
| Keep Calm Electrical Engineer | draft | — | definite_brand_or_character | 0.36 | 0.16 | `de28b541-70be-4b0b-89f3-c648e85a38ba` |
| Finish Him! Gaming Target | draft | — | definite_brand_or_character | 0.35 | 0.03 | `1bad3b41-0f1f-4820-93bc-f82bbe36c21c` |
| Catzilla Unleashed | draft | — | likely_ip_reference | 0.34 | 0.40 | `30a51c14-9e5a-4152-b7a3-f4064068ab81` |
| Big Mutts Love Confession | draft | — | likely_ip_reference | 0.33 | 0.22 | `e909c7a8-2ab2-4cd6-bbe6-c861c031413b` |
| Full Speed Ahead | draft | — | definite_brand_or_character | 0.32 | 0.37 | `f502b8b9-8c34-4497-a6ee-319ce50da681` |
| Flying Monkeys Unleashed | draft | — | likely_ip_reference | 0.32 | 0.03 | `56c18d22-b454-44e2-b504-60cad19e582d` |
| Start Strong Finish Stronger | draft | — | definite_brand_or_character | 0.31 | 0.43 | `d043d33d-9c57-4b14-a3f7-e4d52f964c08` |
| Keep Calm Electrical Engineer | draft | — | definite_brand_or_character | 0.30 | 0.18 | `3ee017b7-a24a-4709-b4c6-d2f903ebebad` |
| Full Speed Ahead Badge | draft | — | definite_brand_or_character | 0.29 | 0.40 | `57f2fbe4-9b3f-4d50-81e7-e8c9ee64cd4d` |
| Damn the Torpedoes | draft | — | definite_brand_or_character | 0.28 | 0.43 | `4f66c257-74c7-457e-b90d-c0d6ce31cecc` |
| Keep Calm and Eat Candy | draft | — | likely_ip_reference | 0.28 | 0.25 | `a1584849-abe8-4217-9964-c89744109eaf` |
| Beam Me Up Retro Sci-Fi T-Shirt / Unisex Pop Art Tee | active | transfer:draft, download:draft, primary:draft | likely_ip_reference | 0.27 | 0.27 | `212b53fa-59cb-4699-9e01-238742647fef` |
| Damn the Torpedoes | draft | — | definite_brand_or_character | 0.27 | 0.42 | `3b871a9f-6cb3-4597-ab24-a92d9f681dc9` |
| Road Runner Adventure | draft | — | definite_brand_or_character | 0.26 | 0.38 | `91443fec-5406-4ea3-a1a5-dc3e5f9b0988` |
| Princess Wears Motorcycle Boots | draft | — | likely_ip_reference | 0.26 | 0.49 | `b3047306-97b8-4128-a39f-79cb07e6e29e` |
| Better Call Dad! | draft | — | likely_ip_reference | 0.26 | 0.37 | `ede7d4bb-c339-4004-8d59-895fd7b38cf9` |
| Keep Calm I'm a Doctor | draft | — | likely_ip_reference | 0.25 | 0.29 | `46e3fb6a-3fed-4bfd-a078-b4ee3b29b33d` |
| Big Trucks Fan Club | draft | — | likely_ip_reference | 0.23 | 0.31 | `b96a89ec-9308-4da8-b31d-a6cc250e110c` |
| Keep Calm and Jam | draft | — | likely_ip_reference | 0.23 | 0.26 | `48b3bf53-25ad-4673-9964-ed6ab7af404e` |
| Something Wicked This Way Comes | draft | — | definite_brand_or_character | 0.22 | 0.44 | `c7caf994-46c4-4eee-b55f-f6b1cbdfe35a` |
| Bless this Land | draft | — | definite_brand_or_character | 0.21 | 0.51 | `7488bb42-bbfb-4fec-acb6-5cb55f072c79` |
| Witchy Trouble Brew | draft | — | definite_brand_or_character | 0.18 | 0.43 | `96158637-6d23-4899-8f05-ebcf781960d6` |
| Wicked Vibes Await | draft | — | definite_brand_or_character | 0.18 | 0.46 | `76e2cb24-5288-4ff8-b7f8-4c30268e828d` |
| Stay Positive and Quarantine | draft | — | likely_ip_reference | 0.16 | 0.35 | `b0e4628c-c057-4a05-9e37-67cb121d5961` |
| Ain't Nothing But a Quarantine | draft | — | likely_ip_reference | 0.16 | 0.39 | `4cde44bc-4c41-4640-8d6c-0405314163eb` |
| Gone with the Wind Rider | draft | — | likely_ip_reference | 0.15 | 0.30 | `d90834c1-df03-4b01-9120-8dec5554520e` |
| Keep Calm I'm a Gamer | draft | — | likely_ip_reference | 0.15 | 0.49 | `b87d19a4-d597-437a-b15a-d9ffbc6c2485` |
| Keep Calm and Quarantine | draft | — | definite_brand_or_character | 0.14 | 0.32 | `0b03686d-0dec-453e-9d6e-6020b0f0a360` |
| Candy Overload Vibes | draft | — | likely_ip_reference | 0.13 | 0.46 | `a57fd6f4-6c6e-47e1-bfc5-02af38702f20` |
| Keep Calm and Game On | draft | — | likely_ip_reference | 0.13 | 0.40 | `f43c9c5a-504f-4ecc-a00a-1e2f4d85d978` |
| Ain't Nothing But A Quarantine | draft | — | likely_ip_reference | 0.12 | 0.36 | `abad1888-779b-427c-ba82-049510f577b9` |
| Devils Are Here Halloween Tee | draft | — | definite_brand_or_character | 0.12 | 0.50 | `40389db9-b1fb-4d55-b7b2-47fa8bfd216d` |
| Keep Calm for Halloween | draft | — | definite_brand_or_character | 0.11 | 0.38 | `9c0198f6-9201-4a37-a32a-0b1b6903e4ac` |
| Spellbound Love Shirt | draft | — | definite_brand_or_character | 0.08 | 0.53 | `0306239e-4bcd-450a-9125-e22df54fcd41` |

## Low confidence — would be routed to a human (73)

Jev leaned safe but not by enough to auto-accept.

| Product | Status | Etsy | Jev tier | Conf | Safe | Id |
|---|---|---|---|---|---|---|
| Teach Me to Sing | draft | — | clean | 0.63 | 0.79 | `dae9a882-9fe1-4a85-a545-2bdcc9d1e824` |
| Mindset Matters | draft | — | clean | 0.62 | 0.76 | `3500b03e-8d4b-4803-a70d-a17bd8757c5e` |
| Expect Great Things Running Tee | draft | — | clean | 0.61 | 0.77 | `c27892ec-44ba-4e57-9ea6-e43b849195a8` |
| Daily Shitstorm Survivor Club Tee - Muted Emblem | active | primary:removed, transfer:removed, download:removed | clean | 0.60 | 0.75 | `0f787865-7bd9-4cdf-914a-3decf2c3eaaf` |
| Live Laugh Heal | draft | — | clean | 0.59 | 0.80 | `9022ad72-62a7-48b4-b07b-fc26e07177a0` |
| Nothing Gives More Than A Mask | draft | — | clean | 0.59 | 0.79 | `35fa353d-fde4-4788-86a7-cf171d6bc9a7` |
| Ride for Happiness | draft | — | clean | 0.57 | 0.77 | `531d8de3-9512-42a4-98d3-b71dd9248a8b` |
| Runs With Scissors | draft | — | clean | 0.55 | 0.73 | `3c6f357e-f66d-43bb-be16-034fcc12d112` |
| Never Stop Music Vibe | draft | — | clean | 0.55 | 0.71 | `b3bed636-767b-4215-b2d4-fbab1b0b019c` |
| Never Stop Music Vibes | draft | — | clean | 0.54 | 0.71 | `09386f7b-d4b9-406d-8296-d1b4c1116e7e` |
| Let The Music Play | draft | — | clean | 0.53 | 0.77 | `2851bd1a-df43-474e-9cb5-b7a28dfc1c1c` |
| Optimism Is a Force Multiplier | draft | — | clean | 0.52 | 0.75 | `86a0c11e-d361-49ab-9fb2-4c9229087248` |
| Engineer Trust Emblem | draft | — | clean | 0.52 | 0.72 | `032682ea-7e4e-486c-a7cb-201b51e9c8c9` |
| Power and Responsibility | draft | — | clean | 0.52 | 0.77 | `3421180a-d916-4b0b-85a6-4b2bba1dc3b8` |
| One Nation Under God | draft | — | clean | 0.50 | 0.76 | `8a3bd53d-4e23-4d22-bc16-8e9ec147811b` |
| Great Things from Yourself | draft | — | clean | 0.48 | 0.70 | `69c36a80-7e6f-41ea-8126-2efed6d7ab1b` |
| Create Your Future Fitness | draft | — | clean | 0.48 | 0.67 | `59160530-2a05-49cd-8f82-4899caba3207` |
| Excuse My Dear Sally | draft | — | clean | 0.47 | 0.71 | `ceb4571f-cdd6-4285-b2a9-0a5c699e30fa` |
| Great Thoughts in Motion | draft | — | clean | 0.47 | 0.68 | `d565ea85-a2eb-4d6c-9fa4-54977ca0e66b` |
| Fatal War Will | draft | — | clean | 0.47 | 0.77 | `0ccd914c-8da1-4642-abdf-4e089be1c282` |
| Golf Is A Good Walk Spoiled | draft | — | clean | 0.47 | 0.70 | `cb56984d-caab-441e-bc26-68f4ae715a2b` |
| Unstoppable Teacher Vibes | draft | — | clean | 0.46 | 0.71 | `e4f6ca7d-5c9f-4847-bc98-90617bbe9583` |
| Fourth of July Design 046 | draft | — | clean | 0.46 | 0.73 | `3ef22f7f-bd76-4fea-89ab-297bceed8c42` |
| Dream It, Conduit It | draft | — | clean | 0.46 | 0.67 | `7194616c-e671-4ba9-9e2b-50ae44d67adb` |
| Strength in Challenge | draft | — | clean | 0.44 | 0.65 | `85ce5c37-69f6-4293-9714-a438d524dc15` |
| Run Through Any Weather | draft | — | clean | 0.44 | 0.73 | `96587068-839f-4600-9132-c0b4a0ceca65` |
| Zombie Apocalypse Marine Support | draft | — | generic_theme | 0.44 | 0.79 | `0a96c979-7d8d-4f42-95d2-99aeaf0279a8` |
| Power and Responsibility | draft | — | clean | 0.43 | 0.70 | `3cdd1029-2ca0-4e65-b73f-8e00e600e0cb` |
| We the People Always | draft | — | clean | 0.43 | 0.74 | `9fa7ea9a-9f0c-470b-880e-7ca182487e98` |
| Be Unforgettable on the Court | draft | — | clean | 0.42 | 0.61 | `8b2a0edb-983f-466f-ab4e-5722ef84f39f` |
| Nurses Save Lives with Style | draft | — | clean | 0.42 | 0.66 | `cd245a4a-c43c-4917-b433-2f6e43c4ec96` |
| Don't Stop the Beat | draft | — | clean | 0.41 | 0.76 | `ad03456f-a417-4452-958b-4ed60d154bde` |
| Air Force Mom Wings | draft | — | clean | 0.41 | 0.77 | `8b9da2bc-3250-4b80-835f-e628835ed8cf` |
| God Created Beer for Marines | draft | — | clean | 0.40 | 0.68 | `b4e5469b-358d-4670-b65c-e0fd97925ed9` |
| Dream It, Conduit It | draft | — | clean | 0.38 | 0.60 | `283541a6-4b8d-4a40-8f9f-c602ae5b83e6` |
| Essential Music Vibes | draft | — | clean | 0.36 | 0.63 | `dd3d3b83-bb11-4932-90f0-83a0f9f5f555` |
| Fatal to Enter a War | draft | — | clean | 0.36 | 0.64 | `d6b5c390-720a-4ea5-be2b-55c5b10c9a19` |
| Pledge of Allegiance Pride | draft | — | clean | 0.36 | 0.62 | `48745174-2d1d-45b3-b2ca-bef742732e76` |
| Up With The Sun Ride | draft | — | clean | 0.34 | 0.70 | `36e09c68-ebca-4260-aa8a-cd251e6f81fe` |
| Achievement Unlocked: Fatherhood | draft | — | clean | 0.34 | 0.78 | `ed873ffc-e7ac-48c8-9dc3-0831e691a5b8` |
| One Nation Under God | draft | — | clean | 0.34 | 0.67 | `fa123720-5a5c-4719-9355-d7dac58a2a7b` |
| God Bless America Celebration | draft | — | clean | 0.33 | 0.66 | `0adad92b-8f5e-4168-a8c1-c6e003fb2e38` |
| Don't Stop the Music Vibe | draft | — | clean | 0.32 | 0.71 | `ac1f9733-a430-4696-ac84-c8c18bab1d8e` |
| Power and Responsibility | draft | — | clean | 0.32 | 0.62 | `51773c0f-56e2-40fa-9b6e-cbfb08e0c91b` |
| Fear the Electrician | draft | — | clean | 0.32 | 0.63 | `3d3195bc-5631-48c0-b8c4-88a32ee7faf1` |
| Ignite Your Volleyball Passion | draft | — | clean | 0.30 | 0.53 | `88c0f029-33fe-4c19-9f2d-841eb4ade998` |
| Proud Marine Warrior Spirit | draft | — | clean | 0.30 | 0.66 | `37964cd5-d9a1-461a-ab8e-9862caaa7663` |
| Dog Lovers Unite | draft | — | clean | 0.30 | 0.62 | `d5855910-2d05-4f9f-b71f-60b292c1fbfb` |
| Big Trucks Fan Club | draft | — | clean | 0.29 | 0.59 | `a1b839c8-05c4-48a7-9955-cb219d8fb282` |
| War Is Hell Soldiers | draft | — | clean | 0.29 | 0.78 | `1ab28ab7-3dad-47c4-aa18-de60bfa20a4a` |
| Nervous but Hungry Motivation | draft | — | clean | 0.28 | 0.50 | `19e55f2c-8c31-4f48-bff8-389810d471d4` |
| Seniors Quarantine 2020 | draft | — | clean | 0.28 | 0.79 | `0fa57f37-e65e-4a0f-a53b-69c05a38ab44` |
| Cat Lives Matter | draft | — | generic_theme | 0.27 | 0.73 | `38fac576-57cb-4200-8c6c-ac5a775fdf1e` |
| Five Billion Star Hotel | draft | — | clean | 0.27 | 0.67 | `404da592-4718-457a-8ac5-7916adfd2433` |
| Love and Sisterhood | draft | — | clean | 0.26 | 0.49 | `4085f58d-6be7-4278-9ce1-477265aebbcc` |
| Viking Gym Strength Design | draft | — | generic_theme | 0.25 | 0.64 | `6f6cd860-d9c7-47d2-8d6e-a1650d204853` |
| Power and Responsibility | draft | — | clean | 0.25 | 0.52 | `8245fa23-e523-4683-9373-1127920cd562` |
| Liberty and Pride Unleashed | draft | — | clean | 0.25 | 0.68 | `72691ecd-63e7-4440-a81f-f47778856055` |
| Air Force Mom Power | draft | — | clean | 0.24 | 0.67 | `fb0d50ed-f85d-427a-9bc5-cd7f7d3315e4` |
| Devils Are Here Halloween Tee | draft | — | clean | 0.23 | 0.56 | `acdb05aa-357c-4d5a-bc77-a9b2ee592880` |
| Classic Gamer Achievement | draft | — | clean | 0.23 | 0.75 | `49fe4e33-b3cd-427b-bf80-d93c1fd51cce` |
| Spooky Spellbinding Night | draft | — | generic_theme | 0.20 | 0.58 | `8b4ae062-8d2e-4c42-91bb-b453ebed5d20` |
| Freedom for Schrödinger's Cat | draft | — | clean | 0.20 | 0.73 | `fe921c66-1e32-430c-967f-6a2456aecbe4` |
| Strength in Unity | draft | — | clean | 0.19 | 0.47 | `7cf0bc8c-c17a-4466-9a84-fd38b4b127fc` |
| Keep Calm and Game On | draft | — | clean | 0.19 | 0.56 | `ceaec62d-cf37-4246-8bd4-0e2bcdc86fea` |
| Power and Demand Wisdom | draft | — | clean | 0.19 | 0.45 | `3559fb2f-50fc-4283-bca7-59d95ca028f5` |
| Bleeding Black and Gold | draft | — | clean | 0.19 | 0.59 | `29425fdc-641a-4d62-a28a-d4f1590ceaf3` |
| Nervous and Hungry Vibes | draft | — | clean | 0.16 | 0.40 | `d42803ef-c536-4918-b209-a4923024a7e7` |
| Virtual Warfare Forever | draft | — | clean | 0.16 | 0.55 | `f82665ec-f5f7-4f4e-bbf9-54ddb17f3e5d` |
| Chill for Halloween Vibes | draft | — | clean | 0.15 | 0.54 | `78acaabe-1ced-457a-898b-5ab3d522e688` |
| Feeling Good to Be American | draft | — | clean | 0.15 | 0.41 | `25361d20-75cc-41e8-b0ac-7ad1156588c8` |
| Spellbound Romance | draft | — | clean | 0.13 | 0.55 | `728d5942-bc70-4ee8-b0f4-e06f6a79e6d3` |
| Wanderer in Nature's Paradise | draft | — | clean | 0.11 | 0.47 | `71b395a6-2102-475d-be44-c7b050034469` |

## Regex-only blocks — Jev disagreed (2)

Regex stays authoritative. Listed so false positives in the denylist can be spotted.

| Product | Status | Etsy | Jev tier | Conf | Safe | Id |
|---|---|---|---|---|---|---|
| Supreme Fitness Power | draft | — | clean | 0.86 | 0.97 | `bfe48d67-44d8-440c-8c24-a1773c8b0cdd` |
| Mystical Mushroom Forest Tee | draft | — | clean | 0.38 | 1.00 | `0e87c75b-0f29-46a4-9d3e-d970eca15e06` |
