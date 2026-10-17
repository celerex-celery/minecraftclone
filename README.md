# Minecraft Voxel

**Asset notice:** All original Minecraft textures, sounds, music, models and
other assets belong to Mojang/Microsoft and are extracted from the Minecraft
client asset pack (`minecraft-assets-26.3/`). They are used strictly for
non-commercial, educational purposes. See LICENSE.md.

A Minecraft-style voxel **survival** game running in the browser, built with
three.js and the real Minecraft asset pack (textures, GUI sprites, bitmap font,
sound effects and music). Packaged as an Electron desktop app; three.js is
vendored so it works fully offline.

![build](https://img.shields.io/badge/build-1.10-55ff55)
![tests](https://img.shields.io/badge/tests-headless-yellow)
![deps](https://img.shields.io/badge/dependencies-none-blue)

---

## Running it

ES modules need a real HTTP origin, so open it through the dev server rather
than double-clicking the HTML file.

```bash
start.bat
```

or manually:

```bash
node tools/serve.js 3066
```

then open <http://localhost:3066/>. Node.js is the only requirement.

```bash
npm test              # headless checks: worldgen, lighting, meshing, crafting,
                      # survival, shaders, commands and the keybind table
npm run electron      # run as the packaged Electron desktop app
```

---

## What's new in 1.10

- **Creeper** — spawns in overworld land biomes at night, stalks the player,
  lights its fuse when close, and explodes after a short countdown. Back away
  before it detonates and the fuse defuses. Drops gunpowder when killed by the
  player; explodes in place if it detonates itself.
- **TNT** — place a TNT block, prime it with flint and steel or set it alight,
  and it burns down its 4-second fuse before exploding. Explosions prime
  nearby TNT blocks too, giving chain reactions. Blocks in the blast are
  destroyed with blast resistance, players and mobs take distance-based damage
  and knockback, and destroyed blocks spill loot.

---

## Running it

Open via the dev server:

```bash
start.bat
# or
node tools/serve.js 3066
```

then open <http://localhost:3066/>. For the desktop app:

```bash
npm run electron
```

Tests:

```bash
npm test
```

---

## Controls

Every key below is rebindable in **Options → Controls**.

| Key | Action |
| --- | --- |
| `W` `A` `S` `D` | Move |
| `Space` | Jump / swim up (double-tap toggles creative flight) |
| `Shift` | Sneak (won't walk off ledges) |
| `Ctrl` | Sprint, or `Ctrl`+`Q` to drop the whole stack |
| Mouse | Look |
| Left click | Mine (hold) |
| Right click | Place / open block / hold to eat |
| Middle click, or `B` | Pick Block — copies what you are looking at into the hotbar |
| `1`–`9`, scroll | Select hotbar slot (scroll only while the pointer is locked) |
| `E` | Inventory + 2×2 crafting |
| `I` | Creative inventory |
| `Q` | Drop held item on the ground |
| `T` | Chat |
| `/` | Chat, with the command slash already typed |
| `F3` | Debug overlay |
| `F5` | Cycle camera: first → third → front |
| `F2` | Screenshot |
| `Esc` | Pause menu |

Mouse in the inventory: **left click** pick up / drop, **right click** half,
**shift + click** quick move, **shift + click a result** craft repeatedly.

Type `/help` in chat for slash commands.

### Commands

`/help` `/give` `/gamemode` `/clear` `/time` `/say` `/kill` `/list` `/seed`
`/teleport` (`/tp`) `/summon` `/difficulty` `/experience` (`/xp`)

Coordinates follow the real rule: a bare number is relative to the player and a
tilde makes it absolute, so `/summon chicken 0 5 0` is five blocks up and
`/summon chicken ~ ~ ~` is exactly where you stand. Summon a creeper with
`/summon creeper` or some TNT with `/give tnt`.

- `/experience <add|set|query> <targets> <amount> [levels|points]` — set or add
  levels or XP points, or query your current level and progress (`/xp` is the
  short form).

---

## World

- **Infinite chunked terrain**, 16 × 128 × 16, streamed around the player with
  distance-based unloading that keeps your edits alive.
- **Block shapes**: cubes, half-height slabs (bottom and top), stairs, fences,
  glass panes, thin walls and posts, all with ambient occlusion and smooth
  lighting. Fences, panes and walls connect to neighbours automatically. Slab
  and fence textures are derived from plain block sheets at load time.
- **Procedural generation** from layered noise: continentalness, erosion, ridge
  and detail fields produce **11 biomes** (plains, forest, taiga, snowy
  plains, desert, savanna, swamp, mountains, jungle, beach, ocean) with
  biome-tinted grass and foliage.
- **Caves** from two intersecting ridged 3D noise fields (long tunnels) plus
  rare deep chambers. Ore veins (coal, iron, copper, gold, redstone, lapis,
  emerald, diamond) placed by depth with 3D noise.
- **Oak, birch and spruce trees** with proper canopies. Decoration is evaluated
  over a 5-block margin and is deterministic in world space, so a tree
  straddling a chunk border rebuilds identically on both sides.
- **Surface-aware decoration** — grass, ferns and flowers grow on grass-like
  soil, while sand carries only dead bushes and cacti.
- Sand and gravel **fall** when unsupported.

---

## Lighting

A real two-channel voxel light engine:

- **Sky light** seeded from the top, falling straight down at full strength and
  spreading sideways losing one level per step.
- **Block light** from torches (14), glowstone and lava (15).
- Full **removal** propagation — mining out a torch genuinely darkens the room,
  and re-sealing a hole re-lights it.
- Cross-chunk flood fill with a 3×3 chunk cache on integer maths.
- Per-vertex **ambient occlusion** and **smooth lighting**, combined in the
  shader with a Minecraft-style light curve and a warm torch tint.

---

## Survival

- Health (20), hunger (20), saturation, exhaustion, air and XP levels on the
  vanilla curve.
- Exhaustion from sprinting, jumping, walking and mining; burns saturation then
  hunger; natural regen only at 18+ hunger; starvation at zero.
- Fall damage past 3 blocks, drowning with an air meter, cactus and lava
  contact damage, armour damage reduction (4% per point, capped at 80%).
- **Item drops** — broken blocks and `Q` spawn real dropped stacks that fall
  with gravity, settle on the ground, bob, merge into piles, and are picked up
  again by walking over them.
- Death drops your entire inventory — the stakes are real.

---

## The Nether

A second dimension reached through a portal you build yourself out of obsidian
and light with flint and steel:

- **Terrain** from four noise fields — a netherrack ceiling hung with glowstone
  patches, a floor of lava at `y = 21`, bedrock pillars, and **basalt deltas**
  on the floor of the low ground. A crust of solid netherrack sits over the
  caverns so the ceiling is not the only solid thing.
- **No sky at all** — no sun, moon, stars or clouds, a fixed dark red dome, and
  its own ambient light. Everything you can see is lit by lava, glowstone or
  magma.
- **Fire is a block** — it burns out on its own, water puts it out, and it
  spreads across netherrack and nothing else. Netherrack is fireproof.
- **Portals** are real sheets of `nether_portal` blocks that only exist where
  the frame is at least 2 wide and 3 tall, hum when you are near one, and all
  die together when the frame is broken. Travel scales 1:8 in x/z and half in
  y, with a five-second cooldown on arrival.
- Its own music: *Lethal Nether Land*, credited in the music panel.

---

## Life & progression

- **Chicken** — the vanilla model unwrapped from the pack's own 64×32 skin,
  with all nine of its sounds from the pack. It wanders, flutters, clucks, runs
  from you, falls when there is nothing under it, and drops one chicken and
  zero to two feathers, read straight out of the pack's loot table.
- **Creeper** (1.10) — spawns in overworld land biomes at night, stalks the
  player, lights its fuse when close, and explodes. Back away to defuse it.
  Drops gunpowder when killed by the player; nothing if it detonates itself.
- **Thrown ender pearls** — projectiles, not dropped items.
- **Three game modes** — survival, creative (flight, no mining, no hunger) and
  spectator (no hitbox, passes through terrain).
- **Advancements** — a tree of conditions grouped into tabs, with a toast the
  moment one is earned.
- **Statistics** — distance walked, blocks mined and placed, deaths, time
  played, per-item breakdowns.
- **Bedrock autosave indicator** top right while a write is in flight.

---

## Items & crafting

- 9 hotbar + 27 main + 4 armour slots, stack sizes, tool durability bars.
- **~60 crafting recipes** — shaped (matched anywhere in the grid) and shapeless,
  covering planks, sticks, crafting table, furnace, chest, torches, bowls,
  buckets, all four tool tiers, three armour sets, mineral block
  compression/decompression, and more.
- **Furnace** tile entities with fuel values, smelting time and a live flame /
  progress display. Smelts ore to ingots, sand to glass, clay to brick, logs to
  charcoal, and cooks meat.
- **Mining** uses the exact vanilla break-time formula:
  `seconds = hardness * (canHarvest ? 1.5 : 5) / speed`, where a tool only
  contributes its speed when its *type* matches the block, and drops are gated
  by harvest level.
- **TNT** (1.10) — a breakable block primed by flint and steel or fire. It
  burns down a 4-second fuse, then explodes with power 4: blocks are destroyed
  by blast resistance, TNT in the blast is primed for a chain reaction, players
  and mobs take distance-based damage and knockback, and destroyed blocks spill
  loot.
- **Block breaking animation** — the ten `destroy_stage` sheets multiply over
  the block as cumulative masks, so cracks spread as the block breaks and the
  block stays visible the whole time.

---

## UI

- **One texture atlas** for all block geometry; four draw groups per chunk
  (opaque, alpha-cutout, water, lava).
- **Localisation** — UI strings, item names, block names, splash texts and the
  version come from JSON files in `assets/lang/`. Ships with English (US),
  English (UK) and Spanish. Switching language re-renders everything on screen,
  and a partial translation falls back to English per key.
- **Options with categories** (Video / Audio / Gameplay / Controls) in the real
  Minecraft bitmap font, with automatic GUI scale, render distance (up to 32),
  FOV, brightness, cloud height, view bobbing and volumes.
- **Rebindable controls** — the Controls tab lists every action and its key.
  Click a key to rebind, right click to reset one row, Escape to cancel,
  Backspace to unbind. Colliding bindings clear each other. Attack and Use Item
  are fixed to the mouse. Bindings are saved with settings.
- **Real Minecraft bitmap font** — text rasterised from `assets/font/ascii.png`
  into canvases with measured per-glyph advance widths, cached by string.
- **Isometric item icons** — blocks drawn as shaded 3-face cubes, items as
  sprites, exactly like vanilla.
- **Day/night cycle** — gradient sky dome, sun, moon, 900 stars, fog colour
  tracking the horizon. Cloud height is an option.
- Break particles sampling the actual block texture; destroy-stage crack
  overlay; swing and view-bob animations; first-person held-item view model
  rendered in its own pass so it never clips into terrain.
- Underwater tint, damage flash, vignette, toasts, item-name popups.
- **Loading screen with a splash**, drawn in the game's bitmap font above the
  progress bar, and a **crash screen** with a copyable error report.

---

## Audio

The **real Minecraft sound files**, not synthesis:

- Per-material dig, break, place and footstep sounds with randomised variants
  and slight pitch jitter, decoded once and replayed through a source pool.
- Player hurt, fall, eat, drink, level up, crafting, pickup, splash, swim,
  chest, bubbles and UI clicks.
- **Ambient cave drones** and **underwater ambience** cross-faded by where you
  are, with music ducked underwater.
- **Music**: main menu theme plus a shuffled in-game playlist.
- **1.10 additions** — fuse hiss and explosion booms for TNT and creepers,
  plus creeper idle/hurt/death sounds from the asset pack.

---

## Project layout

```
index.html              markup + importmap
CHANGELOG 1.4.md        release notes, newest last
start.bat / start-electron.bat  launchers
package.json            app manifest and scripts
electron/               Electron desktop wrapper
styles/
  main.css              base, screens, title, crash, options
  hud.css               hotbar, hearts, hunger, xp, debug
  screens.css           inventory / crafting / furnace, tooltips
  advancements.css      advancement and statistics screens
src/
  main.js               boot: load assets, build game, splash, crash screen
  core/
    Game.js             orchestrator + frame loop
    Commands.js         slash commands
    Config.js           all tunables and keybinds
    Assets.js           texture / GUI / font / sound loading
    Input.js            keyboard + pointer lock
    SaveGame.js         IndexedDB persistence
    Statistics.js       per-session and per-world counters
  world/
    Blocks.js           block registry (render + physical + survival data)
    Items.js            item registry (tools, food, armour, fuels)
    Chunk.js            voxel storage
    WorldGen.js         biomes, terrain, caves, ores, trees
    NetherGen.js        netherrack terrain, ores, deltas, lava
    Noise.js            seeded simplex + fBm
    Lighting.js         two-channel voxel light engine
    ChunkMesher.js      AO + smooth lighting mesh builder
    ShapeTextures.js    generated slab / fence sheets
    TextureAtlas.js     texture packing
    Materials.js        patched shaders, selection box, break overlay
    Sky.js              sky dome, sun, moon, stars, clouds
    Portal.js           portal frames, sheets, travel
    Mobs.js             mobs, their models, loot and sounds
    EnderPearls.js      thrown projectiles
    FallingBlocks.js    sand and gravel
    FluidSim.js         water and lava flow
    Particles.js        instanced block debris
    ItemDrops.js        dropped item stacks
    World.js            chunk streaming, raycast, editing, save, explosions
  player/
    Player.js           AABB physics, swimming, view bob
    Interaction.js      mining, placing, eating, drops
    ViewModel.js        held item + swing animation
  survival/
    Survival.js         health, hunger, exhaustion, air, XP
    Inventory.js        slots, stacks, durability, armour
    Recipes.js          crafting + smelting + fuel tables
    Crafting.js         recipe matching
    Furnace.js          smelting tile entity
  ui/
    PixelFont.js        Minecraft bitmap font renderer
    ItemIcons.js        isometric block / item icons
    Lang.js             JSON language loading and translation
    LanguageScreen.js   standalone language picker
    Splashes.js         title and loading splash texts
    HUD.js              hotbar, status bars, toasts, debug
    ContainerScreen.js  inventory, crafting, furnace screens
    Screens.js          title, pause, options, death
    WorldScreens.js     world list and world creation
    Advancements.js     advancement tree and conditions
    AdvancementScreen.js  advancement and statistics screens
    StatisticsScreen.js statistics breakdown
  audio/
    SoundEngine.js      Minecraft SFX + music playback
assets/
  textures/             blocks, items, GUI sprites
  sounds/               dig, step, random, ui, damage, liquid, block, ambient, music
  lang/                 en_us.json, en_gb.json, es_es.json
  font/ascii.png        Minecraft bitmap font sheet
tools/
  serve.js              dev server
  smoke-test.mjs        headless test suite
  portal-test.mjs       portal frame and travel checks
  nether-test.mjs       nether generation checks
  profile.mjs           chunk pipeline profiler
vendor/three.module.js  three.js r160
```

---

## Asset provenance

Textures, GUI sprites, sounds and music come from the Minecraft client asset
pack present in this folder (`minecraft-assets-26.3/`, version 26.3).
`tools/copy-assets.ps1` and `tools/copy-audio.ps1` extract exactly the subset
the game uses into `assets/`, so the game folder is self-contained. All game
code, shaders, UI and systems are original.

**All original Minecraft assets belong to Mojang/Microsoft and are used
strictly for non-commercial, educational purposes.** See LICENSE.md.

---

## Performance notes

The frame loop bounds chunk work by wall-clock time and adapts that budget to
the measured frame time, so a slow machine streams more gently instead of
stuttering. Two fixes mattered most:

- The light engine runs on a 3×3 chunk cache of integer indices. Going through
  the world's string-keyed chunk map cost ~20 ms per chunk; it is now ~2 ms.
- Chunks are only re-meshed when their light actually *changed*. A previous
  version re-queued chunks for relighting from the mesher, creating a
  light → mesh → light loop that ran 68 light passes per chunk.

Typical numbers at render distance 7 (289 chunks, 1.1M triangles):
initial load ≈ 4 s, then ~0 ms of chunk work per frame.
