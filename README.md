# Minexel

A voxel survival game in the browser, built with three.js and real Minecraft assets. Runs in the Electron desktop app or your browser.

**Asset notice:** Textures, sounds, music, and models are extracted from the Minecraft client asset pack and belong to Mojang/Microsoft. Used for non-commercial, educational purposes. See LICENSE.md.

---

## Getting started

Electron (recommended):

```
npm run electron
```

Browser: open `index.html` in Chrome/Edge/Firefox. Save progress only works in Electron.

---

## Controls

Rebindable in Options → Controls.

| Key | Action |
|-----|--------|
| W A S D | Move |
| Space | Jump / swim up (double-tap toggles creative flight) |
| Shift | Sneak (won't walk off ledges) |
| Ctrl | Sprint, or Ctrl+Q to drop the whole stack |
| Mouse | Look |
| Left click | Mine (hold) |
| Right click | Place / open block / hold to eat |
| Middle click | Pick Block |
| 1–9 | Select hotbar slot |
| E | Inventory + 2×2 crafting |
| I | Creative inventory |
| Q | Drop held item |
| T | Chat |
| / | Chat with slash already typed |
| F1 | Hide HUD |
| F3 | Debug overlay |
| F3 C | Copy coordinates |
| F5 | Cycle camera (first → third → front) |
| F2 | Screenshot |
| Esc | Pause menu |

Sprinting and sneaking can be toggled (Options → Gameplay → Toggle Sprint / Toggle Sneak).

---

## Controller

Standard Xbox-style gamepad works out of the box. Nothing to configure.

| Control | Action |
|---------|--------|
| Left stick | Move |
| Right stick | Look |
| A | Jump |
| B | Sneak |
| RT | Mine (hold) |
| LT | Place / eat / use item |
| X | Pick Block |
| Y | Inventory / Creative inventory |
| Start | Pause menu |
| Right stick click | Cycle camera |
| D-pad right | Open chat |
| D-pad down | Drop held item stack |

Chat still uses the keyboard.

---

## World types

**Default** — infinite terrain, caves, ores, trees, 11 biomes.

**Flat** — bedrock, stone, dirt, grass cap. No caves or trees.

**Amplified** — extreme terrain, taller mountains and deeper valleys.

**Cursed** — gravity pulls a random direction every few seconds. Sky ceiling deals damage above y = 188.

---

## World

- Infinite chunked terrain (16×128×16 chunks) streamed around the player
- Block shapes: cubes, slabs, stairs, fences, glass panes, walls, posts
- 11 biomes: plains, forest, taiga, snowy plains, desert, savanna, swamp, mountains, jungle, beach, ocean
- Caves from intersecting noise fields; ore veins placed by depth
- Oak, birch, spruce trees
- Sand and gravel fall when unsupported
- Grass, ferns, flowers grow on grass-like soil

---

## Lighting

Two-channel voxel light engine:

- **Sky light** — seeds from the top, loses one level per step sideways
- **Block light** — torches (14), glowstone and lava (15)
- Removal propagation — mining out a torch darkens the room
- Ambient occlusion and smooth lighting with Minecraft-style light curve

---

## Survival

- Health (20), hunger (20), saturation, exhaustion, air, XP on the vanilla curve
- Exhaustion from sprinting, jumping, walking, mining; burns saturation then hunger
- Natural regen at 18+ hunger; starvation at zero
- Fall damage past 3 blocks, drowning, cactus and lava contact damage
- Armour damage reduction (4% per point, capped at 80%)
- Item drops — broken blocks and Q spawn real dropped stacks that fall with gravity, settle, bob, merge, and are picked up by walking over them
- Death drops your entire inventory

---

## The Nether

Reach it through an obsidian portal lit with flint and steel:

- Netherrack ceiling with glowstone patches, lava floor at y = 21, bedrock pillars, basalt deltas
- No sky — fixed dark red dome, lit only by lava, glowstone, or magma
- Fire is a block — burns out on its own, water puts it out, spreads on netherrack only
- Portals are real sheets of nether_portal blocks (frame at least 2×3). Travel scales 1:8 in x/z and half in y

---

## Life & progression

- **Chicken** — wanders, flutters, clucks, runs from you, drops chicken and feathers
- **Zombie** — spawns at night, burns in daylight, attacks at close range, drops rotten flesh
- **Creeper** — stalks the player, fuses when close, explodes; drops gunpowder when killed by the player
- **Enderman** — teleports, avoids water, picks up blocks
- **Igniter** — nether fire creeper, explodes with fire
- Three game modes: survival, creative (flight, no mining, no hunger), spectator
- Advancements tree with toasts
- Statistics: distance walked, blocks mined/placed, deaths, time played, per-item breakdowns

---

## Items & crafting

- 9 hotbar + 27 main + 4 armour slots, stack sizes, tool durability bars
- ~60 crafting recipes — shaped and shapeless, covering planks, sticks, crafting table, furnace, chest, torches, buckets, all four tool tiers, three armour sets, mineral blocks
- Furnace with fuel values, smelting time, live flame/progress display
- Mining uses the vanilla break-time formula
- TNT — primed by flint and steel or fire, 4-second fuse, power 4 explosion
- Block breaking animation with ten destroy_stage sheets

---

## UI

- One texture atlas for all block geometry; four draw groups per chunk
- Localisation — UI strings, item names, block names from JSON files in assets/lang/
- Options with categories (Video / Audio / Gameplay / Controls) in Minecraft bitmap font
- Rebindable controls — click a key to rebind, right click to reset, Escape to cancel
- Isometric item icons — blocks as shaded 3-face cubes, items as sprites
- Day/night cycle — gradient sky dome, sun, moon, 900 stars, fog colour tracking the horizon
- Break particles, destroy-stage cracks, swing and view-bob animations
- Underwater tint, damage flash, vignette, toasts, item-name popups
- Loading screen with splash and crash screen with copyable error report

---

## Audio

Real Minecraft sound files, not synthesis:

- Per-material dig, break, place and footstep sounds with randomised variants and pitch jitter
- Player hurt, fall, eat, drink, level up, crafting, pickup, splash, swim, chest, bubbles, UI clicks
- Ambient cave drones and underwater ambience, with music ducked underwater
- Music: main menu theme plus shuffled in-game playlist
- Creeper idle/hurt/death, fuse hiss and explosion, TNT explosion

---

## Commands

`/help` `/give` `/gamemode` `/clear` `/time` `/say` `/kill` `/list` `/seed` `/teleport` (`/tp`) `/summon` `/difficulty` `/experience` (`/xp`)

Coordinates: bare number is relative to the player; tilde makes it absolute. `/summon chicken 0 5 0` is five blocks up; `/summon chicken ~ ~ ~` is exactly where you stand.

---

## Performance notes

Frame loop bounds chunk work by wall-clock time and adapts the budget to measured frame time. Two fixes mattered most:

- Light engine runs on a 3×3 chunk cache of integer indices (~2 ms per chunk instead of ~20 ms)
- Chunks are only re-meshed when their light actually changed

Typical numbers at render distance 7 (289 chunks, 1.1M triangles): initial load ≈ 4 s, then ~0 ms of chunk work per frame.

---

## Saves

Worlds are plain JSON files in `%APPDATA%\Minexel\worlds`, one per world. Writes are atomic (temp file → flush → rename). Every world keeps a backup (`.json.bak`). Damaged worlds are listed with a warning rather than quietly disappearing.

Only the desktop app saves. In a plain browser nothing persists after the tab closes.
