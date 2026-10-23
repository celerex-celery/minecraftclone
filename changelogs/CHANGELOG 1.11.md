# Changelog

All notable changes to Minecraft Voxel, newest first.

## 1.11

### Added
- New splash text: "DIRT, DIRT DIRT!"

### Removed
- Removed splash text: "Mobs coming soon!" because we have mobs
- Removed "Project layout" section from README
- Removed redundant Chest.png source (game uses assets/textures/gui/chest_icon.png directly)

### Changed
- Version bumped to 1.11 (1.10 "Visual & Survival Refinement Update" is complete)
- 1.11 is the next development version
- Moved Chest.png → assets/textures/gui/ and updated copy-assets.ps1 path
- Moved changelogs into changelogs/ folder
- Removed leftover CHANGELOG 1.1 Finished.md
- Moved title screenshots into assets/images/ folder
- Updated README build badge to 1.11

### Fixed
- Enable depth test for sun/moon to prevent seeing through blocks
- Only hide sky when completely underground (sky light = 0)
- **Sky light seeding**: fixed bug where sky light at 15 didn't decay through semi-transparent blocks (leaves, water), causing light leaks
- **Sky column update**: fixed duplicate condition in `updateSkyColumn` that prevented proper decay
- **Cave darkness**: lowered overworld ambient floor from 0.048 to 0.01 for genuinely dark caves
- **Removed sun directional light** (penetrated caves without shadows) and reduced ambient light intensity for mobs

### Planned for 1.11
- Additional visual refinements
- Survival gameplay improvements
- New features and content

---
