# Changelog

All notable changes to Minecraft Voxel, newest first.

## 1.1

The version string on the title screen now reads **Version 1.1**.

### Added
- **Rebindable controls** — a new **Controls** category in Options, laid out like
  the real game's key bind screen: one row per action with the key that triggers
  it. Click a key to listen for a replacement, right click a key to reset that
  one row, or use **Reset All** to go back to the defaults. Escape cancels a
  rebind, Backspace/Delete unbinds an action entirely, and a bare modifier press
  is ignored so `Ctrl`+`K` binds `K` rather than the Ctrl.
  - Bindings that would collide clear the other action, so two actions can never
    silently end up on one key.
  - **Attack** (left click) and **Use Item** (right click) are listed but fixed,
    since a mouse button is the only sensible binding for either.
  - The whole input layer now asks about *actions* (`forward`, `jump`, `attack`)
    rather than key codes, so rebinding touches no gameplay code at all. The
    table is saved with the rest of the settings.
- **Pick Block** on `B` (middle click also works) — grabs whatever is under the
  crosshair into the hotbar. It picks the thing the block actually drops, so
  grass gives dirt and a lit furnace gives a furnace, which is what makes it
  useful for building.
- **Language option** — UI, item names, block names, splash texts and the
  version string all load from JSON language files in `assets/lang/`, the same
  idea as Minecraft's own `en_us.json`. Ships with English (US), English (UK)
  and Spanish. Clicking the Language row in Options swaps to a standalone
  Language screen with a scrollable list and a tick on the active entry,
  exactly like the real game; Done goes back to Options. Picking a language
  switches immediately so you can read the menu in the language you just
  chose. Adding a language means dropping in a new JSON file.
- **Block shapes** — every block is now built from axis-aligned boxes:
  - slabs (bottom and top) for oak, stone, cobblestone, sandstone, brick,
    stone brick, mossy cobblestone and deepslate
  - stairs for the same eight materials
  - oak, birch and spruce fences, glass panes, and cobblestone / stone brick /
    brick walls — fences, panes and walls connect to their neighbours
  - slab and fence textures are derived from the plain block sheets at load
    time, because the client asset pack only ships the base textures
- **Block breaking animation** — the ten `destroy_stage` sheets are multiplied
  over the block, so cracks spread as the block breaks and the block stays
  visible throughout.
- **Real item drops** — broken blocks and `Q` spawn stacks that fall with
  gravity, settle, bob, merge into piles and are picked up by walking over them.
- **Water waves** — the surface ripples with a sum of four sine waves phased in
  *world* space, so they run continuously across chunk borders instead of
  restarting every 16 blocks. A per-vertex mask keeps the sides and floor still,
  so the block keeps its shape. Wave height and speed are options.
- **Cave and underwater ambience** chosen by actual sky light (4 or below, the
  same rule the real game uses) with cross fades, and music ducked underwater.
- **Options screen with categories** (Video / Audio / Gameplay / Controls)
  rendered in a two-pane layout with a tab column, GUI scale with an auto mode,
  render distance up to 32, cloud height, a clouds toggle, wave height and speed
  and mouse sensitivity.
- **Language screen** — a standalone full-bleed screen over a blown-up,
  pixelated dirt backdrop, with a scrollable list and a tick on the active
  entry, exactly like the real one. Each language names the others in its own
  language, so Spanish shows "Ingles (Estados Unidos)" and English shows
  "Spanish (Espanol)".
- Screenshot on `F2`, third person camera on `F5`.
- Headless test suite and a chunk pipeline profiler.

### Changed
- **Random seeds are now numbers, not words.** Leaving the seed field blank, or
  pressing the dice button, fills it with a random number of up to ten digits
  rather than an adjective-noun pair. About half are negative, like the seeds
  the real game hands out. The sign survives a copy/paste round trip, so a
  written-down seed regenerates the same world.
- **Break times now match vanilla exactly**:
  `seconds = hardness * (canHarvest ? 1.5 : 5) / speed`, where a tool only
  contributes its speed when its *type* matches the block. Obsidian was also
  corrected from 25 to its real hardness of 50. Mining with your eyes under
  water costs a flat 5× — the same `getDestroySpeed` penalty the real game
  applies — except when the block being mined is itself water.
- **Mining only drops what the tool can harvest** — the tier check is no longer
  short-circuited, so a wooden pickaxe digs iron ore quickly but drops nothing.
- **Left click no longer places blocks.** Both mouse buttons were routed to the
  place path, so mining a block with a block in hand put a block down instead.
  Left click now only mines (or opens a crafting table / furnace); right click
  places, starts eating, or opens the block.
- **Water and lava are replaceable**, so a torch placed in water sticks and
  lights instead of the placement being refused. Plants and torches also refuse
  to float with nothing underneath them.
- The day starts in the morning rather than at night, and the sun/moon now
  follow the vanilla clock (0 = sunrise, 6000 = noon, 18000 = midnight).
- The day length is no longer an option. The slider wrote a setting that
  nothing read, so moving it did nothing; `/time set` and `/time add` are the
  way to move the clock instead.
- Standing on a cactus hurts, as does brushing past one.
- Grass, ferns and flowers only grow on grass-like soil; sand carries only
  dead bushes and cacti.
- Clouds use a shader that picks one cell out of the 4×4 vanilla atlas per
  world tile, instead of tiling the whole sheet as a visible grid.
- The light engine runs on a 3×3 chunk cache of integer indices, and chunks
  are only re-meshed when their light actually changed. A light → mesh →
  light feedback loop that ran 68 light passes per chunk is gone. Initial load
  at render distance 7 went from ~7s to ~4s, and steady-state chunk work is
  essentially zero.
- The renderer draws at 1 device pixel per CSS pixel, which is by far the
  largest fill-rate saving on a high-DPI screen.
- Menus no longer scale with the HUD; they are sized in plain pixels with
  viewport guards so the inventory never becomes a wall of pixels.
- The HUD is laid out at vanilla proportions: 182×22 hotbar, 5px XP bar, 9px
  status icons, with armour above hearts and bubbles above hunger.

### Fixed
- **Every non-liquid material stopped rendering.** Splitting lava out of the
  water material meant the scrolling-texture line was being emitted into the
  opaque and cutout shaders too. Those materials also carry a map, so `USE_MAP`
  was defined and the shader referenced a `uWaterOffset` that only liquids
  declare — which is a hard GLSL compile error, a black screen, and a couple of
  hundred `INVALID_OPERATION` lines a second in the console. The scroll line is
  now gated on the same flag that declares the uniform, and a test asserts the
  plain materials never mention it.
- **You spawned inside a tree on every new world.** `findSpawn` picks a column
  from the height map, and the height map knows nothing about decoration, so the
  point landed inside the canopy of whatever tree stood there. Spawning is now
  a second step that works from the generated blocks: it needs solid ground
  underfoot and two blocks of clear air, and if the column is blocked it spirals
  out to a nearby one instead of dropping you on the leaves. Applies to respawns
  too.
- **Lava was being drawn with the water material.** The mesher put every liquid
  in one geometry group and `buildChunkMesh` handed that whole group the water
  material, so lava got the water texture, the water transparency and the water
  wave displacement — a lava material had been built and animated every frame
  that nothing ever referenced. Lava now gets its own geometry group and its own
  shader mode: it still scrolls its texture, but it is opaque and it no longer
  ripples. Regression tests check the geometry split, the shader contents and
  the two materials' program cache keys.
- **A day length slider that did nothing** — see above; it has been removed.
- **The command tests were asserting against a raw key.** The suite never
  installed the real `en_us` table into the translator, so every `t()` call fell
  through to the key and all ten command checks failed for a reason that had
  nothing to do with the commands. The table is installed now, and the UI stub
  grew the `playerName` the command layer resolves its target against.
- **A test was asserting the bug it was written to catch.** The "left click does
  not place" check required left click to open blocks — the exact behaviour the
  change had removed — and grepped for the raw `input.leftPressed` flag, which
  the action-based input layer no longer uses. It now checks the real contract
  through the action names.
- **`saveExists()` called a method that did not exist.** It was never called, so
  it had sat there looking fine while being guaranteed to throw.
- **A corrupt chunk silently ate your edits.** A chunk whose save data failed to
  decode was skipped with no log, no toast and no marker on the world record.
- **A tooltip could render at `NaNpx`.** Closing a tooltip passed one argument
  to a three-argument signature, so the position maths produced an invalid CSS
  length that the browser silently dropped.
- **The Options panel never repainted on a language change**, so switching
  language with the panel open left the old language on screen.
- **The hotbar scrolled while a menu was open.** Scrolling is now only read
  while the pointer is locked, which is also what the real game does.
- **Level up and Pick Block toasts bypassed localisation.** Both built their
  text in English; the level up string already existed in all three language
  files and was never looked up.
- **Messed up block faces.** The multi-shape mesher built the bottom face's four
  corners in the wrong order, so every cube's underside was wound inside-out,
  and the liquid emitter used a single corner formula that ignored the face it
  was drawing, which scrambled water geometry. Face corners and their ambient
  occlusion offsets are now both derived from one per-face winding table, so a
  corner can never be shaded using a different cell than the vertex it belongs
  to. Regression tests check the corner order, the winding direction, slab
  extents, the water line and the wave mask.
- Hotbar scrolling, which did nothing while the pointer lock was being
  re-acquired.
- The camera no longer spins on the frame the pointer is grabbed, or when
  holding left click — the first huge movement delta is swallowed and any
  implausibly large delta is ignored.
- Pointer lock no longer throws when re-acquired straight after being released.
- The `destroy_stage` sheets were being passed to three.js as raw images
  rather than textures, so the breaking animation silently never appeared.
- The hunger bar was pushed off screen by two over-wide status columns.
- Dropped items spawned with a half-block offset from where they were thrown.
- Torches render as flat sprites when held and when dropped, instead of
  showing the whole texture on every face of a cube.
- The raycast place position was inverted on all three axes, so right-clicking
  a block's top face tried to place a block inside the floor.
- Falling sand and gravel were applied to the wrong coordinates.
- The underwater shader multiplied a vec3 by a vec4, which stopped the whole
  terrain shader from compiling.
- Mesher geometry was uploaded as raw typed arrays rather than
  `BufferAttribute`s, so chunks had no valid vertex data.
- The Options screen rendered *behind* the title screen, so it looked like
  nothing happened when opened from the main menu.

### Removed
- **Dead code.** The audit turned up a fair amount of it, and it is now gone:
  - exports nothing ever imported (`SaveGame.getSettings` / `.usage`,
    `PixelFont.element` / `FONT_SCALE`, `ItemIcons.clearIconCache`,
    `Lang.preload` / `.index`, `Noise.mulberry32` / `fbm3` / `ridged3`,
    `Lighting`'s `SKY` / `BLK` / `combined`, `Blocks.BLOCK_IDS` / `AIR_DEF`,
    `Chat.cancel` / `.clear`, `Survival.EXHAUSTION_PER_LEVEL`,
    `ScreenManager.anyOpen` / `.blocking`, `ChunkMaterials.setFog`)
  - `void` statements and empty branches left behind to satisfy a linter
  - never-called `SoundEngine` methods, the dead `Input.wheelLocked` flag, the
    unused `Input.enabled` flag and the unread `mouse.middle` tracker
  - duplicate `DIFFICULTY` tables in two modules with conflicting values (the
    dead one is gone; the live one stays)
  - a duplicated `titleCase`, a duplicated furnace-state literal, a duplicated
    pixel-ratio clamp, a duplicated `24`-tick day length, and a duplicated
    clear-inventory loop
  - `isPlaceable`, `Survival.canEat` and `CONFIG.USE_COOLDOWN` were dead exports
    with the same logic inlined at their call sites; the exports are now the
    ones being called
  - dead CSS (`.keybind-*` was kept and rebuilt for the Controls screen; the
    rest — `.title-footer`, `.lang-picker`, `.seed-row`, `.hotbar-count`,
    `.grid.g1`, `.tt-rarity` — is gone) and the dead `#world-seed-row` markup
    that no code ever read
  - the `CHANGELOG 1.1` empty file left next to the real changelog
- **`tools/patch-tests.mjs`**, a script that rewrote failing smoke-test
  expectations to match the implementation. Tests that can be patched to pass
  are not tests. The suite is fixed honestly instead, and the 16 checks that had
  drifted are the ones being looked at.

---

## 1.0 — first playable build

Infinite chunked terrain with eleven biomes, two-channel voxel lighting with
ambient occlusion and smooth lighting, survival stats (health, hunger,
exhaustion, air, XP), crafting and furnace smelting, item drops, day/night
cycle, the Minecraft bitmap font, isometric inventory icons, and real
Minecraft sound effects and music.
