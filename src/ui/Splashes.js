/**
 * Title screen splash texts.
 *
 * This is the shared English list. Minecraft picks one at random every time the
 * main menu is opened. Kept in its own file so the list is easy to find and
 * extend - just add strings.
 *
 * A language can override the whole list by adding a `"splash": [...]` array to
 * its JSON file in `assets/lang/`; anything it leaves out falls back to this one.
 */

export const SPLASHES = [
  // ---- the classics ----
  'Now with 100% more blocks!',
  'As seen on TV!',
  'Awesome!',
  'May contain nuts!',
  'Limited edition!',
  'Wow!',
  'Also try infinite worlds!',
  'Made of voxels!',
  'It works in your browser!',
  'Survive the night!',
  'Every block is hand placed',
  'Infinite worlds, finite patience',

  // ---- things that will get you killed ----
  'Do not dig straight down',
  'Dig straight down, they said',
  'Diamonds are below y=16, lava is too',
  'Cactus: yes it hurts',
  'Water is wet, lava is a pinky promise',
  'The fall damage is not a suggestion',
  'Skeletons never miss. Never.',
  'Watch out for creepers!',
  'Awww man!',
  'That was my only pickaxe',
  'Herobrine not found',
  'Your bed is respawning elsewhere',
  'Sleep is for the bold',
  'Night is just the tutorial ending',

  // ---- gravity worlds ----
  'Down is optional',
  'Gravity is a suggestion',
  'The floor is wherever you land',
  'Falling up, technically',
  'Sideways is a direction too',
  'Sir, you are standing on the sky',

  // ---- enderman ----
  'Do not look at it',
  'It watched back',
  'Look away. Now.',
  'Enderman stole your block',
  'It teleported into your walls',
  'Purple eyes in purple sky',

  // ---- chunks, physics, engine ----
  'Voxels all the way down',
  '16 by 16 by forever',
  'One chunk at a time',
  'I feel chunked',
  'Generated, not grown',
  'Trees spawn deterministically',
  'Trees spawn on Tuesdays',
  'The light engine is real',
  'Ambient occlusion!',
  'Smooth lighting, roughly',
  'Shaders were patched',
  'It is JavaScript all the way down',
  'Three.js does the heavy lifting',
  '60fps or bust',
  'The atlas is one image',
  'Every footstep is sampled',
  'It works, do not touch it',
  'Works on my machine',
  'TODO: comment that out',
  'Bugs are features',
  'Fixed by adding a semicolon',

  // ---- hands off the controls ----
  'Press F3 for the good stuff',
  'Press F5 to see yourself',
  'Press F2 for a photo',
  'E for inventory, not for you',
  'Q drops things, do not lose them',
  'Shift sneaks so you do not fall',
  'Ctrl makes you go faster',
  'WASD, the four horsemen',
  'Escape is just a suggestion too',

  // ---- food & farming ----
  'Punch a tree, get wood',
  'Apples drop from leaves',
  'Leaves are cutout, not solid',
  'Eat the apple. Trust me.',
  'Bread: now with 100% more grain',
  'Farming is just waiting',

  // ---- world tour ----
  'The sky is not the limit!',
  'The sky is purple over there',
  'The sun really moves',
  'Clouds are optional',
  'One whole day is 10 minutes',
  'Time moves whether you like it or not',
  'It is a big world',
  'Try a funny seed',
  'Try seed: hello',
  'Try seed: 12345',
  'No grass on sand!',
  'Dead bushes welcome',
  'Seas are full of water, unfortunately',
  'Caves are dark, bring torches',
  'Rocks are heavy, dirt is light',
  'Slabs are half blocks',
  'Stairs look the right way up',
  'Fences connect automatically',
  'Walls are thin on purpose',
  'Torches are sold separately',
  'Gravel? Not your problem!',
  'Sand is gravity-enabled',
  'You can craft that',

  // ---- mobs ----
  'Passive mobs: also 0',
  'Hostile mobs: 0',
  'Chickens have opinions',
  'Pigs are friends, and dinner',
  'Zombies clubbing again',
  'Ghasts are crying',
  'Steve checks his pockets',
  'Every mob is hand coded',
  'Wolves do not bite, yet',

  // ---- you, the player ----
  'You are reading this',
  'Still reading?',
  'Go play already!',
  'Congratulations! You did it!',
  'Achievement unlocked: reading',
  'Singleplayer only, for now',
  'Saves locally in your browser',
  'Autosaves when you quit',
  'No accounts needed',
  'Made by hand, mostly',
  'Difficulty: you decide',
  'Best viewed fullscreen',
  'Built for survival',
  'Now in 3D!',
  'Zero gravity (mostly)!',
  'Contains 90% more dirt!',
  'DIRT, DIRT DIRT!',
];

export function randomSplash(active = SPLASHES) {
  return active[(Math.random() * active.length) | 0];
}
