# Changelog

All notable changes to Minecraft Voxel, newest first.

## 1.11

### Added
- **Igniter mob** (Nether fire creeper): spawns in nether biomes, immune to fire/lava, takes damage in water, explosion spawns fire
- **Desert Well structure**: generates rarely in desert biomes with sandstone well and water
- **Cave Carver system** (`src/world/generation/CaveCarver.js`): carver-based tunnels, chambers, shafts with branching (vanilla-style)
- **Aquifer system** (`src/world/generation/Aquifer.js`): lava pools (deep) and water pools (mid-depths) in cave pockets
- **GLB model loading** enabled in ModelLoader with async loading and mesh swapping
- **Bone meal on grass**: generates tall grass, ferns, poppies, dandelions, cornflowers, oxeye daisies in 3x3 area
- **Cave parameters tuned**: thinner tunnels, rarer cheese chambers, deeper deep caverns, fewer surface entrances
- **Fire creeper/fire_creeper aliases** for Igniter summon command

### Removed
- Removed splash text: "Mobs coming soon!" because we have mobs
- Removed "Project layout" section from README
- Removed redundant Chest.png source (game uses assets/textures/gui/chest_icon.png directly)
- Removed leftover CHANGELOG 1.1 Finished.md
- Removed `require()` calls from mob system (ES modules only)

### Changed
- Version bumped to 1.11 (1.10 "Visual & Survival Refinement Update" is complete)
- 1.11 is the next development version
- **Reorganized `src/world` into subfolders**:
  - `generation/` - WorldGen, NetherGen, CaveCarver, Aquifer, Chunk, ChunkMesher, Noise
  - `blocks/` - Blocks, FallingBlocks, FluidSim, Growth, Items, Materials, Spreading, TreeShapes, TextureAtlas, ShapeTextures
  - `entities/` - Mobs, Particles, ItemDrops, EnderPearls, Boat, EntityShadows, Pathfinding
  - `structures/` - Chests, Beds, BonusChest, Portal, DesertWell, EndGen
  - `lighting/` - Lighting, Sky
  - `environment/` - World, Weather, Seasons, SnowSim
- Moved Chest.png → assets/textures/gui/ and updated copy-assets.ps1 path
- Moved changelogs into changelogs/ folder
- Moved title screenshots into assets/images/ folder
- Updated README build badge to 1.11
- **Model rendering**: switched to MeshLambertMaterial for GLB models (fixes dark appearance)
- **Cave parameters**: `DEEP_Y: -48`, `DEEP_THRESHOLD: 0.95`, `TUNNEL_SCALE: 0.028`, `SURFACE_GUARD: 6`, `CHEESE_Y: 30`, `CHEESE_THRESHOLD: 0.9`, reduced spaghetti/noodle caves, fewer entrances

### Fixed
- Enable depth test for sun/moon to prevent seeing through blocks
- Only hide sky when completely underground (sky light = 0)
- **Sky light seeding**: fixed bug where sky light at 15 didn't decay through semi-transparent blocks (leaves, water), causing light leaks
- **Sky column update**: fixed duplicate condition in `updateSkyColumn` that prevented proper decay
- **Cave darkness**: lowered overworld ambient floor from 0.048 to 0.01 for genuinely dark caves
- **Removed sun directional light** (penetrated caves without shadows) and reduced ambient light intensity for mobs
- **Igniter explosion**: no fire on existing fire, no floating fire (requires solid block underneath)
- **Bone meal**: fixed `Blocks.id()` destructuring bug that prevented vegetation generation
- **Mob.hurt**: removed `require()` ReferenceError
- **Herd.shove**: replaced `require()` with import for `blockedAt`
- **Herd imports**: restored `rayBox`, `biomeSpawnsFor`, `babyOf`, `SPAWNABLE_ON` from MobSpawning
- **Commands**: fixed `listVariants`/`resolveVariant` import from Variants module
- **Spreading._scatter**: added missing `air` destructuring
- **Desert well**: refactored to use new DesertWell.js module in structures/

### Planned for 1.11
- Additional visual refinements
- Survival gameplay improvements
- New features and content

---
