# Changelog 1.10

## Visual & Sky
- **Sky rendering**: Hide sun, moon, stars, clouds when player is underground (sky light ≤ 4)
- **Clouds**: Fixed rendering through blocks by enabling depth test and sizing cloud plane to camera far plane
- **Sun**: Larger (120→60), added procedural glow/halo, fixed black edge artifacts
- **Moon**: Same size as sun (120), subtle glow (40% intensity)
- **Stars**: Enable depth test so they don't render through blocks in caves
- **Snow weather**: Reduced overcast from 0.7 to 0.35 (less bright white/grey)
- **Lighting**: Added Three.js DirectionalLight (sun) and AmbientLight synced with sky

## Mobs
- **Creepers**: 
  - Ignore player in creative/spectator mode
  - Spawn solo (max 1) instead of groups (was 1-4)
  - Reduced explosion power from 3 → 2.5
- **All monsters**: Ignore player in creative/spectator mode
- **Spawn distance**: Increased MIN_DISTANCE from 24 → 28 blocks
- **Mob materials**: Changed to MeshStandardMaterial with vertexColors for proper lighting response

## World Generation
- **Desert wells**: Increased chance from 1/1000 to 1/500 chunks

## UI / Menus
- **Recipe Book**: Added to inventory and crafting table screens
- **Advancements**: 
  - /advancement grant|revoke command with tab completion
  - Fixed syntax error in _pump() method
  - Pause menu button width increased (200→240px) for "Advancements" text
- **Bonus Chest**: World creation option, spawns near player in survival

## Bug Fixes
- Fixed syntax errors in Advancements.js and Mobs.js
- Sky visibility check now uses camera (eye) position instead of feet position
- Stars and clouds properly occluded by blocks

## Input / Commands
- F1 toggles HUD
- F3+C copies coordinates
- Pick block on middle mouse button
- Toggle sprint/sneak
- /advancement command with grant/revoke subcommands

## Save System
- Atomic writes (tmp → fsync → rename)
- Per-world backup (.json.bak)
- Recovery from damaged files

## Sneak Model
- Reverted to vanilla sneak: body/head sink, arms tip forward, legs shift back