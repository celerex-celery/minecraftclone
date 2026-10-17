# Changelog

## 1.2 — The Save & Quality Update

### Added

- **Thrown ender pearls.** A pearl is not a dropped item you pick up: it is a
  small projectile that flies, lands, and takes the thrower to where it landed for
  5 half hearts. The flight is the real one, because a pearl's range *is* the
  mechanic:
  - stepped at exactly twenty ticks a second, since the drag figure is per tick
  - the documented 1.5 blocks a tick of launch speed
  - gravity **derived from Minecraft's two published ranges** rather than guessed:
    27.7 blocks straight up gives v²/2g = 27.7 and 51.5 forward gives v²/g = 51.5.
    0.041 is the better of those two and lands at 26.7 up and 54.3 forward, with
    the optimum at 41 degrees, which is the angle the game quotes. Drag is 1.0, and
    that is not an oversight — the same two figures are only reachable with an
    undamped arc, and a per-tick 0.99 costs a third of the speed over the forty
    ticks the flight lasts
  - acceleration, then drag, then position, in that order
  - a small random cone on direction and speed, so two throws from the same spot
    do not land in the same place
  - the thrower's own velocity added, so a throw mid-jump goes further and one
    thrown while falling falls short
  - motion sub-stepped within each tick, because at 1.5 blocks a tick a pearl that
    only checked where it ended up would pass straight through a one block wall
  - consumed as it leaves the hand, so dying in flight loses it, and a one second
    cooldown enforced separately from the quarter second every other item shares

  Two real details: the **teleport makes no sound at all** and only the damage's
  small fall thud plays, and a pearl entity is **not destroyed by lava**, so
  throwing one into a lake drops you at the bottom of it. A pearl that lands in a
  portal takes the thrower through, which is the real way to move between
  dimensions without one. The 5% endermite roll is deliberately *not* implemented:
  there are no mobs yet, so it would be a number going nowhere

- **A stale-code warning.** A tab that has been open for an hour keeps running the
  modules it loaded an hour ago, and `no-store` on every response cannot help — it
  only governs the next fetch. The symptom is always the same and always
  confusing: an error about a property that plainly exists in the file, or a
  feature that does nothing. The page now asks the server what it last modified
  and, when the answer has moved on, says so in the console and puts **RELOAD** in
  the tab title until you do

### Fixed

- **Two crashes, both from destructuring off the wrong object.** `Interaction`
  holds a game and a target; it has no `player`, no `world` and no `inventory` of
  its own. The bucket path and the new pearl throw both did
  `const {player, world, inventory} = this`, got three undefineds, and threw on
  first use. That is the second time that exact mistake has been made in that
  file, so all three sites read from `this.game` now and the reason is written at
  each one
- **`t is not a function` while mining underwater.** `tickMining`'s parameter was
  named `t` for the block target, which shadowed the imported `t()` translation
  function, so `t('hud.underwaterSlow')` called the *block* as a function. It only
  fired on the first mining tick after the player's head went under water, which
  is why it sat there so long. The parameter is `target` now

- **Giant cliffs.** The ground runs from about y = 6 to y = 70, and the two
  directions get **different curves on the same field**, which is the whole shape
  of the dimension. Upwards the curve is under 1, so the field spreads out and the
  high ground rises gradually into broad terraces; downwards it is over 1, so the
  field squeezes together and the low ground is *rare and deep* — a handful of
  large chasmos rather than a third of the world sagging. A single symmetric curve
  can only give one of those, and the wrong one is a dimension with a film of
  orange over everything
- **A short steep component on top**, because a field with a hundred and forty
  block wavelength can only ever make slopes. This one is about thirty blocks
  across and fourteen tall, which is what actually puts walls in the terrain, and
  the terracing turns those walls into eight-block ledges
- **Giant lava pools, measured rather than guessed.** One lava level runs across
  the whole dimension, so every hollow below it joins up with its neighbours, and
  the level was picked by sweeping it and measuring:

  | level | surface under lava | largest sea | ground walkable |
  |-------|--------------------|--------------|----------------|
  | 21    | 7%                 | 6,700        | 86%            |
  | **26**| **15%**            | **32,000**   | **72%**        |
  | 34    | 28%                | 60,000       | 52%            |

  26 is the knee: a lake roughly 180 blocks across, with most of the dimension
  still land you can stand on. It is one number in `CONFIG.NETHER.LAVA_SEA_Y`;
  raise it for a more volcanic dimension, lower it for a survivable one

### Fixed

- **You could not place or break anything, and the selection outline sat in the
  air.** Both are the same line. The ray that decides what you are looking at
  tested `def.cutout` as "something the player can click", and `cutout` had
  quietly always been `undefined` — so the clause was dead code and nothing was
  wrong. The registry fix made the flag real, and air and the two liquids carry
  it as well as the plants and the glass do, so the ray immediately started
  stopping on empty air before it reached anything. `cutout` is a *rendering*
  flag and was never the right signal: air and liquids are now excluded, and
  `farmland` — the one block that was solid-less, cut-out-less and therefore
  invisible to the ray, the block you quietly could not break — is marked as the
  flat alpha-tested layer it actually is. A test now asserts that *no* block in
  the registry is unreachable
- **`cactus_bottom.png` 404'd at boot.** The cactus was given a bottom face this
  changelog's length and the file was never added to the copy list, so the game
  asked for a texture that was not there
- **`assets/sounds/undefined.ogg` on every track.** The credit refactor built
  each entry as `{author, name, title}` and dropped the `path` field it had
  carried, so every track resolved to a file called `undefined.ogg`. The path is
  part of the entry again, and the sound engine's preload was run against a
  stubbed fetch to confirm nothing in the manifest resolves to nothing

### Added
- Advancements, the way the real game does them: a tree of conditions grouped into Survival / Building / Combat / Misc tabs, an Advancements screen in the pause menu, and an "Advancement Made!" popup in the top right with the icon, the title and the description. Twenty-eight of them, all triggered by things this build can actually detect — Getting Wood, Bake Bread, A Balanced Diet, Sticky Situation, Getting an Upgrade, Isn't It Iron Pick, Acquire Hardware, Diamonds!, Suit Up, Cover Me With Diamonds, Survive the Night, A Three Day Hunt, Stone Age, Benchmarking, Build a Home, Time to Mine, A Seedy Place, Hot Stuff, Bucketful of Cold, We Need to Go Deeper, Country Lode, Smelt It, Adventuring Time, Adrenaline, A Close Call, Living on a Breadline, A Complete Catalogue, and the Minecraft root. Children only unlock once their parent is earned, and progress is saved per world
- Statistics, with the four tabs the real game has that this build has anything to show for — General, Blocks, Items and Game Stats. Game time, days played, time since last death, deaths, distance walked / sprinted / swummed / fallen / flown, every block mined and placed, every item used / crafted / broken, jumps, commands run, times entered water, and the world and session counts. Distances are counted in centimetres and formatted the way the real game does, switching to two decimal places in kilometres past 1000m, and the per-type lists are sorted biggest first
- Statistics live in one module that the advancements also read, instead of two sets of counters drifting apart
- Mob Stats is deliberately left out of the statistics screen: there are no mobs, so it would be four empty columns
- Water and lava flow. A liquid spreads sideways and falls, thinning as it goes, and drains away again when you plug the hole it was escaping through. Flow depth is stored per cell and the mesher uses it, so a spreading river really is shallower at the edges. Lava meeting water turns it to stone, flowing lava to cobblestone
- Buckets work: right click with a filled one to pour, right click a liquid to scoop it back up. Endless ocean sources are left alone so they cannot be drained
- Dropped items burn up in lava and are destroyed by touching a cactus
- Dying scatters everything you were carrying across the ground as dropped items, on a golden-angle spiral so the piles land apart from each other instead of merging into a few entities at your feet
- Sand and gravel now animate down instead of teleporting to the floor — the block is drawn as a free-floating entity that accelerates under gravity, and only commits to the world when it lands. The column stays open while it falls, like the real game
- A missing atlas tile now logs a warning instead of silently drawing as bedrock
- Damage tilt — the view leans and dips when hit, flipping direction each time so a run of hits wobbles instead of jamming
- Hurt sounds, which were written into the audio engine but never triggered: generic hits, a soft and a hard fall landing, and a bubble while drowning
- Settings are loaded at boot

### Changed
- Stack amounts are now drawn on every stack, including a single item, and in the creative palette too. The real game hides a lone "1", but at this slot size that leaves you counting slots to find out what you have
- Item icons are drawn at their native 16px and displayed at 16px with nearest-neighbour scaling, in the inventory, the hotbar and the advancements. They were the one canvas missing `image-rendering: pixelated`, so a 24px draw squeezed into an 18px box was being smoothed and looked pale and blurry
- Autosave every 10 seconds instead of 45, and on entering a world, pausing, going to the title, and hiding or closing the tab. A save that finds nothing changed skips the encoder entirely, so the short interval costs nothing while you are standing still
- A background save that fails now says so on screen instead of only writing to the console
- New survival worlds start with an empty inventory, so you have to punch wood and craft your way up. Respawning and loading a save still keep what you were carrying
- Mouse sensitivity now runs 1-15, default 3 — the old range needed thousands of pixels for a full turn
- Double-tap sprint, like the real game: the first forward press is remembered for 7 ticks and a second press inside that window latches sprint on. Sprint holds while you keep moving forward and stops when you stop, turn or sneak. The sprint key still works and always wins
- Settings writes are debounced, so dragging a slider no longer writes on every pixel

### Fixed
- The crafting table and furnace panels were headed with a key that exists in no language file, so the title rendered as the raw text `container.furnace`. Vanilla titles are "Crafting" and "Furnace", so those are the keys used now, and `container.furnace` is translated in all three languages
- Hotbar items looked washed out. The hotbar frame is a translucent grey bar and it was painting on top of the item icons, because the slots, the frame and the selection are absolutely positioned siblings with no stacking order. The frame now sits behind the items, with only the selection outline on top
- Hotbar icons and the hotbar frame are smooth-scaled rather than pixelated. The HUD is scaled by `scale(var(--gui))`, and nearest-neighbour at a fractional scale stretches some source pixels to 2px and some to 1px, which reads as lumpy. The frame and selection also had to opt out of the global `img` rule, which is `pixelated`
- Fences used the wrong texture and rendered as bedrock: the blocks asked for `oak_fence_post` but the texture generator produced `oak_planks_fence_post`, and the atlas falls back to its first tile for any name it does not know
- Every entry in the statistics Mined and Placed lists read "air" — `Blocks.label()` takes a numeric id and quietly answers "air" for anything it cannot find, and the statistics screen was passing it a block name. Added `Blocks.labelOf(name)`, which shows an unknown name rather than pretending it was air
- Dying used to hand out Adrenaline and A Close Call, because the health record was a running minimum and the death blow dragged it to zero. Only a dip you lived through is recorded, and respawning clears the run
- Statistics gained a search box over the block and item lists, with a separate "no matches" message
- Fence textures no longer look smeared — they are simply the plain planks sheet, because the mesher maps a whole tile onto each face and a 16-pixel post texture cropped to 4 pixels was being squashed onto a 4-pixel-wide face
- Falling blocks were drawn half a cell off, because the mesh was centred on the cell even though its geometry already spans a full cell
- Falling sand and gravel left a column of pitch-black air behind them, because the vacated cell was cleared with its lighting update suppressed
- Sand and gravel that landed on the floor vanished, because landing re-queued them and the settle pass cleared them again with nothing left to restore them
- Gravity now runs before lighting and meshing, so a block that lands in a frame is picked up by both in that same frame
- Red damage flash lagged behind the hit, because a CSS transition was fighting the per-frame opacity it was being driven by
- Settings never persisted — they were written to IndexedDB but never read back, so every option reset on reload
- World list — meta line passed one object instead of five values, causing `[object Object]` to display; now correctly formatted
- World list — long names or seeds caused buttons to be pushed off-screen; columns now stay within their allocated space

### Removed
- Game mode / difficulty line above the hotbar for a cleaner heads-up display

---

## 1.2 — The Deep World & Spectator Update

Preceded by the save and quality work below.

### Added — the world goes down

The bedrock floor is no longer the bottom of the world at y = 0. It is now at
**y = -128**, and block coordinates are signed, so y = 0 is 128 blocks above the
floor rather than being the floor. The build ceiling rises with it, to y = 191,
for a total column height of 320. That leaves **190 blocks of stone under sea
level**, against 63 in the real game, and it is where everything below lives.

Making y negative is not only a bounds check: the block arrays are indexed from
zero, so every index calculation in the engine now subtracts the floor. Chunk
indexing carries the offset in one place, `Chunk.idx`, and the light engine —
which does its own index arithmetic for speed — carries the matching one beside
it, `Lighting.li` and `Lighting.lay`. The height map became a signed 16-bit
array, because a column's top can no longer be assumed non-negative.

- **Deep caves.** Three things hollow out the rock now. The original long
  wandering tunnels are still there, sampled on a coarse lattice and
  trilinearly interpolated between samples, which is what the real game does
  for the same reason — a noise call per voxel over a 320 tall chunk is far too
  slow, and sampling too finely also makes caves look like noise rather than
  tunnels. Above that sit rare cheese chambers, and below y = 8 a third, much
  larger and slower field carves the very large caverns that make the bottom of
  the world worth digging to. The threshold falls with depth, so the deepest
  layers are genuinely hollow instead of uniformly solid
- **Vertical shafts.** Two 2D noise fields whose zero sets intersect give long
  narrow columns running the depth of the world — the same intersection trick as
  the tunnels, run down y instead of through it. Find one and you can drop a very
  long way
- **Ravines, built the way the real game builds them.** A grid of 64 block cells
  decides whether the network passes through a cell at all, from a smooth field
  so ravines form connected runs and then just stop, rather than appearing as
  isolated trenches. Within a cell the path runs from one corner to the opposite
  corner, either straight across or via one or both sides, and *which* route a
  cell takes is a function of the corners rather than of the cell — so all four
  cells meeting at a corner agree on where the network passes through it, and
  segments join instead of overlapping. Corners are nudged off the exact grid
  point by a hash of their own position, which is what gives ravines their
  wandering shape. The carved tube is an ellipse whose half width is 2 to 5
  blocks and half height 2.5 to 7, tapering at the ends so a ravine fades out
  rather than stopping dead, with a centre line that rises and falls along its
  length. Endpoint heights are skewed low but the range reaches above the
  surface, so most ravines run deep underground while the occasional one breaches
  a hillside — the cave mouths the real world is full of, and how you get
  underground without a pickaxe
- **Ravines are seamless across chunk borders.** A segment's distance from a
  column and its height there are both constant down that column, so the carved
  y range is worked out once per column and the block loop only compares against
  it. That is what makes ravines affordable at this world height — the wander
  noise is sampled once per column instead of once per block
- **A ravine that takes the surface takes the plants with it.** Nothing is
  planted on a column whose top is now a hole, and that is asked of the noise
  rather than of the chunk's own blocks, or a tree near a border would be planted
  on one side of it and not the other

### Changed — stone, bedrock and the floor

- **Deepslate now reaches up to y = 0 with a ragged boundary.** Below that it is
  the only stone, above it plain stone, and the boundary between them is a noise
  line rather than a flat one so the two stone types interlock. The old version
  had deepslate appearing in isolated blobs in the lowest 26 blocks, which read
  as a mistake rather than a stratum
- **The bedrock floor is a real floor.** A solid slab at y = -128, a rough layer
  of 5 blocks above it that thins as it rises, and then scattered pockets out to
  y = -106, so the bottom of the world is blotchy the way the real one is instead
  of a single hard line with a couple of stray blocks
- **A flat world stays flat.** A flat world's interior is plain stone rather than
  deepslate, so the Create World flat preset is still the clean building plane it
  was

### Added — ore is placed like the real game

Ore was previously a threshold on a noise field, which is why it never looked
like a vein. It is now placed the way the real game places it, and the eight
ores use the vanilla vein counts and sizes.

- **Veins are random blobs, not noise.** Each vein picks a seed cell and a
  height, places a block, then walks a short random walk placing more, with a
  loose cloud scattered around each step. The result is a lumpy clump with an
  irregular outline — a line with a cloud around it, not a row and not a sphere.
  Blocks that land in air, in a cave, in bedrock, or in a higher priority ore are
  skipped, which is the rule that makes a diamond vein sit *inside* stone rather
  than hang on a cave wall
- **The depth distribution is vanilla's.** Each ore has a triangular
  distribution centred on y = 0 that is constant once it is deep: a diamond vein
  is 1 to 5 blocks, most likely at y = 0, never above y = 16, and equally likely
  at any depth below y = -16. That is why mining at y = -60 beats mining at the
  bottom of the world, and it is the behaviour the vanilla numbers encode
- **Veins are seamless across chunk borders.** Veins are generated for a chunk
  and all eight neighbours, and only the parts landing inside the chunk are
  written. A vein straddling a border comes out identical on both sides, which a
  chunk-local placer cannot do — the old version had ore that stopped dead at
  every chunk edge
- **Diamond.** Two veins of 1 to 5 per chunk rather than vanilla's one of 1 to
  8: enough that the extra depth pays off, and the average vein is smaller than
  the real game's rather than larger. The bottom of this world is at y = -128
  against vanilla's -64, so the deep band where diamonds actually live is about
  100 blocks tall here instead of 75 — more of them overall, not a bigger prize
- **The other seven ores**, at their vanilla counts and sizes: coal 20 veins of
  up to 17, copper 8 of up to 22, iron 9 of up to 9, redstone 4 of up to 8, gold
  1 of up to 8, lapis 1 of up to 6, emerald 12 single blocks gated to mountain
  biomes. Copper in particular was registered as a block and never generated, so
  it could be picked up by the ore-related advancements and never obtained
- Ore depth limits are stretched to reach this world's deeper floor, so the
  lowest ores are actually in the lowest stone rather than clustering in the
  shallows

### Added — spectator mode

`/gamemode spectator` only. Spectator is deliberately **not** in the Create World
menu, which is where the real game hides it too.

- **No hitbox.** A spectator passes straight through terrain — nothing it walks
  into exists, so it can go inside a mountain and come out the other side
- **Instant flight.** Movement input is taken as velocity directly, with no
  acceleration curve and no gravity, so it starts and stops on the same frame.
  Jump climbs, sneak sinks, both at the spectator's own speed
- **Cannot mine or place.** It has no target at all, so there is nothing to
  break, put down, or open
- **Immune to the survival rules.** No hunger, no damage, no drowning, and the
  bars stay full — the hearts, hunger and experience bars are hidden outright,
  exactly as they are in creative
- **No hand.** The view model is not drawn, because a spectator has no body
- The mode is remembered in the world record, so a world left in spectator comes
  back in spectator

### Added — deepslate ores

Below y = 0 the whole ore set swaps over, the way the real game does it. Vanilla
does not leave stone-coloured ore sitting in dark rock, and neither does this
now — an iron vein is an iron vein whichever rock it is embedded in, and it looks
like it.

- **All eight ores now have a deepslate variant**, registered as their own blocks
  with their own texture, their own hardness (4.5 against stone ore's 3.0, which
  is the vanilla ratio) and the same drops: deepslate coal, copper, iron, gold,
  redstone, lapis, diamond and emerald
- **Which form a vein block takes is decided by the block it replaces, not by its
  own height.** That is what makes the transition gradual for free: the deepslate
  boundary is already a noise line, so a vein straddling it comes out half one
  ore and half the other, exactly as it does in the real game, rather than
  switching over at a hard y
- The deepslate ores carry the vanilla `deepslate` dig and step sounds, because
  the sound engine's material map keys off the block name
- The five deepslate ore textures this asset pack was missing — coal, copper,
  emerald, lapis and redstone — were copied out of the vanilla client pack, and
  added to `tools/copy-assets.ps1` so the sync script stays the source of truth
  for what the game ships
- Deepslate copper is the first copper texture this build has had: the plain
  `copper_ore` block has always borrowed the iron sheet, because the pack has no
  copper one

### Added — cave pools and moss

Caves are no longer uniformly bare rock. Lava lies in the deep, water lies in
the middle depths, and the deepslate floors grow moss — but all three are rare,
and none of them contradict each other.

- **Lava pools**, filling hollows in the deep. A pool's depth comes from the same
  field that decided it was there, so a stronger basin gets a deeper lake, and
  the fill is capped at 6 blocks, which is what puts a shallow lake at the bottom
  of a tall cavern rather than filling the cavern
- **Water pools** in the cave band above the lava, same rules
- **Lava gets commoner the deeper it is**, which is how it behaves in the deep of
  the real world — the threshold falls as the floor goes down, so the bottom of
  the world is a lot more lava than the layer above it
- **Neither liquid is constant.** Presence comes from a deliberately
  low-frequency field, so a pool fills one whole basin and most hollows get
  nothing at all. A higher frequency would put a puddle in every third cave,
  which is not what a cave in this world looks like. Measured over a 3×3 chunk
  area on four seeds: 216 to 387 lava blocks and 6 to 1761 water blocks per
  chunk, so a given region swings a lot with the seed, which is the point
- **Water is never next to lava, and that is structural rather than filtered.** The
  two live in bands with a guaranteed gap: a liquid can only sit in a pocket no
  taller than the fill depth, so the deepest a lava pool can rise is y = -18 while
  the shallowest a water pool can sit is y = -12. Six blocks of solid rock always
  separate them, so no amount of seeds produces a player finding water lapping at
  the edge of a lava lake. Verified at zero across 16 chunks
- **Both bands are placed where caves actually are**, not where they read nicely.
  The cave field is depth biased, so hollows are concentrated below about y = 25
  and a water band any higher would find almost nothing to fill. The first cut at
  y = 24 produced no water at all, which is what moved them
- **Moss patches** on deepslate floors below the stone boundary, at most two per
  column so a deep cave gets scattered green rather than a lawn. It stops at
  about the same place the dark rock does, because the stone/deepslate boundary is
  the same noise line. Vanilla breaks moss with a hoe; there is no hoe in this
  build, so the block declares the tool for accuracy and it simply never matches
  anything the player can hold
- Moss and pools are decided per band rather than taking the topmost hollow in a
  column. Taking the topmost one finds the shallowest cave, which in this world is
  never deepslate and is in neither liquid band — so both the lava pass and the
  moss pass would have had nothing to work on. Scanning per band is what lets one
  column hold a shallow cave, a lava lake far below it, and moss on the floor of a
  third hollow between the two
- `moss_block` is registered as a placeable block, so it shows in the creative
  palette and breaks like anything else. Its texture was missing from the asset
  pack, so it was copied out of the vanilla client pack and added to
  `tools/copy-assets.ps1`
- Ore no longer overwrites a moss floor, because a vein only replaces stone and
  deepslate
- Generation cost: 5 to 9 ms per chunk across four seeds, with the pools and moss
  pass landing in well under a millisecond of that

### Fixed — lag spikes

The periodic stutter was the autosave, and it got worse with the deeper world
because both of its causes are proportional to how much of the world exists.

- **The game considered itself changed forever.** The save timer asked the flow
  sim how many cells it still had queued, and any world with a liquid in it had
  a non-zero answer for the rest of time — so every 10 seconds the whole world
  was walked and re-encoded whether the player had touched anything or not. The
  sim now reports whether a liquid cell has actually been *written* since the
  last save, which is the question the save timer was really asking, and a
  standing-still world is now genuinely still
- **Every chunk you had ever built in was re-encoded on every save.** A chunk
  that has been edited and then walked away from is parked in memory, and a save
  record replaces the previous one wholesale, so every parked chunk has to be in
  it. But a parked chunk cannot change while it is parked: it only changes by
  being edited, and editing it means loading it, which takes it out of the map.
  So one that has already been written once is now skipped, and the set of
  written chunks is cleared again when a chunk is re-parked with fresh edits.
  Before this, walking a long way and building as you went produced a save cost
  that grew without limit — and at 320 tall each parked chunk is 80KB of
  retained memory as well, so it was 80KB per chunk of history
- Both of these were pre-existing bugs rather than new ones; the deeper world
  simply multiplied them by two and a half, which is why the stutter only
  became noticeable now

Chunk generation, lighting and meshing are already deadline-budgeted, so
streaming work cannot overrun a frame by more than one chunk. Generation itself
measures 5 to 9 ms per chunk across four seeds, with the cave pool and moss pass
landing in well under a millisecond of that.

### Changed — render scale removed

- **The Render Scale option is gone and the game renders at native resolution.**
  There was an adaptive resolution scaler that dropped the pixel ratio when the
  frame rate sagged and gave it back when there was headroom, and the slider was
  its target. The two fought each other: the scaler nudged the same value the
  slider owned, so the slider slowly drifted and the scene quietly rendered
  softer than the user asked for without the slider ever appearing to move
- The scaler is removed as well as the slider. If the frame rate needs help, the
  frame budget is the thing to look at — and the lag above is what it needed
- `settings.renderScale` is no longer read or written. Existing saves carrying the
  value simply have it ignored

### Changed — lava renders on all its faces

Lava is now drawn `DoubleSide`.

Verified along the way, because the symptom is ambiguous: the mesher *was*
already emitting lava side faces, with correct outward winding and correct
world-tiled UVs. A pool of 36 cells emitted 36 top quads and 48 side quads when
it had air around it, and no side quads when its edges were against stone — which
is correct culling, not a bug. The texture already repeated and the shader
already scrolled. So the one thing left that could hide a face was back-face
culling, and since a lava pool is a small fraction of the screen where an ocean
is most of it, the extra fragment work is not worth trading for a wall that can
vanish: the side walls of a pool are what tell you how deep it is, and losing one
reads as the lava being a flat sheet painted on the cave floor.

### Fixed

- **A pocket at negative y was being read as "no pocket".** The cave pocket scan
  used `-1` as its not-found sentinel, which is fine in a world whose floor is
  y = 0 and catastrophic in one whose floor is y = -128: a legitimate cave floor
  at y = -75 compared as less than the sentinel, so every deep lava pool was
  silently skipped and only the water band, whose floors are positive, ever
  worked. It now returns `null`
- The player no longer teleports to the top of the sky. Falling out of the world
  threw the player to `WORLD_HEIGHT - 4`; the bedrock floor now stops the feet
  where there is nothing under them to fall into, and a ceiling does the same at
  the top
- **Dropped items no longer teleport to the top of the sky either.** An item
  that left the world used to reappear at the surface, which combined with the
  96 item cap was a duplication loop. Items now rest on the floor
- The spawn point search, the standable-ground search, the highest-solid-column
  scan, the gravity-block landing search, the raycast bound, the fluid bounds,
  the bucket and block placement bounds and the cactus contact scan all moved
  onto the new floor and ceiling rather than assuming y = 0
- The mesher's padded neighbour cache is now indexed from the new floor, so its
  bottom row is one below the bedrock and its top row is one above the ceiling
- The light engine seeds sky columns from the new top, propagates and removes
  between the new bounds, and keeps its change-detection snapshot at the new
  volume size
- The chunk save codec allocates at the new column size, so a world saved after
  this change round-trips
- `heightMap` is signed, so a column whose highest block is below y = 0 is
  described correctly instead of wrapping
- A dead array read in the light engine's neighbour border scan is gone, and the
  dead `void` block in the worldgen decoration pass is gone

### Known outstanding

Three things this changelog's earlier sections claim as working are still broken,
and are not touched by the deep world work:

- **Water and lava do not flow.** The flow simulation reads an output array that
  nothing ever fills, so its queue never drains. Liquids render as static source
  blocks, the mesher never sees a shallow flow edge, and because the pending
  count never reaches zero the autosave re-encodes the whole world every 10
  seconds for nothing
- **Buckets throw when used.** The pour and scoop paths destructure `player` and
  `world` off the wrong object, so both crash
- **Breaking or placing sand and gravel throws**, and the block is destroyed,
  because the falling-block spawn sets its mesh position from variables that are
  not in scope

Also still on the list: the sprint double tap latches on a single tap, dying
hands out the wrong advancements, the chest opens your own inventory, armour
durability never drops, and the fluid-dependent advancements (Hot Stuff,
Bucketful of Cold, Sticky Situation) cannot be earned. We Need to Go Deeper and
Country Lode were unreachable at y = 0; **the deeper world makes both of those
reachable now**, as it does Bake Bread's wheat problem only if wheat is made
generatable, which it is not.

---
