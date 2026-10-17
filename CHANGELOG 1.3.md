# Changelog

## 1.3 — The Nether

### Added — a second dimension

The Nether is a full second world, not a room off the Overworld. It occupies
**its own 128 blocks — bedrock at y = 0 and bedrock at y = 127**, which is the
real dimension's height limit and not this project's much deeper world range.
That deeper range is the overworld's business; a 320-block Nether is not a Nether
anybody has seen. The space below the Nether's floor is left empty rather than
filled: the bedrock at y = 0 is what stops you falling, and it cannot be mined.
Between the two it is a landscape — a height map of netherrack ground with caverns
carved into the rock underneath, open air above, a netherrack ceiling with
glowstone on it, and the low ground flooded to make the lava seas. A portal at the
Overworld's sea level (y = 62) arrives at y = 31, on the ground rather than in the
void.

- **A netherrack ceiling with glowstone on it.** The real roof is not solid
  bedrock all the way down: two blocks of it are, and below that is netherrack,
  and the glowstone sits on the *underside of that* — rock above it, open cavern
  below, which is how the real one is placed. A glowstone buried inside solid rock
  lights nothing, so the layer it goes in is named in the config as a single
  number rather than derived from the layer above it, and the Nether test checks
  the two agree. Being one block out is the difference between a lit ceiling and a
  ceiling with some lights hanging under it doing nothing
- **Many small glowstone patches, not a few large ones.** The field is high
  frequency, so a patch is a handful of blocks across, and the threshold puts them
  on about a fifth of the ceiling. Big rare clusters read as landmarks instead,
  which is not what a ceiling is for — the ceiling is what lights a cavern as you
  cross it
- **Ores at the real heights**: quartz and ancient debris in the same fifteen
  blocks just under the lava sea, which is why both are dug out of it rather than
  found on the surface, and gold spread over almost the whole height. A vein may
  run out into the lava, which is exactly how quartz looks in the real game, but
  it will not punch through the bedrock roof or hang in open air

- **The Nether has ground, and it has walls.** Four fields decide it, and they
  are not symmetric, which is the whole shape of the dimension:
  - a **broad** field, on a wavelength of about a hundred and forty blocks, for
    the shape of the land. Its curve is *different in each direction*, and that
    asymmetry is the point: upwards the curve is under 1, which spreads the field
    out so the high ground rises gradually into broad terraces; downwards it is
    over 1, which squeezes it together so the low ground is **rare and deep**
    rather than common and shallow. One symmetric curve can only give one of
    those, and the wrong one gives a third of the world under a film of orange
  - a **cliff** field, short and steep, added on top. The broad field alone can
    only make slopes; this one is a dozen blocks of rise over a few blocks of
    ground, which is what puts walls in the terrain
  - a **terrace** field. In the regions it picks out, the ground is quantised
    into eight-block steps, so a wall reads as a stack of ledges with something
    to stand on rather than a smooth ramp
  - a **wall** field, broad, for the great walls. Those are not really surface
    relief: they are masses of rock from the floor to the ceiling with the lava at
    their feet, and a height map cannot make them — it can only make a surface.
    So the regions this field picks out have their ground raised towards the roof
    instead, blending linearly so the sides of a mass are steep
- **Giant lava pools.** One lava level runs across the whole dimension at y = 21,
  so every hollow that dips below it joins up with its neighbours rather than
  being its own lake. Ground that falls below the line floods and erodes into it;
  the rock underneath the crust stays solid, which is the difference between a
  hollow full of lava and a dimension that is mostly burning rock. The largest
  connected sea measured is around 6,400 surface blocks — roughly 80 across — and
  the share of ground under lava stays under 10%, so it is a few enormous seas
  rather than a flood
- **Basalt deltas**: black stone shelves on the floor of the low ground, polished
  on top with basalt under it, which is most of what stops a lava basin from
  being a flat plane of orange
- **A few blocks of solid netherrack under the surface** as a crust the caverns
  are not allowed to eat into. That crust is the whole difference between a
  landscape and a shell: a shell has a surface you cannot stand on and a void
  under it
- The lava, the caverns and the crust are all in the generator, which sits on the
  same coarse lattice the overworld's does for the same reason — a noise call per
  voxel over a 224 block column is far too slow, and sampling finely makes
  caverns look like noise rather than rooms. None of the gates are baked into the
  lattice: the lattice covers the whole column and each column is judged against
  its own surface, because a gate baked in would mean one set of samples per
  column instead of one per chunk
- **Bedrock pillars** standing out of the lava, the Nether's skyline, gated by a
  low frequency field so they come in connected groups and then stop rather than
  appearing one per column
- **Glowstone in the ceiling.** There is no sky in the Nether, so a lit roof is
  what makes a big cavern readable at all
- **Ores**, at the vanilla counts and sizes: quartz and nether gold, plus
  **ancient debris** — the reason anyone comes down here. The triangular depth
  distribution is re-centred on this dimension's own middle, because the
  Overworld's placer is written around y = 0 and would put every Nether vein at a
  height that means nothing here. Debris is divided by three against the placer's
  three-by-three neighbour loop, which is what lands it at about the vanilla
  rarity of a single vein of up to eight blocks, concentrated by that same
  distribution in one thin layer rather than scattered down the whole ceiling

- **No sky, anywhere.** The Nether's light comes only from lava, glowstone, magma,
  torches and fire. Every path that seeds a sky column, pushes sky across a chunk
  border, recomputes a column after an edit, or answers `getSky`/`getLight` for an
  unlit cell is gated on a single flag the light engine reads once. The mesher's
  pad cache honours it too, which is the one that matters: without it the open
  caverns are lit as though the whole dimension were under open sky, and the
  Nether stops being a different place and becomes a retextured one

- **A Nether sky**: no sun, no moon, no stars, no clouds, a fixed dark red dome
  and a fog that does not follow the render distance — the far wall is about a
  hundred blocks away at any setting, which is what gives the dimension its
  closed-in feel. The debug overlay (F3) names the dimension
- **The Nether has its own ambient light.** This is the one that makes it read as
  a place rather than as a nearly black screen. The overworld's light floor is
  0.048, which is fine when there is a sky to light everything, but the Nether has
  no sky light at all, so with the overworld's floor the only readable thing in
  the whole dimension is whatever a lava lake or a glowstone is directly lighting.
  The floor is raised to 0.17 and tinted warm, and the tint fades out as light
  rises, so lit surfaces still show their own colour and only the darkness itself
  is red

### Added — fire, and portals

- **Fire is a block.** Flint and steel struck against any solid face sets a flame
  to the cell in front of it, in any direction, exactly as the real game does it.
  The face needs something solid behind it and open air above, which is what makes
  clicking a wall produce a row of flames along the ground and clicking a ceiling
  produce nothing at all. It is a single strike that does both jobs at once:
  strike a complete obsidian frame and the portal lights *and* catches, if there
  is a legal cell to stand a flame in
- **Fire has a life.** It burns out on its own, water puts it out on contact
  (fire is replaceable, so the flow sim flows into it), and it burns the player for
  half a heart a second while they stand in it. It is not a liquid, so it is not
  in the flow sim — it is a short life held in one flat table, which cannot be
  walked off the edge of by a chunk that unloads with flames still on it
- **Fire spreads across netherrack and nothing else.** That flag is set on one
  block on purpose: a flame dropped in the Overworld never runs away from the
  player, and the Nether still behaves the way the real one does, where one spark
  takes the whole floor with it. A ceiling on how many flames can burn at once is a
  frame time guard rather than a game rule
- **A lit portal is open.** A sheet of `nether_portal` blocks only exists where
  flint and steel lit a complete obsidian frame, so being made of portal blocks is
  the whole test, and a player standing in one goes through. There is no second
  condition and no separate state to drift out of step with the world: the frame
  comes down, the sheet goes with it, and the frame goes back up, the strike fills
  the opening again

- **Portal frames are checked properly.** A frame is at least 2 wide and 3 tall on
  the inside, the sides are obsidian and so are the top and the bottom, and the
  opening has to be clear. Reconstructing the frame from one clicked obsidian
  block is the fiddly part: a frame cell can be the bottom course, the top course
  or one of the two side columns, and each says something different about where the
  rest of the frame is. Both possible planes are tried, and a candidate that does
  not check out is discarded rather than half-built — which is what stops a plain
  wall of obsidian from lighting. Every walk out from a clicked block is bounded
  by the largest frame the game accepts: an unbounded one hangs the tab
- **Breaking the frame kills the portal**, all of it, the whole connected sheet
  rather than the one cell next to what was broken. The rule is the real one: a
  portal with any intact frame anywhere on it survives, and a frame broken from
  the far end puts the portal out from this end too. The check reads the whole
  26-cell box around a change rather than the six faces, because a frame's corner
  block only touches the opening diagonally and a check of the faces only would
  miss the most common way to break a frame
- **A portal at your back on the first arrival.** The Nether has no portal to come
  back through the first time, so one is built one block behind the player,
  facing the way they walked in facing. Turning round is all it takes to go home
- **Five seconds during which a portal will not take you.** Arriving in the
  Overworld puts the player back where they were standing, which is inside the
  portal they just walked through; arriving in the Nether puts one at their back.
  Either way there is a moment where a portal could grab them and send them
  straight back where they came from, so `PORTAL.REENTRY_DELAY` holds the
  dimension for five seconds. Respawning in the Nether gets the same grace, or
  the portal the player respawns at is a death loop
- **The sheet stands two cells behind, which is one behind the body.** One cell is
  not far enough: the portal test is a box the width of the player's hitbox, about
  0.85 blocks either side, so a sheet in the *adjacent* cell catches them standing
  still. The direction is snapped to a block axis, because a frame off the grid
  comes out diagonal and there is no diagonal portal block
- **The pocket it is built in is cleared down to the bottom course, and the floor
  from the frame to the player is only as wide as the opening.** Both of those are
  load bearing rather than tidy. A frame is only a frame if its bottom course is a
  run of obsidian that *stops* at the frame: leave the surrounding rock in place and
  the course merges into it, the side columns run down into the floor, and the
  portal the player is looking at has no frame at all. Widening the floor to the
  frame's full span does the same thing one layer down. The Nether test builds the
  frame into solid rock and then asks the game's own frame check whether it is a
  legal one, in all four axis directions and off axis

- **Travelling.** A 1:8 step across and half the height, the vanilla scale, under
  a purple veil that is the whole of the transition. Going back returns you to
  where you were standing, so a portal is a door between two places rather than a
  one way trip. Arrive somewhere with no portal near the mapped coordinates — the
  first time anyone comes through — and the game builds the arrival the way the
  real one does: an obsidian platform with a lit portal standing on it, clear of
  the sheet so nobody arrives already on their way back. The ground for it is
  found by looking *down* from the mapped height, because the Nether has a bedrock
  roof and a search that walks up finds nothing until it hits that
- **The portal draws itself.** It is a thin sheet with its own geometry group and
  its own material, the way water and lava have, and it plays through eight
  animation frames cut out of the vanilla 16 x 512 portal strip into a 4 x 2 sheet.
  Which way the sheet runs comes from the frame's *ends*, which are the only
  obsidian next to a portal: the two side columns stand at the far ends of the
  opening, so for anything wider than one cell there is nothing to read
  immediately beside a portal cell, and the run has to be walked out to the
  columns past it — measuring both ends separately, because in a three wide
  opening one is one cell away and the other is three. One quad per cell, both
  sides, smooth lit

### Added — the Nether's blocks

Netherrack, nether bricks and its three carved and red variants, soul sand, soul
soil, magma, shroomlight, quartz block, basalt, polished basalt, smooth basalt
and blackstone, plus the three ores. Slabs and stairs for the four that the real
game has them for. Every texture comes from the asset pack, copied by
`tools/copy-assets.ps1` like everything else.

Ancient debris is the vanilla 30 hardness and wants a diamond pickaxe on this
build's tier scale — the same tier as obsidian — so a wooden pickaxe has no
chance and an iron one takes far too long to be worth trying. Quartz compresses
into a block the way every other mineral here does; debris smelts into netherite
scrap, and four scrap with four gold make an ingot, which is the whole of its
story.

Two files are copied under a name of their own. Ancient debris has no item icon
in the pack — its item model points straight at the block's own side texture,
exactly as the real game does — and fire is a 16 x 512 strip of animation frames
rather than a 16x16 face, so it is copied under the plain block name the registry
asks for.

### Fixed — animation strips drawn as smears

Several of the block textures the pack ships are not block faces. They are
vertical animation strips: **magma is 16 x 48**, the command block 16 x 64, fire
and the nether portal 16 x 512, water and lava 16 x 320 and 16 x 512. The atlas
packs 16 x 16 tiles, and the source-rect overload of `drawImage` scales whatever
it is handed to fit the cell — so an animated block came out as its three frames
blended into a vertical smear. Magma was the worst of it, because it is a whole
block of it rather than a plant.

The packer now **crops** to the top-left 16 x 16, which is frame zero of a strip
and exactly what a single tile wants. That is in the packer rather than in a list
of known offenders on purpose: it is the one place that knows it wants a square,
so a strip can be added to the registry later and still come out right. The Nether
test checks the pack, lists the strips the atlas has to deal with, and asserts the
crop is there — so this cannot come back unnoticed.

- **The Nether has its own music.** `Lethal Nether Land` is the only track in
  `assets/music/nether.ogg`, and it is a *context* rather than another entry in
  the overworld's list: walking through a portal changes the music instead of
  occasionally shuffling it, and the whole dimension has one piece to it the way
  the real game has a handful for the Nether rather than the overworld's rotation.
  Entering a world, respawning and every dimension change all go through one
  `playWorldMusic()`, so a respawn in the Nether cannot hand the player the
  overworld's music. Context switches cut rather than fade: the tracks are long,
  and a Nether track that began twenty seconds in because the player happened to
  walk through a portal would sound like a mistake

- **The music panel shows a credit, and the record turns.** "C418 - Minecraft",
  "C418 - A Familiar Room", and so on — vanilla names its tracks the same way
  (`music.minecraft.stratum`, `music.minecraft.13`) and puts the credit in a toast
  when a track starts, so the credit is part of the track rather than something
  the interface invents. The Nether's is *Celerex - Lethal Nether Land*, and the
  author is optional in the table because a guess would be worse than nothing.
  The disc turns while the panel is up and stops when it is not, so it is a
  picture of a record going round rather than a logo that keeps spinning after the
  music has stopped; a `prefers-reduced-motion` rule turns it off for anyone who
  has asked their system not to animate things
- **Music options**, in the order the real game's audio screen puts them: a
  **Music** on/off switch, its own **Music Volume**, and a **Music Toast** switch
  for the panel. The switch and the volume are separate because they are different
  intentions — "no music" and "music, but quieter" — and folding them into one
  slider means a player who mutes music cannot tell which they have set. Turning
  music off stops what is playing rather than running it silently to the end.
  **Cave Sounds** is here too, since it is the one ambient still in the game
  and it was previously only reachable by editing a config file

### Fixed

- **Two labels with the same words on them could not both be seen.** The font
  caches a rasterised canvas per string and hands out *the node itself*, and a DOM
  node can only be in one place — `appendChild` on a node that already has a
  parent moves it. So every label that wanted the same string took the canvas off
  whichever element had it and left that element blank. That is every pair of
  buttons that say the same word: every row of on/off toggles in the options
  screen showed only the last one, and any two buttons that both said "Play" left
  one of them blank. Pressing the button made it appear, because the click
  repaints with a different string and takes a different canvas. The cache is
  still there — rasterising the same string twice is real work — but what gets
  shared is now the pixels and not the element `Blocks.add` takes an object,
  so a property it does not recognise is silently dropped and then reads as
  `undefined` *everywhere* in the game, with no error anywhere — the definition
  looked fine at the call site and wrong at every read. Two were missing, and
  both were visible. **`cutout`** decides which draw group a block is drawn in, and
  it read as undefined for every block in the game, so **glass, ice, leaves,
  chests, torches, fences, panes and walls have all been rendering as solid
  opaque cubes** rather than alpha tested. **`noDrop`** decides whether breaking a
  block hands you anything, so punching out a flame gave you a flame back.
  `add` now spreads the caller's own options over the derived defaults, so a
  property the default list has never heard of still lands on the definition, and
  it keeps `id`, `name` and `stackable` for itself whatever is passed
- **Plants went solid.** Making fire its own draw group meant `emitCross` had to
  decide which builder a cross belongs in, and it asked the registry for
  `def.cutout` — which, per the above, did not exist. Every sapling, flower and
  blade of grass was drawn as a full opaque box. The old code hardcoded the cutout
  builder, which is why this only appeared once the flag was consulted at all
- **Fire was upside down.** Its sheet UVs took the atlas branch's convention, but
  the atlas branch gives the *bottom* of a quad the upper v because GL's v = 1 is
  the top of an image, and the frame sheet is read the same way. Without the flip
  a flame hangs from the ceiling. The nether portal has the same inverted v and
  got away with it, because a portal's pattern is near enough symmetric
- **Fire could not be placed on grass.** The rule required something *solid*
  underneath, and grass is neither solid nor a liquid, so flint and steel did
  nothing at all in a field. A flame now stands on anything that can hold one —
  solid, liquid or a plant — which is what burnt grass is for

- **The name of the music playing**, in the top left corner on its own dark
  strip with a record beside it, the way the real game shows it. Not one of the
  centre-screen toasts: a track is minutes long, and a label that fades after
  three seconds would be gone before the music had got going. It sits there until
  the next track, and one track is one panel rather than a stack

  The panel is driven off the sound engine rather than a timer, which matters
  for the very first track: the browser's autoplay policy holds it back until
  the first click, and a timer-based toast would have fired and faded while the
  music was still silent

### Structures

- **Skipped, and not because they are hard.** The pack has villager *textures*
  and villager *sounds* and nothing else: no village geometry, no structure
  layouts, no waypoint or jigsaw data. Minecraft defines villages in code, not in
  asset files, so there is nothing here to build them from

### Fixed
 It was three things at once and none of them were
  right. It had **no animation** — it was drawn as a single static tile cropped
  out of the pack's 16 x 512 strip, which is a flicker-free orange blob — so it
  now has its own geometry group and material and plays through eight frames of a
  4 x 2 sheet cut from that strip, at the vanilla rate, exactly the arrangement
  the nether portal already used. It did not **burn out** usefully, and it never
  **burned what it was standing on**, which is the difference between fire and a
  glowing block: a flame now eats the block under it after a moment and starts
  its life over, which is what lets one flame walk down a row of planks on its
  own rather than needing a new one struck for every block. And the spread's
  "random" was a **fixed increment**, so every flame lit up on the same schedule
  — a field of them pulsed together, and a step that happened to walk the roll in
  and out of the spread window on a long cycle meant some flames never spread at
  all. Each flame now carries its own increment as well as its own starting roll
- **Netherrack is fireproof**, which it is in the real game. It was the one block
  flagged flammable, which is what let a stray flame creep across an entire Nether
  plain; a flame struck on netherrack now spreads nowhere and burns itself out,
  and the only things that carry fire are the ones that do in the real game — wood,
  planks, leaves, saplings, grass, cactus, sugar cane, pumpkin. Nothing in the
  Nether takes a flame at all, which is why a Nether fire is a light and a hazard
  rather than a forest fire
- **Fire itself could be set on a wall.** A flame needs something to stand on and
  air over it, but nothing stopped you striking the *side* of a block, so fire
  hung off walls. The top face is now required, which is the rule the real game
  uses and which is what a flame standing on something has always implied
- **Plants could be built onto walls and into the air.** Saplings, grass, flowers
  — anything drawn as two intersecting quads — accepted a side face, which leaves
  a flower floating off the side of a block; with a `replaceable` neighbour, like
  a sapling against tall grass, it was easy to hit by accident. Crosses now
  require the **top** face and something underneath that can hold them, the same
  two conditions the real game applies
- One more in the fire sim itself: setting a cell that is **already fire** to fire
  again used to *remove* it from the sim while leaving the block lit, because the
  two branches of the bookkeeping were independent ifs and the first one won. The
  result was a flame that was on fire, could not spread, could not burn out and
  could not be flooded. The conditions are exclusive now

`npm run test:nether` grew a section that runs the real fire sim against the real
world: a flame on stone burns out and takes nothing with it, a flame on netherrack
spreads nowhere and burns nothing, a flame on planks eats them and spreads along
them, and water puts it out.

- **Cave ambience repeated every two seconds.** Two things were wrong, and only
  the second was visible. The file itself is a two second rumble played on
  `loop = true`, so it repeated every two seconds for as long as the player was
  anywhere dark — a fixed loop of a short file is a machine gun, and it should
  never have been looped. And "somewhere dark" was `skyLight <= 4`, which in the
  Nether is *everywhere*, because the dimension has no sky light at all: turning
  the sky off made the whole Nether read as buried, so the rumble never stopped.
  It is now a one-shot off a random gap of one to five minutes, it never loops, and
  a world with no sky is excluded outright. It is also **off by default**
  (`CONFIG.AMBIENT_CAVE.ENABLED`) because it is a sound nobody asked for; the
  timings are there for turning it back on. Underwater ambience is untouched — it
  is a bed the player is sitting in rather than an event, and a long file written
  to be looped
- **The Nether's music 404'd.** Every music path in the engine resolves under
  `assets/sounds/`, and the track had been copied to `assets/music/`, so the
  request went to `assets/sounds/music/nether.ogg` — which is where the other
  seven tracks already live, and where this one now is. The path in `MUSIC` was
  always right; the file was not where the path said

### Changed

- **No chat text for portals.** The real game gives no text at all when a portal
  is lit or when a player changes dimension — a portal that catches makes a sound,
  striking a block that is not a frame makes a different sound, and that is the
  whole of the feedback. Four lines that Minecraft does not have ("Portal lit",
  "the frame is too small", and the two dimension messages) are gone, and the
  keys are deleted rather than left behind so nothing can pick them up again.
  Feedback is **sound** instead: the flint click when a portal catches, a
  different click when it does not, and the long descending portal whoosh on a
  dimension change. The pack ships no `block/portal/trigger` or
  `block/portal/travel`, so the travel cue is `block/end_portal/endportal`, which
  is the same whoosh the real game uses for a player going through one. The
  strike on a non-frame now also *sounds* like a refusal, where before it was
  only a chat line

- **The portal hum.** A lit portal hums whenever a player is near it, not only
  when they are standing in one — which is the rule the real game uses, and what
  makes the sound arrive before the player does. It is a five second file looped
  as a bed, which is the same distinction the cave rumble does *not* get: that one
  is an event and is still a one-shot off a long random gap, because looping a two
  second file is what made the earlier complaint. Being underwater still wins, so
  only ever one bed plays. The proximity check re-reads a few times a second
  rather than every frame
- **The icon is the pack's own.** `favicon.ico` is built by `npm run icon` from
  the finished Minecraft app icon the asset pack already ships at 16, 32, 48, 128
  and 256 pixels. There is nothing to draw, crop, resample or invent:
  `tools/copy-assets.ps1` copies the five PNGs into `assets/icons/` and the tool
  only builds the container around them, copying the image bytes through verbatim.
  An .ico is not a format, it is a container — a six byte header, one sixteen
  byte directory entry per size, then the images — and the 256 entry records its
  width as the single byte `0`, because a byte cannot hold 256 and the format
  says zero means it. The tool checks each file's signature, chunk structure and
  every chunk CRC before wrapping it, and that check is the reason a broken icon
  fails here rather than rendering as an empty tab with no error anywhere

  It does not decompress the image data, and that is deliberate. These files
  store their IDAT in a form neither of Node's inflaters accepts — technically
  non-conformant, and universally tolerated — and whether the pixels inflate has
  no bearing on whether the container is correct. The browser decompresses them
  every time it draws the icon, without complaint

- **Saves carry both dimensions.** A save now records which dimension the player
  is in, every dimension that has been visited, and where they stand in each one.
  A record that carries only a single `world` is an older one and still loads: it
  becomes the Overworld and the Nether is built fresh the first time anyone goes
  through a portal. Burning fire is written out with the life each flame has left
- **Block ids are stable.** The Nether's blocks are registered *last*, after every
  block that already existed. A save file stores block ids, so anything added
  before them would renumber every block in a saved world and corrupt it
- **Falling blocks and dropped items are per dimension.** A falling block commits
  itself to whichever world it was spawned in and a dropped item is drawn and
  picked up against the world it is lying in, so one shared instance would drop a
  pile of sand into the Nether and let the player pick items up through the floor
- **Render distance follows every dimension**, so walking back through a portal
  does not arrive in a differently rendered world
- **A dimension you are not in stops drawing.** Both worlds live in one three.js
  scene, so a chunk that is still meshed draws over the top of whichever one the
  player is in. The block data stays where it is and the geometry goes, which is
  what makes stepping through a portal instant in both directions: the world you
  left is still there, one frame away, and rebuilds itself as soon as you come
  back

### Tests

`npm run test:portal` and `npm run test:nether`. The portal rules are pure, so
they are checked against a plain Map-backed world; several of the cases are the
ones that are impossible to reach by hand — a frame exactly one block too small,
a hundred block obsidian wall, a portal whose frame was repaired after it was
lit — and several are the ones that must *not* hang. The Nether test runs the
real `World` over the real generator with the three.js scene stubbed out, so a
regression in the generator or in the light rules shows up there rather than as a
black Nether in the browser. It also pins the things that are invisible as
crashes and very visible on screen: that no Overworld block finds its way into a
Nether chunk, that hiding one dimension takes exactly its meshes out of the shared
scene, that a portal's sheet lies in the plane of its opening at two and three
cells wide and in either orientation, that most of the ground is flat and *some*
of it is an eight-block wall, and that the lava is a few connected seas rather
than a few hundred puddles.

---
