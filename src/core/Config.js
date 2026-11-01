export const CONFIG = {

  CHUNK_SIZE: 16,
  MIN_Y: -64,
  WORLD_HEIGHT: 384,
  SEA_LEVEL: 63,
  CHUNK_SECTION: 16,

  WORLD_TOP: -64 + 384 - 1,

  DEEPSLATE_TOP: 0,

  DEEPSLATE_BLEND: 8,

  RAVINE: {

    CELL: 64,

    DENSITY: 0.12,

    DENSITY_SCALE: 0.0021,

    JITTER: 14,

    MIN_Y: -64,
    MAX_Y: 200,

    WIDTH_MIN: 2.0,
    WIDTH_MAX: 5.0,
    HEIGHT_MIN: 2.5,
    HEIGHT_MAX: 7.0,

    YAW: 6.0,
  },

   CAVES: {
    TUNNEL_SCALE: 0.028,
    TUNNEL_THRESHOLD: 0.05,

    SURFACE_GUARD: 6,
    CHEESE_Y: 30,
    CHEESE_SCALE: 0.02,
    CHEESE_THRESHOLD: 0.9,

    DEEP_Y: -48,
    DEEP_SCALE: 0.012,
    DEEP_THRESHOLD: 0.95,

    SPAGHETTI_2D_SCALE: 0.005,
    SPAGHETTI_2D_RARITY: 0.6,
    SPAGHETTI_3D_SCALE: 0.02,
    SPAGHETTI_3D_RARITY: 0.5,

    NOODLE_SCALE: 0.008,
    NOODLE_THICKNESS: 0.03,
    NOODLE_Y_MIN: -48,
    NOODLE_Y_MAX: 120,

    ENTRANCE_SCALE: 0.015,
    ENTRANCE_THRESHOLD: 0.98,
    ENTRANCE_SURFACE_GUARD: 3,
  },

  POOLS: {

    LAVA_MAX_Y: -24,

    WATER_MIN_Y: -12,
    WATER_MAX_Y: 30,

    SCALE: 0.012,

    WATER_THRESHOLD: 0.40,
    LAVA_THRESHOLD: 0.55,

    MIN_CAVITY: 2,
    MAX_CAVITY: 24,

    LEVEL_MIN: 2,
    LEVEL_MAX: 5,
    FILL_DEPTH: 6,
  },

  MOSS: {

    MAX_Y: 0,
    SCALE: 0.045,
    THRESHOLD: 0.55,
  },

  NETHER: {

    FLOOR_Y: 0,
    ROOF_Y: 127,

    BEDROCK_DEPTH: 2,

    ROOF_ROCK: 3,

    GLOWSTONE_Y: 123,

    LAVA_SEA_Y: 26,

    SURFACE_BASE: 30,
    SURFACE_UP: 44,
    SURFACE_CURVE_UP: 0.8,
    SURFACE_DOWN: 46,
    SURFACE_CURVE_DOWN: 1.6,
    SURFACE_SCALE: 0.0072,
    SURFACE_DETAIL: 0.030,
    SURFACE_DETAIL_AMP: 5,

    CLIFF_SCALE: 0.028,
    CLIFF_AMP: 14,
    CLIFF_CURVE: 0.7,

    WALL_SCALE: 0.0060,
    WALL_THRESHOLD: 0.42,
    WALL_TOP: 86,
    MIN_SURFACE: 6,
    MAX_SURFACE: 70,

    CRUST: 6,

    CRUST_NOISE_SCALE: 0.021,
    CRUST_VARIATION: 7,

    TERRACE_SCALE: 0.019,
    TERRACE_THRESHOLD: 0.20,
    TERRACE_STEP: 8,

    TUNNEL_SCALE: 0.018,
    TUNNEL_THRESHOLD: 0.055,

    TUNNEL2_SCALE: 0.055,
    TUNNEL2_THRESHOLD: 0.010,
    CAVERN_SCALE: 0.013,

    CAVERN_THRESHOLD: 0.13,

    CAVERN_EDGE: 0.12,
    CAVERN_SPAN: 34,

    DETAIL_MARGIN: 0.16,
    DETAIL_SCALE: 0.09,
    DETAIL_AMP: 0.22,

    ROOF_GUARD: 3,

    PILLAR_SCALE: 0.013,
    PILLAR_GATE: 0.62,
    PILLAR_MIN_TOP: 4,
    PILLAR_MAX_TOP: 44,

    GLOW_SCALE: 0.11,
    GLOW_THRESHOLD: 0.42,
    MAGMA_SCALE: 0.03,
    MAGMA_THRESHOLD: 0.36,
    SOUL_SAND_SCALE: 0.05,
    SOUL_SAND_THRESHOLD: 0.34,

    WARPED_CHANCE: 0.01,

    DELTA_SCALE: 0.014,
    DELTA_THRESHOLD: 0.30,

    DELTA_MAX_Y: 34,
  },

  RENDER_DISTANCE: 10,
  FOV: 70,
  MAX_FRAMETIME_MS: 1000 / 30,

  GEN_BUDGET: 2,
  LIGHT_BUDGET: 4,
  MESH_BUDGET: 4,

  PLAYER_HEIGHT: 1.8,
  PLAYER_WIDTH: 0.6,
  SNEAK_HEIGHT: 1.5,
  EYE_HEIGHT: 1.62,
  SNEAK_EYE_HEIGHT: 1.27,
  GRAVITY: 32.0,
  JUMP_SPEED: 8.95,
  WALK_SPEED: 4.317,
  SPRINT_SPEED: 5.612,
  SNEAK_SPEED: 1.31,
  FLY_SPEED: 10.9,
  FLY_SPRINT_SPEED: 21.8,

  FLY_ACCEL: 30,
  FLY_DECEL: 12,
  FLY_VERTICAL_RATE: 20,
  DOUBLE_TAP_TIME: 0.25,

  SPRINT_DOUBLE_TAP_SECONDS: 0.5,
  WATER_DRAG: 0.55,
  SWIM_SPEED: 2.2,
  TERMINAL_VELOCITY: 78.4,
  REACH_SURVIVAL: 4.5,
  REACH_CREATIVE: 5.0,

  STEP_HEIGHT: 0.6,

  TICKS_PER_SECOND: 20,
  GROUND_FRICTION: 0.546,
  WATER_FRICTION: 0.8,

  AIR_DRAG: 0.995,

  AIR_COAST_DRAG: 0.91,

  AIR_STEER: 0.05,

  SPRINT_FOV_SCALE: 1.1,

  LOOK_DEGREES_PER_COUNT: 0.15,
  LOOK_SENSITIVITY_MIDDLE: 3,

  BED_BOUNCE: 3.4,
  BED_LAND_BOUNCE: 4.2,

  BED_BOUNCE_INTERVAL: 0.34,

  BED_BOUNCE_MIN_SPEED: 0.6,

  REACH_SPECTATOR: 0,

  SPECTATOR_SPEED: 21.8,

  MAX_HEALTH: 20,
  MAX_HUNGER: 20,
  MAX_AIR: 300,
  REGEN_INTERVAL: 4.0,
  REGEN_HUNGER_FLOOR: 18,
  STARVE_INTERVAL: 4.0,
  FALL_DAMAGE_THRESHOLD: 3.0,

  DAY_TICKS: 24000,
  START_TIME: 1000,

  SEASON: {

    NAMES: [
      'hud.season.spring',
      'hud.season.summer',
      'hud.season.autumn',
      'hud.season.winter',
    ],

    EPOCH_YEAR: 2000,

    EPOCH_WEEKDAY: 0,

    ICON_SHEET: 'season_icons',
    ICON_COLS: 2,
    ICON_ROWS: 2,

    SNOW: {

      ACCUMULATE_RATE: 12,

      ACCUMULATE_CHANCE: 0.22,

      THAW_RATE: 18,

      THAW_CHANCE: 0.3,

      MAX_PER_FRAME: 12,

      SEASON_THAW_MULTIPLIER: 6,
      SEASON_THAW_DAYS: 8,
    },
  },

  SAPLING: {

    SCAN_RATE: 3,

    MAX_PER_FRAME: 6,

    MAX_TRACKED: 32,

    LIGHT: 8,

    SOIL: [
      'grass_block', 'dirt', 'coarse_dirt', 'podzol', 'mycelium',
      'rooted_dirt', 'moss_block', 'snow_block', 'farmland',
    ],

    TREES: {
      oak: { grow: 75, seasons: [0] },
      birch: { grow: 75, seasons: [0] },
      spruce: { grow: 55, seasons: [0, 1, 2, 3], snowFactor: 0.5 },
    },
  },

  WEATHER: {

    EASE: 0.35,

    RAIN_SPEED: 26,

    SNOW_SPEED: 4,

    SNOW_DRIFT: 1.6,

    RAIN_SIZE: 0.07,
    SNOW_SIZE: 0.11,

    PARTICLE_ALPHA: 0.75,

    DROPS: 1600,

    FOG_CUT: 0.45,

    LIGHTNING_FLASH: 0.55,

    RAIN_VOLUME: 0.5,
  },

  MOB: {

    HURT_FLASH: 0.4,

    HURT_COLOR: 0x8a2020,

    HURT_BRIGHTNESS: 0.35,

    KNOCKBACK: 5.5,

    KNOCKBACK_UP: 3.4,

    SWIM_SPEED_FACTOR: 0.55,

    DEATH_TIME: 1.5,

    FLEE_JUMP: 7.2,

    FLEE_JUMP_COOLDOWN: 0.5,
  },

  SPAWN: {

    INTERVAL: 1.0,

    ATTEMPTS: 3,

    RADIUS: 24,

    MIN_DISTANCE: 28,

    LIGHT_LEVEL: 8,

    LIGHT_FLOOR: 4,

    LIGHT_CHANCE: 0.1,

    LIMIT: 10,

    DESPAWN_DISTANCE: 64,

    DESPAWN_GRACE: 30,

    DESPAWN_PROXIMITY: 16,
  },

  BOAT: {

    PADDLE_SPEED: 5.0,

    WATER_SPEED_FACTOR: 0.98,
    LAND_SPEED_FACTOR: 0.75,
    SNOW_SPEED_FACTOR: 0.62,

    TURN: 1.5,
    LAND_TURN: 3.0,

    ACCEL: 4.0,

    DRAG: 0.6,

    LAND_DRAG: 6.0,

    SNOW_DRAG: 18.0,

    RIDE_HEIGHT: 0.12,

    SEAT_HEIGHT: 0.35,

    HALF: { x: 0.5, y: 0.3, z: 0.95 },

    DESPAWN_DISTANCE: 64,
    DESPAWN_GRACE: 30,

    PADDLE_RANGE: 16,

    MAX: 8,

    BREAK_HITS: 6,

    DAMAGE_TILT: 0.35,

    DAMAGE_TILT_SECONDS: 1.0,

    SWING_COOLDOWN: 0.4,

    STROKE_RATE: 0.9,

    STROKE_ARC: 0.75,

    ROLL: 0.12,
    IDLE_ROCK: 0.02,
  },

  PATHFINDING: {

    MAX_NODES: 1000,

    FRAME_BUDGET: 2000,

    MAX_RANGE: 48,

    WAYPOINT_REACHED: 0.9,

    GOAL_DRIFT: 1.0,

    REPATH_INTERVAL: 1.0,

    SEPARATION_RADIUS: 0.7,

    SEPARATION_FORCE: 0.8,
  },

     TIME_PRESETS: { day: 1000, noon: 6000, night: 13000, midnight: 18000 },

  PEARL: {
    COOLDOWN: 1.0,

    DAMAGE: 5,
  },

  FIRE: {

    LIFETIME: 45,

    BURN_THROUGH: 1.5,

    SPREAD_INTERVAL: 0.7,

    SPREAD_CHANCE: 0.38,

    MAX_SPREAD: 48,

    MAX_FLAMES: 160,

    DAMAGE_INTERVAL: 1.0,
  },

  AMBIENT_CAVE: {
    ENABLED: false,

    FIRST_GAP: 4,

    MIN_GAP: 60,
    MAX_GAP: 300,
  },

  MESH_SLICE_MS: 1.5,

  USE_COOLDOWN: 0.25,

  PORTAL: {
    MIN_WIDTH: 2,
    MIN_HEIGHT: 3,
    MAX_WIDTH: 21,
    MAX_HEIGHT: 21,

    EXTRA_SLACK: 2,

    SEARCH_RADIUS: 12,

    COORD_SCALE: 8,

    HEIGHT_SCALE: 2,

    TRANSITION_SECONDS: 0.9,

    REENTRY_DELAY: 5,

    COOLDOWN: 4.0,

    HUM_RANGE: 5,
  },

  AUTOSAVE_SECONDS: 15,

  SAVE_INDICATOR_MIN_MS: 1200,

  CHAT_MAX_LENGTH: 256,
  CHAT_LINES: 10,
  CHAT_FADE_SECONDS: 60,
  CHAT_HISTORY: 30,
};

export const MOUSE_LEFT = 'MouseLeft';
export const MOUSE_MIDDLE = 'MouseMiddle';
export const MOUSE_RIGHT = 'MouseRight';

const MODIFIERS = new Set([
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
  'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'CapsLock',
]);

export const KEYBINDS = [
  { action: 'forward', code: 'KeyW' },
  { action: 'back', code: 'KeyS' },
  { action: 'left', code: 'KeyA' },
  { action: 'right', code: 'KeyD' },
  { action: 'jump', code: 'Space' },
  { action: 'sneak', code: 'ShiftLeft' },
  { action: 'sprint', code: 'ControlLeft' },
  { action: 'attack', code: MOUSE_LEFT, mouse: true },
  { action: 'useItem', code: MOUSE_RIGHT, mouse: true },

  { action: 'pickBlock', code: MOUSE_MIDDLE },
  { action: 'dropItem', code: 'KeyQ' },
  { action: 'hotbar1', code: 'Digit1' },
  { action: 'hotbar2', code: 'Digit2' },
  { action: 'hotbar3', code: 'Digit3' },
  { action: 'hotbar4', code: 'Digit4' },
  { action: 'hotbar5', code: 'Digit5' },
  { action: 'hotbar6', code: 'Digit6' },
  { action: 'hotbar7', code: 'Digit7' },
  { action: 'hotbar8', code: 'Digit8' },
  { action: 'hotbar9', code: 'Digit9' },
  { action: 'inventory', code: 'KeyE' },
  { action: 'creativeInventory', code: 'KeyI' },
  { action: 'chat', code: 'KeyT' },
  { action: 'command', code: 'Slash' },
  { action: 'debug', code: 'F3' },
  { action: 'toggleHud', code: 'F1' },
  { action: 'perspective', code: 'F5' },
  { action: 'screenshot', code: 'F2' },
  { action: 'pause', code: 'Escape' },
  { action: 'steps', code: 'KeyM' },
];

export const ACTIONS = KEYBINDS.map((b) => b.action);

export const DEFAULT_BINDS = Object.fromEntries(KEYBINDS.map((b) => [b.action, b.code]));

export function resolveBinds(saved) {
  const out = { ...DEFAULT_BINDS };
  if (!saved || typeof saved !== 'object') return out;
  for (const action of ACTIONS) {
    const code = saved[action];
    if (typeof code === 'string' && code.length <= 32) out[action] = code;
  }
  return out;
}

export function holderOf(binds, code) {
  for (const { action, mouse } of KEYBINDS) {
    if (!mouse && binds[action] === code) return action;
  }
  return null;
}

export { MODIFIERS };

export const DEFAULTS = {
  renderDistance: CONFIG.RENDER_DISTANCE,
  fov: CONFIG.FOV,
  sensitivity: 7,
  brightness: 0.0,
  volume: 0.7,
  musicVolume: 0.45,
  muted: false,
  guiScale: 0,
    cloudHeight: 192,
  language: 'en_us',
  viewBobbing: true,
  smoothLighting: true,

  showFps: true,

  waila: true,

  toggleSprint: false,
  toggleSneak: false,
  playerName: 'Player',

  keybinds: null,
  bonusChest: false,
};
