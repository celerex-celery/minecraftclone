# Minecraft Voxel

A Minecraft-style voxel **survival** game that runs in the browser, built with
three.js and the real Minecraft asset pack (textures, GUI sprites, the
bitmap font, sound effects and music).

![build](https://img.shields.io/badge/build-1.4-55ff55) ![tests](https://img.shields.io/badge/tests-129%20passing%2C%2013%20stale-yellow) ![deps](https://img.shields.io/badge/dependencies-none-blue)

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

then open <http://localhost:3066/>. Node.js is the only requirement — three.js
is vendored in `vendor/`, so the game works fully offline.

```bash
npm test              # 142 headless checks: worldgen, lighting, meshing, crafting,
                      # survival, shaders, commands and the keybind table
node tools/profile.mjs 7   # chunk pipeline timings
```

129 of those pass. The other 13 are stale rather than broken: they still assert
that the world starts at `y = 0`, which stopped being true when the world moved
to a 320-block height with a floor at `y = -128`, and they were not updated at
the time. Nothing the game does at runtime is wrong because of them.

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

Type `/help` in chat for the slash commands, and `/time set day` to move the
clock — there is no day length slider.

### Commands

`/help` `/give` `/gamemode` `/clear` `/time` `/say` `/kill` `/list` `/seed`
`/teleport` (`/tp`) `/summon` `/difficulty`

Coordinates follow the real rule, which catches people out: **a bare number is
relative to the player and a tilde makes it absolute**, so `/summon chicken 0 5 0`
is five blocks up and `/summon chicken ~ ~ ~` is exactly where you are standing.

---

## What's implemented

### World
- **Infinite chunked terrain**, 16 × 128 × 16, streamed around the player with
  distance-based unloading that keeps your edits alive.
- **Block shapes**: every block is built from axis-aligned boxes, so cubes,
  half-height slabs (bottom and top), stairs, fences, glass panes, thin walls
  and posts all render with correct ambient occlusion and smooth lighting.
  Fences, panes and walls automatically connect to their neighbours.
  Slab and fence textures are derived from the plain block sheets at load time,
  since the client asset pack only ships the base textures.
- **Procedural generation** from layered simplex noise: continentalness,
  erosion, ridge and detail fields produce **11 biomes** (plains, forest,
  taiga, snowy plains, desert, savanna, swamp, mountains, jungle, beach,
  ocean) with biome-tinted grass and foliage.
- **Caves** from two intersecting ridged 3D noise fields (long tunnels) plus
  rare deep "cheese" chambers. Ore veins (coal, iron, copper, gold, redstone,
  lapis, emerald, diamond) placed by depth with 3D noise.
- **Oak, birch and spruce trees** with proper canopies. Decoration is
  evaluated over a 5-block margin and is deterministic in world space, so a
  tree straddling a chunk border rebuilds identically on both sides.
- **Surface-aware decoration** — grass, ferns and flowers only grow on
  grass-like soil, while sand carries only dead bushes and cacti.
- Sand and gravel **fall** when unsupported.

### Lighting
A real two-channel voxel light engine:
- **Sky light** seeded from the top, falling straight down at full strength and
  spreading sideways losing one level per step.
- **Block light** from torches (14), glowstone and lava (15).
- Full **removal** propagation, so mining out a torch genuinely darkens the
  room, and re-sealing a hole re-lights it.
- Cross-chunk flood fill, with a 3×3 chunk cache so the fill runs on integer
  maths instead of string-keyed map lookups.
- Per-vertex **ambient occlusion** and **smooth lighting** baked into the
  mesh, combined in the shader with a Minecraft-style light curve and a warm
  torch tint.

### Survival
- Health (20), hunger (20), saturation, exhaustion, air and XP levels on the
  vanilla curve.
- Exhaustion from sprinting, jumping, walking and mining; burns saturation
  then hunger; natural regen only at 18+ hunger; starvation at zero.
- Fall damage past 3 blocks, drowning with an air meter, cactus and lava
  contact damage, armour damage reduction (4% per point, capped at 80%).
- **Item drops** — broken blocks and `Q` spawn real dropped stacks that fall
  with gravity, settle on the ground, bob, merge into piles, and are picked up
  again by walking over them.
- Death drops your entire inventory — the stakes are real.

### The Nether
A second dimension, reached through a portal you build yourself out of
obsidian and lit with flint and steel:
- **Terrain** from four noise fields — a netherrack ceiling hung with glowstone
  patches, a floor of lava at `y = 21`, bedrock pillars standing out of it, and
  **basalt deltas** on the floor of the low ground. A crust of solid netherrack
  sits over the caverns so the ceiling is not the only solid thing.
- **No sky at all**: no sun, no moon, no stars, no clouds, a fixed dark red
  dome, and its own ambient light. Everything you can see is lit by lava,
  glowstone or magma.
- **Fire is a block** — it burns out on its own, water puts it out, and it
  spreads across netherrack and nothing else. Netherrack is fireproof.
- **Portals** are real sheets of `nether_portal` blocks that only exist where
  the frame is at least 2 wide and 3 tall, hum when you are near one, and all
  die together when the frame is broken. Travelling scales 1:8 in x/z and half
  in y, and there is a five-second cooldown on arrival.
- Its own music: *Lethal Nether Land*, credited in the music panel.

### Life & progression
- **A chicken** — the vanilla model, unwrapped from the pack's own 64×32 skin,
  with all nine of its sounds from the pack. It wanders, flutters, clucks, runs
  from you, falls when there is nothing under it, and drops one chicken and zero
  to two feathers, read straight out of the pack's loot table.
- **Thrown ender pearls**, which are projectiles and not dropped items.
- **Three game modes** — survival, creative (flight, no mining, no hunger) and
  spectator (no hitbox at all, passes through terrain).
- **Advancements** from a tree of conditions, grouped into tabs, with a toast
  the moment one is earned. Conditions are re-tested per frame rather than
  pushed as events, because most of them are state you already have.
- **Statistics** — distance walked, blocks mined and placed, deaths, time
  played, per-item breakdowns.
- **A Bedrock autosave indicator**, top right, playing while a write is in
  flight.

### Items & crafting
- 9 hotbar + 27 main + 4 armour slots, stack sizes, tool durability bars.
- **~60 crafting recipes**: shaped (matched anywhere in the grid, like the
  real game) and shapeless, covering planks, sticks, crafting table, furnace,
  chest, torches, bowls, buckets, all four tool tiers, three armour sets,
  mineral block compression/decompression, and more.
- **Furnace** tile entities with fuel values, smelting time and a live flame /
  progress display. Smelts ore to ingots, sand to glass, clay to brick, logs
  to charcoal, and cooks meat.
- Mining uses the **exact vanilla break-time formula**:
  `seconds = hardness * (canHarvest ? 1.5 : 5) / speed`, where a tool only
  contributes its speed when its *type* matches the block, and drops are gated
  by harvest level. So stone takes 7.5s by hand, 1.13s with a wooden pickaxe,
  and 9.4s of obsidian with a diamond pickaxe. A wooden pickaxe digs iron ore
  at full speed but drops nothing.
- **Block breaking animation** — the ten `destroy_stage` sheets are multiplied
  over the block (they are cumulative masks, white where intact and dark where
  cracked), so the cracks spread as the block breaks and the block stays
  visible the whole time.

### UI
- **One texture atlas** for all block geometry; four draw groups per chunk
  (opaque, alpha-cutout, water, lava).
- **Localisation** — UI strings, item names, block names, splash texts and the
  version all come from JSON files in `assets/lang/`, in the same spirit as
  Minecraft's `en_us.json`. Ships with English (US), English (UK) and Spanish.
  Switching language re-renders everything on screen, and a partial translation
  falls back to English per key.
- **Options with categories** (Video / Audio / Gameplay / Controls) in the real
  Minecraft bitmap font, with a GUI scale that the window size picks
  automatically and that you can override, plus render distance (up to 32),
  FOV, brightness, cloud height, view bobbing and volumes.
- **Rebindable controls** — the Controls tab lists every action and its key the
  way the real game's key bind screen does. Click a key to rebind it, right
  click to reset one row, Escape to cancel, Backspace to unbind. Colliding
  bindings clear each other, so two actions can never share a key. Attack and
  Use Item are listed but fixed to the mouse. Bindings are saved with the rest
  of the settings.
- **Real Minecraft bitmap font** — text is rasterised from `assets/font/ascii.png`
  into canvases with measured per-glyph advance widths, cached by string.
- **Isometric item icons** — blocks drawn as shaded 3-face cubes, items as
  sprites, exactly like the vanilla inventory.
- **Day/night cycle** with a gradient sky dome, sun, moon, 900 stars, and fog
  colour that tracks the horizon. The vanilla `clouds.png` is a 4×4 sheet of
  different cloud cells rather than one tileable image, so a small shader picks
  one hashed cell per world tile; otherwise the whole atlas shows as a grid.
  Cloud height is an option.
- Break particles that sample the actual block texture; destroy-stage crack
  overlay; swing and view-bob animations; first-person held-item view model
  rendered in its own pass so it never clips into terrain.
- Underwater tint, damage flash, vignette, toasts, item-name popups.
- **A loading screen with a splash**, drawn in the game's own bitmap font above
  the progress bar, and a **crash screen**: an error that escapes — thrown in a
  frame callback, rejected from a promise, or thrown during boot — lands on a
  readable report with a copyable code and a **Copy details** button instead of
  a console the player may never have open. A lost WebGL context saves the
  world, stops the loop and explains itself, then picks back up if the browser
  restores the context.

### Audio
The **real Minecraft sound files**, not synthesis:
- Per-material dig, break, place and footstep sounds with randomised variants
  and slight pitch jitter, decoded once and replayed through a source pool.
- Player hurt, fall, eat, drink, level up, crafting, pickup, splash, swim,
  chest, bubbles and UI clicks.
- **Ambient cave drones** and **underwater ambience** cross-faded by where you
  are, with music ducked underwater.
- **Music**: the main menu theme plus a shuffled in-game playlist.

---

## Project layout

```
index.html              markup + importmap
CHANGELOG 1.4.md        release notes, newest last
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
    World.js            chunk streaming, raycast, editing, save
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
  copy-assets.ps1       extract textures from the asset pack
  copy-audio.ps1        extract sounds and music from the asset pack
vendor/three.module.js  three.js r160
```

---

## Asset provenance

Textures, GUI sprites, sounds and music come from the Minecraft client asset
pack already present in this folder (`minecraft-assets-26.3/`, version 26.3).
`tools/copy-assets.ps1` and `tools/copy-audio.ps1` extract exactly the subset
the game uses into `assets/`, so the game folder is self-contained. All game
code, shaders, UI and systems are original.

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
