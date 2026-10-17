/**
   * Global tunables. Everything the player might want to tweak lives here so
   * the rest of the code never hard-codes a magic number.
   */
export const CONFIG = {
  /* --- world ---
     The world runs from y = MIN_Y up to y = MIN_Y + WORLD_HEIGHT - 1, so block
     coordinates are signed and y = 0 is the middle of the world rather than its
     floor. Storage is indexed from y = 0 in the arrays, so every index maths
     site subtracts MIN_Y - see Chunk.idx.

     Sea level is 63 and the surface sits just above it. Modern Minecraft 1.18+
     uses -64 .. 320 (384 tall). */
  CHUNK_SIZE: 16,
  MIN_Y: -64,
  WORLD_HEIGHT: 384,
  SEA_LEVEL: 63,
  CHUNK_SECTION: 16,
  /** Highest buildable y. */
  WORLD_TOP: -64 + 384 - 1,

  /* --- worldgen --- */
  // Deepslate takes over below this, with a jagged band above it. Vanilla puts
  // the boundary at y = 0, which is a coincidence of its own 0..255 convention;
  // here y = 0 is simply the point where the stone turns dark.
  DEEPSLATE_TOP: 0,
  // How many blocks of ragged stone sit between the deepslate and the plain
  // stone above it. Vanilla uses 5, and the transition is noise driven so the
  // two stone types interlock rather than meeting on a flat line.
  DEEPSLATE_BLEND: 8,
  // The floor is one straight layer of bedrock at y = 0 and nothing above it.
  // Vanilla's is 5 blocks of rough bedrock with random pockets reaching to y = 8;
  // here that is turned off rather than tuned, because the pockets were the
  // part that read as patches of unbreakable rock through the first twenty-odd
  // blocks of every dig, and the floor is not what anyone came for. A dig now
  // goes down through plain stone until it hits the bottom.

  /* Ravines. The real game carves them as long, wide, tall fissures that wander
     across the surface and can breach it, and they are the main way you find
     your way down out of a mountain. */
  RAVINE: {
    /** Ravine segments are laid out on a grid this many blocks across. */
    CELL: 64,
    /** The region gate: above this noise value a cell gets a ravine. Lower it
     *  for denser networks, raise it for rarer ones. */
    DENSITY: 0.12,
    /** Smoothness of the density field. Higher means longer, more connected runs. */
    DENSITY_SCALE: 0.0021,
    /** How far the segment ends wander from the cell corner. */
    JITTER: 14,
    /** Vertical extent of a segment's endpoints. The range reaches above the
     *  surface on purpose, and the distribution is skewed low, so most ravines
     *  run deep underground while the occasional one breaches a hillside - the
     *  cave mouths the real game is full of. */
    MIN_Y: -64,
    MAX_Y: 200,
    /** Half width and half height of the carved tube. */
    WIDTH_MIN: 2.0,
    WIDTH_MAX: 5.0,
    HEIGHT_MIN: 2.5,
    HEIGHT_MAX: 7.0,
    /** How much the centre line wanders up and down along its length. */
    YAW: 6.0,
  },

  /* Caves. Tunnels are two ridged 3D fields intersecting, cheese chambers are
     big soft blobs, and the deep layer gets its own low frequency field so the
     bottom of the world is hollow rather than uniformly solid. */
   CAVES: {
    TUNNEL_SCALE: 0.026,
    TUNNEL_THRESHOLD: 0.04,
    /** Caves thin out as they approach the surface, so the ground stays solid. */
    SURFACE_GUARD: 4,
    CHEESE_Y: 44,
    CHEESE_SCALE: 0.017,
    CHEESE_THRESHOLD: 0.85,
    /** The deep cavern field: bigger, slower, and only below this height. */
    DEEP_Y: -8,
    DEEP_SCALE: 0.0095,
    DEEP_THRESHOLD: 0.85,
    /* Spaghetti caves: thin winding tunnels. Uses a rarity quantization
       that produces isolated noodle-like strands. */
    SPAGHETTI_2D_SCALE: 0.0045,
    SPAGHETTI_2D_RARITY: 0.50,
    SPAGHETTI_3D_SCALE: 0.018,
    SPAGHETTI_3D_RARITY: 0.40,
    /* Noodle caves: horizontal winding tunnels, Y-limited */
    NOODLE_SCALE: 0.007,
    NOODLE_THICKNESS: 0.05,
    NOODLE_Y_MIN: -64,
    NOODLE_Y_MAX: 180,
    /* Cave entrances: surface-level openings into underground caves */
    ENTRANCE_SCALE: 0.012,
    ENTRANCE_THRESHOLD: 0.95,
    ENTRANCE_SURFACE_GUARD: 2,
  },

  /* Cave pools. Lava lies in the deep, water lies in the middle depths, and the
     two bands are far enough apart that a pool of one can never touch a pool of
     the other - which is the rule, not a coincidence. A liquid can only sit in a
     pocket no taller than FILL_DEPTH, so the deepest a lava pool can rise is
     LAVA_MAX_Y + FILL_DEPTH = -18, and the shallowest a water pool can sit is
     WATER_MIN_Y = -12. Six blocks of solid rock always separate them.

     The bands are placed where caves actually are rather than where they read
     nicely on paper: the cave field is depth biased, so in this world hollows
     are concentrated below about y = 25 and a water band any higher would find
     almost nothing to fill. */
  POOLS: {
    /** Lava will not appear above this. */
    LAVA_MAX_Y: -24,
    /** Water will not appear below this, or above this. */
    WATER_MIN_Y: -12,
    WATER_MAX_Y: 30,
    /** Low frequency on purpose: a basin is tens of blocks across, so a pool
     *  fills one hollow out rather than sprinkling single cells everywhere. */
    SCALE: 0.012,
    /** How far into the field a pocket has to sit to get a pool. Most pockets
     *  get nothing, which is what keeps them rare rather than constant. */
    WATER_THRESHOLD: 0.40,
    LAVA_THRESHOLD: 0.55,
    /** A pocket has to be deep enough to hold liquid. There is deliberately no
     *  upper limit: a lava lake at the bottom of a big cavern is the point, and
     *  FILL_DEPTH keeps the liquid shallow however tall the hollow is. */
    MIN_CAVITY: 2,
    MAX_CAVITY: 24,
    /** How deep the liquid is poured once a pocket qualifies. */
    LEVEL_MIN: 2,
    LEVEL_MAX: 5,
    FILL_DEPTH: 6,
  },

  /* Moss. Vanilla grows it on stone in the deep, cool, wet parts of a cave, and
     it is the one thing down there that is not grey. */
  MOSS: {
    /** Deepslate only: moss never grows above the stone/deepslate boundary. */
    MAX_Y: 0,
    SCALE: 0.045,
    THRESHOLD: 0.55,
  },

  /* The Nether.
     The Nether shares this world's y range rather than introducing a second
     coordinate space, but it only occupies a band of it: a bedrock floor at the
     bottom of the world, a bedrock roof at y = 96, and between them a height map
     of netherrack ground centred on y = 30, with caverns carved into the rock
     underneath it and open air above up to the roof. A portal at the overworld's
     sea level (y = 62) arrives here at y = 31, which is on the ground rather than
     in the void. */
  NETHER: {
    /**
     * The Nether's own height limits, which are not the overworld's.
     *
     * The real dimension is 128 blocks tall: bedrock at y = 0 and bedrock at
     * y = 127, with everything else in between. This project gives the overworld
     * a much deeper range than the real game does, so the Nether is the one place
     * that gets the vanilla numbers - it is the dimension those numbers describe,
     * and a Nether 320 blocks tall is not a Nether anybody has seen.
     */
    FLOOR_Y: 0,
    ROOF_Y: 127,
    /** The rough bedrock layer at each end. */
    BEDROCK_DEPTH: 2,
    /**
     * The netherrack layer under the bedrock roof.
     *
     * The real roof is not solid bedrock all the way down: two or three blocks of
     * it are, and below that is netherrack, and the glowstone sits on the underside
     * of *that*. This is the layer it sits on.
     */
    ROOF_ROCK: 3,
    /**
     * The cell the glowstone goes in: the underside of the netherrack ceiling,
     * with rock above it and open cavern below.
     *
     * Written out as a number rather than derived from the three layers above it
     * because deriving it is how it gets off by one, and being one block out puts
     * the glowstone in the open air under the ceiling where it lights nothing.
     * The Nether test checks the two agree.
     */
    GLOWSTONE_Y: 123,
    /**
     * The one lava level, for the whole dimension.
     *
     * This is the number that decides whether the lava reads as a few enormous
     * seas or as a flood, and it was picked by measuring rather than by taste.
     * Measured over four chunks at each level:
     *
     *   y = 21   7% of the surface wet, largest sea   6,700 blocks, 86% walkable
     *   y = 26  15% wet,               largest sea  32,000 blocks, 72% walkable
     *   y = 34  28% wet,               largest sea  60,000 blocks, 52% walkable
     *
     * 26 is the knee: a lake roughly 180 blocks across, and most of the
     * dimension still land you can stand on. 34 is a more volcanic place and only
     * half the world is walkable, which is a different dimension. Raise it for
     * more lava, lower it for a survivable one.
     */
    LAVA_SEA_Y: 26,

    /* The surface.

       The Nether is a place, not a hole. There is a height map: broad rolling
       ground with finer relief on it, a few blocks of solid netherrack as a
       crust, and open air above it up to the roof far overhead. A portal built
       at the overworld's sea level arrives at y = 31, so the ground is centred
       there and the arrival has somewhere to land.

       Ground that falls below the lava line floods, and that is where the lava
       seas come from - they are the low ground filling up, not a plane laid over
       the whole dimension.

       The two directions get different curves on purpose. Upwards the curve is
       under 1, which spreads the field out and makes the high ground rise
       gradually into broad terraces. Downwards it is over 1, which squeezes the
       field together: the low ground is *rare and deep* rather than common and
       shallow. That is the whole shape of the dimension, and it is why there are
       a few enormous lava seas instead of a third of the world under a film of
       orange. One lava level runs across all of it, so every hollow that dips
       below that level joins up with its neighbours. */
    SURFACE_BASE: 30,
    SURFACE_UP: 44,
    SURFACE_CURVE_UP: 0.8,
    SURFACE_DOWN: 46,
    SURFACE_CURVE_DOWN: 1.6,
    SURFACE_SCALE: 0.0072,
    SURFACE_DETAIL: 0.030,
    SURFACE_DETAIL_AMP: 5,
    /**
     * A high frequency component, added on top of the broad one.
     *
     * The broad field's wavelength is around a hundred and forty blocks, so on
     * its own it can only ever make slopes. This one is short - about thirty
     * blocks - and steep, which is what puts walls in the terrain: a dozen
     * blocks of rise over a few blocks of ground. Terracing then turns those
     * walls into ledges.
     */
    CLIFF_SCALE: 0.028,
    CLIFF_AMP: 14,
    CLIFF_CURVE: 0.7,
    /**
     * Solid masses.
     *
     * The big walls in the Nether are not really surface relief: they are
     * masses of rock that go from the floor all the way up to the ceiling, with
     * the lava at their feet. A height map cannot make those - it can only make
     * a surface - so the regions this field picks out have their ground raised
     * towards the roof instead. The blend is linear in the field, which makes the
     * sides of a mass steep rather than a ramp, and the neighbouring low ground
     * is what floods, so every mass stands next to a lava sea.
     */
    WALL_SCALE: 0.0060,
    WALL_THRESHOLD: 0.42,
    WALL_TOP: 86,
    MIN_SURFACE: 6,
    MAX_SURFACE: 70,
    /** Solid netherrack under the surface, which the caves are not allowed to
        eat into. Without it the ground is a shell over a void and there is
        nothing to walk on. */
    CRUST: 6,
    /** ...and how much thicker than that it gets in places. A crust of exactly
        six blocks everywhere means every cavern ceiling is the terrain with six
        taken off it, so every ceiling in the dimension is the same shape as the
        ground above it - which is the single most artificial thing about a cave
        field. Letting the thickness wander makes the ceilings undulate
        independently of the surface. It only ever goes *up*, so the ground keeps
        the thickness it is guaranteed. */
    CRUST_NOISE_SCALE: 0.021,
    CRUST_VARIATION: 7,
    /** Regions the terrace field picks out get their ground quantised into
        steps, so a wall reads as a stack of ledges rather than a smooth ramp. */
    TERRACE_SCALE: 0.019,
    TERRACE_THRESHOLD: 0.20,
    TERRACE_STEP: 8,

    /* Caverns, in the rock *below* the surface. Two tunnel fields and a big soft
       cavern field, and then one high frequency field that decides the last block
       or two of every wall.

       The thresholds are calibrated against the *interpolated* lattice, not
       against the raw noise, and that is the whole subtlety: the lattice is
       sampled every four blocks and read back trilinearly, which pulls every
       value towards the mean, so a threshold that looks generous on the raw
       field (this noise runs to about 0.98) is unreachable once it has been
       smoothed. Measured on generated chunks, the old 0.50 carved under 5% of
       the rock and the caverns were rare enough to be a curiosity. The numbers
       below carve roughly a third of the band, which is what the rock under a
       Nether surface is actually like. */
    /** The big winding tubes: a sum of two squared fields, small only where both
        are near zero. */
    TUNNEL_SCALE: 0.018,
    TUNNEL_THRESHOLD: 0.055,
    /** A second, much finer tube field, so the passages are not all one size.
        This is what turns a handful of galleries into a cave system. */
    TUNNEL2_SCALE: 0.055,
    TUNNEL2_THRESHOLD: 0.010,
    CAVERN_SCALE: 0.013,
    /** The cavern threshold rises towards the bedrock floor and the bedrock roof,
        so the widest openings are in the middle of the rock and both of those
        layers keep their pillars. CAVERN_SPAN is the depth of the rock band this
        is measured over, and it has to be about that band's height: too small and
        the gate saturates at 1 almost everywhere, the threshold ends up above the
        top of the noise, and the caverns do not exist at all. */
    CAVERN_THRESHOLD: 0.13,
    /** How much steeper that gate is at either end of the band, as a rise in the
        threshold rather than as a separate field. */
    CAVERN_EDGE: 0.12,
    CAVERN_SPAN: 34,
    /** How far either side of the threshold the high frequency field is allowed to
        reach. Everything beyond it is decided by the interpolated field alone, so
        the fine noise is only paid for on the shell of each cavern - a few
        hundred cells a chunk rather than sixteen thousand. */
    DETAIL_MARGIN: 0.16,
    DETAIL_SCALE: 0.09,
    DETAIL_AMP: 0.22,
    /** A solid band right under the roof that nothing carves. */
    ROOF_GUARD: 3,

    /** Bedrock pillars rising out of the lava sea, the Nether's skyline. */
    PILLAR_SCALE: 0.013,
    PILLAR_GATE: 0.62,
    PILLAR_MIN_TOP: 4,
    PILLAR_MAX_TOP: 44,

    /**
     * Glowstone on the underside of the netherrack ceiling.
     *
     * Many small patches rather than a few large ones: the scale is high, so a
     * patch is a handful of blocks across, and the threshold is set so they are
     * common enough to light a cavern as you cross it. Big rare clusters read as
     * landmarks instead, which is not what the ceiling of the Nether is for.
     */
    GLOW_SCALE: 0.11,
    GLOW_THRESHOLD: 0.42,
    MAGMA_SCALE: 0.03,
    MAGMA_THRESHOLD: 0.36,
    SOUL_SAND_SCALE: 0.05,
    SOUL_SAND_THRESHOLD: 0.34,

    /**
     * Warped cactus on the netherrack surface.
     *
     * The desert's own rule rather than a noise field: every column
     * rolls once, so the stalks stand scattered singly and in twos
     * across the floor - the way the real Nether's warped growth
     * sits - instead of filling the whole regions a threshold on a
     * low frequency field would pick out.
     */
    WARPED_CHANCE: 0.01,

    /* Basalt deltas: the black shelves that sit on the floor of the low ground
       in the real Nether, which is most of what makes the deep parts of the
       dimension read as somewhere rather than as a lava lake with a rim. */
    DELTA_SCALE: 0.014,
    DELTA_THRESHOLD: 0.30,
    /** The delta floor is blackstone where it meets the lava, basalt above that,
       and the bare smooth basalt in between. */
    DELTA_MAX_Y: 34,
  },

  /* --- rendering --- */
  RENDER_DISTANCE: 7,          // chunks
  FOV: 70,                   // Java's default
  MAX_FRAMETIME_MS: 1000 / 30,

  /* --- chunk pipeline budgets (chunks processed per frame) --- */
  GEN_BUDGET: 2,
  LIGHT_BUDGET: 4,
  MESH_BUDGET: 4,

  /* --- player ---
     The hitbox is a box centred on the player in x and z and standing on
     `position.y` in y, so position is the feet and the box runs from there to
     `PLAYER_HEIGHT` up. Vanilla's numbers, which matter because they decide
     which gaps you fit through:

       standing  1.8 tall, 0.6 wide, eyes at 1.62
       sneaking  1.5 tall, 0.6 wide, eyes at 1.27

     Sneaking is what lets you get into a one-block-high space - a 1.8-tall
     player cannot, a 1.5-tall one can - and the crouch eye height is 0.35
     below the standing one, not a fixed nudge. This used to read 1.44, which
     is neither number and left the camera 0.17 too high while crouched. */
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
  // creative flight is far snappier than walking: vanilla takes the fly speed
  // straight from the input, so it starts and stops almost immediately
  FLY_ACCEL: 30,
  FLY_DECEL: 12,
  FLY_VERTICAL_RATE: 20,
  DOUBLE_TAP_TIME: 0.25,       // vanilla's window for the jump double tap
  // Vanilla remembers a forward press and treats a second one inside that
  // window as a double tap. The old value was measured from the release and set
  // at a third of a second, which is tight enough that an ordinary double tap
  // missed; the window is now press-to-press and a little more forgiving.
  SPRINT_DOUBLE_TAP_SECONDS: 0.5,
  WATER_DRAG: 0.55,
  SWIM_SPEED: 2.2,
  TERMINAL_VELOCITY: 78.4,
  REACH_SURVIVAL: 4.5,
  REACH_CREATIVE: 5.0,
  /**
   * The height the player can step up or down without jumping, in blocks.
   *
   * Vanilla's `step_height`, and it is also what the sneak ledge guard is
   * measured against: while crouched you may not walk forward unless there is
   * still ground within this distance under where you are about to be. That is
   * why you can edge along a cliff face while sneaking and stop dead at the
   * lip, but can simply walk off the same ledge standing up.
   */
  STEP_HEIGHT: 0.6,

  /* --- the movement model ---
     Java does not steer the player toward a target speed. Twenty times a second
     it multiplies the motion it already has by a friction constant and then adds
     a fixed amount along the direction the keys are asking for:

         v = v*friction + input

     and the speed the player ends up at is whatever falls out of those two
     numbers. Ground friction is a block's own friction times 0.91 - 0.6, the
     friction of an ordinary block, giving 0.546 - and air friction is a bare 0.91.

     The three speeds below are what that arithmetic produces, and they are
     exactly the numbers the real game is documented at, which is the test that
     the model is the right one rather than a set of numbers that happen to look
     about right. They are written as targets rather than as accelerations: the
     exponential below is the exact solution of the recurrence, so a target is
     the same statement as the arithmetic and cannot drift away from it.

     Air is the exception, and deliberately so: the three speeds above are what
     the model settles at, and in the air there is nothing to settle at - only a
     very small drag and a weak additive steer. See `AIR_DRAG` and `AIR_STEER`
     below for why, and `Player.update` for the arithmetic.

     Everything is applied per tick and scaled by the real frame time as it goes,
     so the feel is the same at 30fps as at 240 rather than being a tick rate in
     disguise. */
  TICKS_PER_SECOND: 20,
  GROUND_FRICTION: 0.546,     // 0.6 block friction * 0.91
  WATER_FRICTION: 0.8,        // what vanilla applies to a body in water
  /**
   * How much horizontal speed the air takes away, per tick.
   *
   * Vanilla's air is the reason sprint-jump momentum works: a jump leaves you at
   * very nearly the speed you took off at, which is what makes chaining them
   * carry - provided you keep the keys down, which is how it is done. Anything
   * that loses a large fraction of the speed per tick turns every jump into a
   * near stop, which is emphatically not that.
   *
   * 0.995 is a long fall's worth and nothing at all for a jump: half a percent a
   * tick is under one percent across a whole jump, and about a sixth over two
   * seconds of falling. Enough to stop the air being perfectly frictionless,
   * not enough to notice while moving. `AIR_COAST_DRAG` below is what it becomes
   * the moment the keys come up.
   */
  AIR_DRAG: 0.995,
  /**
   * The same drag with the keys *up*, per tick.
   *
   * 0.91 is the figure the real game applies to a body in the air, and here it is
   * the whole of what "let go in mid air" costs: about 60% of the speed gone in
   * half a second. With the keys down it is the 0.995 above instead, so holding
   * forward keeps a jump's momentum and releasing it gives it back.
   */
  AIR_COAST_DRAG: 0.91,
  /**
   * How much holding a key adds in mid air, in blocks per second per tick.
   *
   * About a metre per second over a second of holding - enough to aim a jump, not
   * enough to fly. This is the air control nerf: weak, additive, and with no
   * speed of its own to settle at, so it nudges the momentum you already have
   * rather than replacing it.
   */
  AIR_STEER: 0.05,
  /**
   * How much wider the view gets while sprinting, as a fraction of the field of
   * view rather than as degrees.
   *
   * Vanilla multiplies the FOV by 1.1 while sprinting, so the effect scales with
   * whatever the player has chosen rather than being a fixed seven degrees. It is
   * one of the two things that tell you at a glance that you are running.
   */
  SPRINT_FOV_SCALE: 1.1,
  /**
   * Mouse look, in degrees turned per mouse count at 100% sensitivity.
   *
   * Java's `mouseSensitivity` of 1.0 is its 100% and turns 0.15 degrees for
   * every count the mouse reports, which at an ordinary 500 counts per inch is
   * about 75 degrees across an inch of mouse travel. The options slider here
   * runs 1..15 with 3 as its middle, so 3 is 100% and the number below is that
   * 0.15 divided by three.
   */
  LOOK_DEGREES_PER_COUNT: 0.15,
  LOOK_SENSITIVITY_MIDDLE: 3,

  /* --- the bed ---
     A bed is springy. Not a trampoline: about a third of a block of lift, which
     is enough that walking onto one gives a little hop and running across one
     turns into a bounce, and small enough that you can still sleep in it.

     `BED_BOUNCE` is the upward speed a bounce gives, in blocks per second, and
     it is applied to two things - landing on a bed, and the timed hop while
     moving along one. They are separate numbers because they answer different
     questions: a landing is a single impulse and wants to be a little stronger
     than the steady state, or the first step onto a bed is the only one that
     feels like anything. */
  BED_BOUNCE: 3.4,
  BED_LAND_BOUNCE: 4.2,
  /** How often the hop fires while running over a bed, in seconds. */
  BED_BOUNCE_INTERVAL: 0.34,
  /** Below this horizontal speed a bed is just a bed and does not bounce. */
  BED_BOUNCE_MIN_SPEED: 0.6,
  // A spectator has no hitbox, so it never needs to reach anything.
  REACH_SPECTATOR: 0,
  // Vanilla spectator flight is a straight impulse on the movement input with no
  // gravity and no acceleration curve, which is why it feels instant - the same
  // reason creative flight does.
  SPECTATOR_SPEED: 21.8,

  /* --- survival --- */
  MAX_HEALTH: 20,
  MAX_HUNGER: 20,
  MAX_AIR: 300,                // ticks
  REGEN_INTERVAL: 4.0,         // seconds per half-heart at full-ish hunger
  REGEN_HUNGER_FLOOR: 18,      // vanilla will not heal you below this
  STARVE_INTERVAL: 4.0,
  FALL_DAMAGE_THRESHOLD: 3.0,  // blocks before damage starts

  /* --- time --- */
  // A Minecraft day is 24000 ticks and 20 ticks pass per second, so a full
  // cycle is 20 minutes. The length is deliberately not an option: /time set
  // and /time add let the player move the clock, and a slider that only
  // rewrites a field nothing reads is worse than no slider at all.
  DAY_TICKS: 24000,
  START_TIME: 1000,            // MC ticks, 1000 = morning

  /* --- seasons ---
     Not a vanilla mechanic - Minecraft has no year and no calendar. This is a
     calendar laid over the day/night cycle.

     Seasons are NOT a fixed run of days. They follow the months, on the
     meteorological grouping - March-May spring, June-August summer,
     September-November autumn, December-February winter - so a date and a
     season always agree. An earlier version ran them as four fixed 20-day
     blocks, which put the calendar in January while the readout cheerfully
     said Spring and drifted further out of step every year.

     That also means a season's length is whatever the calendar says - 92 days
     for spring, 90 or 91 for winter depending on leap years - rather than a
     number set here. The only thing configured is where the year starts. */
  SEASON: {
    /**
     * Translation keys, in the order the icon sheet lays them out: the sheet is
     * a 2x2 grid, so the order is top-left, top-right, bottom-left,
     * bottom-right. The index is also the cell index, which is what keeps the
     * word and the picture from drifting apart.
     */
    NAMES: [
      'hud.season.spring',
      'hud.season.summer',
      'hud.season.autumn',
      'hud.season.winter',
    ],
    /**
     * The date a brand new world starts on.
     *
     * Day zero is 1 January 2000, and it is a Monday. The real 1 January 2000
     * was a Saturday, so the weekday here is the game's own and not the
     * historical one - which is the point: the week stays in step with itself
     * forever instead of drifting a few days out of agreement with the real
     * 2000 calendar. This is the same Monday-based convention ISO 8601 and
     * every spreadsheet use.
     */
    EPOCH_YEAR: 2000,
    /** 0 = Monday, matching the order the weekday names are listed in. */
    EPOCH_WEEKDAY: 0,
    /** The icon sheet, and how it is divided up. */
    ICON_SHEET: 'season_icons',
    ICON_COLS: 2,
    ICON_ROWS: 2,
    /**
     * Snow, which falls through winter and melts out of it.
     *
     * The rates are a balance between two failure modes. Too slow and winter
     * looks like nothing happened; too fast and the world is buried within a
     * day and the player cannot dig out. At these numbers a full eight layers
     * takes a couple of in-game weeks, which is most of a winter - so the snow
     * builds visibly over the season and is still there when it turns.
     *
     * Attempts are made per second and each one succeeds only about a fifth of
     * the time, so the numbers are deliberately separate: the attempt rate sets
     * how many cells are considered, the chance sets how many of them change.
     */
    SNOW: {
      /**
       * Cells considered per second **per loaded chunk**, while it is snowing.
       *
       * Per chunk rather than absolute, because the number of chunks in view
       * changes constantly with the render distance, and a fixed figure cannot
       * serve both. At five cells a second - which is what this used to be - a
       * hundred loaded chunks hold twenty-five thousand columns, so one layer
       * needed over an hour to reach all of them. The snow was being laid the
       * whole time and was simply never visible. At this rate a full layer
       * covers the visible world in a minute or two.
       */
      ACCUMULATE_RATE: 12,
      /** Chance any one considered cell gains a layer. */
      ACCUMULATE_CHANCE: 0.22,
      /** Cells considered per second per loaded chunk, while it is thawing. */
      THAW_RATE: 18,
      /** Chance any one considered cell loses a layer. */
      THAW_CHANCE: 0.3,
      /**
       * Never let the attempt rate run the frame time away. With a hundred
       * chunks loaded the budget would be well past this, so at a long render
       * distance it - not the rate - is what limits how fast snow settles.
       */
      MAX_PER_FRAME: 12,
      /**
       * How much faster the thaw runs once winter is over, and for how long.
       *
       * Without this, spring starts by melting snow at exactly the rate a sunny
       * day in January does, and a deep winter's eight layers take the better
       * part of a season to shift. That reads as a bug rather than as a thaw: you
       * stand in a white world on the first day of spring and it is still white
       * at the end of it. The melt is multiplied while the thaw is running, so
       * the snow goes over the first days of the new season - still visibly
       * retreating rather than blinking out - and then the rate drops back to
       * the ordinary one for the occasional late flurry.
       */
      SEASON_THAW_MULTIPLIER: 6,
      SEASON_THAW_DAYS: 8,
    },
  },

  /**
   * Saplings.
   *
   * A sapling is a thing with a *timer* rather than a per-tick dice roll, and
   * that choice is what makes the seasons readable. The real game rolls a chance
   * every tick, which averages out to half an hour and tells the player nothing
   * about why; here a sapling that is allowed to grow does so after a fixed
   * number of seconds, and a sapling that is not allowed does not advance at
   * all. Plant an oak in autumn and it stands there visibly *waiting* rather
   * than failing - you can watch the number not move.
   *
   * Only the kinds this game actually has are listed. A pale oak, a cherry, a
   * mangrove, crimson, warped and bamboo all have their own rules in the real
   * game, and none of them is a block here yet; adding one is a line in `TREES`
   * and a sapling in `Blocks`.
   */
  SAPLING: {
    /**
     * How often a sapling is looked for, per second per loaded chunk.
     *
     * Finding saplings is the expensive half of this, and it is why the number
     * is so small: a world of a hundred chunks holds a quarter of a million
     * cells and may have four saplings in it, so scanning everything often
     * enough to keep up with the timers would cost more than the trees are
     * worth. Scanning a handful of columns a second finds a planted sapling
     * within a few seconds of it being planted, which is quick enough that the
     * wait still reads as the sapling's own.
     */
    SCAN_RATE: 3,
    /** Ceiling on the scan for one frame, whatever the render distance. */
    MAX_PER_FRAME: 6,
    /**
     * How many saplings can be growing at once.
     *
     * Each one is a few block reads a frame, so this is not a performance figure
     * so much as a bound on how much of the world one player's orchard can be.
     * The oldest is dropped when the list is full, and dropping one only means
     * its timer is forgotten - the sapling is still there and gets picked up
     * again by the next scan.
     */
    MAX_TRACKED: 32,
    /**
     * The block light a sapling needs where it stands, 0..15.
     *
     * Eight, which is the same figure the animals spawn at and the same one a
     * chicken needs to lay. It is the only rule here that is really about light:
     * a sapling under a roof grows, a sapling in a dark corner does not.
     */
    LIGHT: 8,
    /**
     * What a sapling will grow out of.
     *
     * `minecraft:valid_blocks` for a sapling, restricted to what this world has.
     * It is a list rather than a solidity test for the reason the mob spawn
     * ground is: a sapling will not grow out of a plank floor, and it will
     * happily grow out of snow.
     */
    SOIL: [
      'grass_block', 'dirt', 'coarse_dirt', 'podzol', 'mycelium',
      'rooted_dirt', 'moss_block', 'snow_block', 'farmland',
    ],
    /**
     * The kinds, and when each of them will grow.
     *
     * `seasons` is a list of season indices - 0 spring, 1 summer, 2 autumn,
     * 3 winter - read straight off `seasonOf(day).index`, which is also the
     * order the season icons are laid out in. A kind absent from the list is
     * listed as paused; a kind with all four is not paused by anything.
     *
     *  - **Oak and birch wait for spring.** They are the two that stop, and
     *    stopping is the interesting half of the rule: a sapling planted in
     *    summer is not dead and not slow, it is *waiting*, and it starts again
     *    on the first day of spring with the time it had already served kept.
     *  - **Spruce is not gated at all**, because it is a cold-country tree and
     *    gating it on spring would be the opposite of what it is. It grows in
     *    any season, and `snowFactor` says the rest: standing in snow, it is
     *    twice as quick.
     */
    TREES: {
      oak: { grow: 75, seasons: [0] },
      birch: { grow: 75, seasons: [0] },
      spruce: { grow: 55, seasons: [0, 1, 2, 3], snowFactor: 0.5 },
    },
  },

  /**
   * Weather: what the sky is doing, which is not the same as what season it is.
   * A winter day can be clear, and a spring day can storm.
   *
   * It is a sibling of `SEASON` rather than a part of it for exactly that
   * reason. Weather is not seasonal - it asks the season what is possible, but
   * most of these numbers mean nothing outside the Overworld, and burying them
   * under the calendar would imply a dependency that does not exist.
   *
   * The rates here are in blocks per second and are tuned against a
   * 320-block-tall world rather than in the abstract: rain at 26 crosses the
   * 48-block precipitation box in under two seconds, so a drop is in view for a
   * moment and gone, which is what rain looks like. Snow at 4 takes twelve,
   * which is slow enough to follow with your eyes.
   */
  WEATHER: {
    /**
     * How fast the weather moves toward the day's settled kind, per second.
     *
     * This is an exponential ease, so the number is a rate rather than a
     * duration: at 0.35 a change is about two-thirds done in three seconds
     * and effectively finished in ten. Any faster and rain blinks instead of
     * arriving, which is the thing this whole system exists to avoid.
     */
    EASE: 0.35,
    /** Rain's fall speed, blocks/sec. */
    RAIN_SPEED: 26,
    /** Snow's, which is slow enough to watch. */
    SNOW_SPEED: 4,
    /** How far snow wanders sideways, blocks/sec. Rain has none. */
    SNOW_DRIFT: 1.6,
    /** Point size in blocks. Snow reads larger because a flake is a flake. */
    RAIN_SIZE: 0.07,
    SNOW_SIZE: 0.11,
    /** Peak alpha of a drop at full intensity. */
    PARTICLE_ALPHA: 0.75,
    /**
     * Drops kept in the pool. One cloud serves rain and snow, so this is the
     * whole cost of precipitation.
     *
     * Sized against the box below rather than picked: the box is 64 x 48 x 64,
     * so 3000 drops is roughly one every 65 cubic blocks, which is sparse
     * enough to see the ground through in a shower and dense enough to read as
     * weather at a distance. It is a `Points` cloud in a single draw call, so
     * the number costs fill rate and nothing else.
     */
    DROPS: 3000,
    /**
     * How much of the render distance precipitation takes away, as a fraction.
     *
     * Applied to the fog's far plane, so the world genuinely does not resolve
     * to the horizon in a downpour. Half the distance is enough to read as
     * weather without becoming a wall of grey.
     */
    FOG_CUT: 0.45,
    /**
     * How bright a lightning flash is, added to the sky light.
     *
     * Clamped where it is applied, so a flash at midnight brightens the world
     * to full rather than past it - a storm at night is still night.
     */
    LIGHTNING_FLASH: 0.55,
    /**
     * Rain ambience, as a fraction of the master volume.
     *
     * The pack has no dedicated rain loop, only two one-shots under
     * `ambient/weather`, so one is chosen at random when the rain starts and
     * looped. The full file is a couple of seconds, which is short for a bed
     * but long enough not to read as a loop point, and the alternative -
     * concatenating or resampling a file - is not worth a build step for one
     * ambience.
     */
    RAIN_VOLUME: 0.5,
  },

  /**
   * Mobs: how being hit feels, and how they move through water.
   *
   * None of these are vanilla numbers. Vanilla has no single knockback constant
   * - it is derived from the weapon and from whether the attacker is on the
   * ground - and there are no weapons here yet, so these are tuned by what reads
   * correctly rather than copied from a table.
   */
  MOB: {
    /**
     * How long a mob stays red after being hit, in seconds.
     *
     * Half a second. Long enough to catch on a peripheral glance, short enough
     * that a second hit in quick succession is still legible as a second flash
     * rather than as one long one.
     */
    HURT_FLASH: 0.4,
    /**
     * The colour a hurt mob is tinted, as a hex the material is set to.
     *
     * Vanilla's is a desaturated red that keeps the skin's own shading, so a hit
     * reads as the mob being *coloured* rather than as a red mob replacing it.
     * The shader here multiplies, so this is that colour rather than a tint
     * applied on top.
     */
    HURT_COLOR: 0x8a2020,
    /**
     * How much of the mob's own brightness survives the flash, in [0, 1].
     *
     * Not zero. A fully dark red loses the model entirely and the flash becomes
     * a red blob, which is worse than not having one; keeping a third of the
     * light leaves the silhouette and the shading readable underneath it.
     */
    HURT_BRIGHTNESS: 0.35,
    /** How far a hit throws a mob along the swing, in blocks per second. */
    KNOCKBACK: 5.5,
    /**
     * The upward part of that, in blocks per second.
     *
     * A knockback with no lift shoves a mob along the ground, which on a flat
     * plain is barely visible - the whole of the movement is cancelled by the
     * wall check on the next frame. This is what makes a hit read as a hit.
     */
    KNOCKBACK_UP: 3.4,
    /**
     * How much slower a mob walks in water, as a fraction of its own speed.
     *
     * Separate from the buoyancy in the mob, which is about not sinking. A mob
     * in water does both: it floats and it paddles slowly.
     */
    SWIM_SPEED_FACTOR: 0.55,
    /**
     * How long a dead mob's body lies there, in seconds.
     *
     * Vanilla tips a mob over and removes it after about half a second. Half a
     * second is too quick to read at all - the bird is on its side and gone
     * between one frame and the next - so this is nearer a second and a half,
     * which is long enough to actually see it happen without leaving a carcass
     * lying around in a chicken farm.
     */
    DEATH_TIME: 1.5,
    /**
     * How high a panicking mob jumps, in blocks per second.
     *
     * Vanilla's `panic` behaviour is what makes a chicken scramble up a fence
     * rather than grind against it: a bird that hits a block while fleeing
     * jumps. Without it a fleeing bird walks into a one-block step and stops
     * dead, which reads as the mob being broken rather than as a mob trying to
     * get away from you.
     */
    FLEE_JUMP: 7.2,
    /**
     * How long a mob stays off the ground after a flee jump, in seconds.
     *
     * A jump on every frame would launch it into the sky; this is a cooldown, so
     * a bird crossing a field of hurdles clears each one rather than being
     * fired off the first.
     */
    FLEE_JUMP_COOLDOWN: 0.5,
  },

  /**
   * Natural spawning.
   *
   * These are the real game's numbers, not tuned ones, because the whole point
   * of a spawn cycle is that it is *frequent and heavily filtered*: the
   * spawner asks constantly, and almost every attempt is thrown away. Lengthen
   * the interval and the filtering stops reading as filtering - a chicken pops
   * into existence every few seconds instead of the world quietly filling with
   * them out past the tree line.
   *
   * Each number is one rule from `NaturalSpawner` and the mob rules that hang
   * off it, and the comments say which.
   */
  SPAWN: {
    /**
     * How often the world tries to spawn, in seconds.
     *
     * Vanilla calls the spawner once every 20 ticks, so once a second. The old
     * six-second interval was a third as many attempts, which is a different
     * game: it did not thin out the world so much as make it grow in visible
     * steps.
     */
    INTERVAL: 1.0,
    /**
     * How many candidate spots one cycle tries.
     *
     * Vanilla rolls three positions per cycle, each of which may produce a
     * whole group. It is attempts rather than mobs, so this is not a mob rate -
     * most of the three are rejected before anything is built.
     */
    ATTEMPTS: 3,
    /**
     * How far from the player a candidate spot is drawn, in blocks.
     *
     * Vanilla samples a 24 block radius around the player and then runs the
     * mob's own spawn rules on whatever it lands on. Nothing is ever placed
     * further out, so a mob cannot wander in from beyond the fog.
     */
    RADIUS: 24,
    /**
     * The nearest anything may appear, in blocks.
     *
     * `NaturalSpawner` compares the candidate's distance against the closest
     * player's and refuses the spawn below 24 blocks - for monsters *and* for
     * animals alike, which is the rule that makes mobs arrive out of sight
     * rather than materialising in front of you. Spawning inside that radius
     * is the single most obvious way to break the illusion, and it is what this
     * game did: the old rule was "at least four blocks", which put a chicken on
     * the grass at your feet and called it a chicken farm.
     */
    MIN_DISTANCE: 24,
    /**
     * The light a passive mob needs to spawn on, as a level.
     *
     * `Mob.isLightLevelValid` is `brightness >= level`, *or* `brightness >= 4`
     * with a one in ten chance. Both halves matter: the first is why a chicken
     * in a dark barn does not appear, and the second is why one occasionally
     * does anyway. Eight is the number vanilla passes for an animal.
     */
    LIGHT_LEVEL: 8,
    /**
     * The dim-but-not-black band where the one-in-ten escape applies.
     */
    LIGHT_FLOOR: 4,
    /**
     * The chance a too-dark spot is let through anyway.
     */
    LIGHT_CHANCE: 0.1,
    /**
     * How many passive mobs one player is worth, per spawn category.
     *
     * Vanilla's biome settings give the `creature` category a cap of ten per
     * player, and the cap is checked before each group is built rather than
     * after it. It is why a heavily visited plain stays at a steady population
     * instead of filling up, and why walking away and coming back finds the
     * world roughly as it was.
     */
    LIMIT: 10,
    /**
     * How far a mob may be from the player and survive, in blocks.
     *
     * A passive mob beyond this starts a thirty second timer and then is gone.
     * Vanilla's number is 4096 squared, so 64 blocks; a monster gets 128. This
     * game has no monsters yet, so every mob here uses the passive distance, and
     * the field is per-variant so a hostile mob can be given its own.
     */
    DESPAWN_DISTANCE: 64,
    /**
     * How long a mob may sit out of range before it goes, in seconds.
     *
     * Vanilla's `tickDeath` is 600 ticks. Without the delay a mob that happened
     * to be slightly too far when you loaded a chunk vanished on the spot, which
     * reads as a bug rather than as the world tidying up behind you.
     */
    DESPAWN_GRACE: 30,
    /**
     * How close the player has to be for an out-of-range mob's timer to stop.
     *
     * Not the despawn distance. A panicked chicken that has run thirty blocks
     * away is out of range by the rule and is being counted down, and it should
     * not be while it is still fleeing you.
     */
    DESPAWN_PROXIMITY: 16,
  },

  /**
   * Boats.
   *
   * A boat is not a block and not a mob: it is an entity with a seat, and it is
   * the only thing in the game the player can be *inside* rather than standing
   * next to. Its numbers are tuned rather than copied, with one exception worth
   * naming: the land speed really is meant to be slower than walking, because
   * a boat that can be dragged along a road faster than you can run is a boat
   * that has stopped being a boat.
   */
  BOAT: {
    /**
     * Top speed on water, in blocks per second.
     *
     * A paddled boat in the real game covers about this, and it is a little
     * under walking pace - you cross a lake faster than you cross the same
     * stretch of bank, but not by much.
     *
     * This is the base every other surface is a fraction of, which is why the
     * three below are multipliers rather than speeds in their own right: it puts
     * them on one scale, so "snow is a bit under three quarters of grass" is a
     * statement you can check by reading two numbers side by side.
     */
    PADDLE_SPEED: 5.0,

    /**
     * How much of the paddled speed the hull keeps on each surface.
     *
     * The three numbers are meant to be read as one ladder, not tuned
     * independently:
     *
     *     water  0.98   fast and smooth - the boat is doing what it is for
     *     grass  0.75   slow, but it moves - a boat you can drag up a bank
     *     snow   0.62   ploughing - the hull is through a drift, not over it
     *
     * The snow figure sits in the middle of a 0.60-0.65 range rather than at
     * either end, because the difference between "very slow" and "extremely
     * slow" on a surface a boat is already crawling over is not worth the
     * precision of a false choice.
     *
     * Water is 0.98 rather than 1.0 so the ladder has a visible top rung: a boat
     * on water is not *exactly* at its own ceiling, which is what leaves the
     * ceiling meaning something on the surfaces below it.
     *
     * Note that grass at 0.75 puts a beached boat at 3.75 against a walking pace
     * of 4.317 - so a boat ashore is slow against the water, and only slightly
     * slower than being on foot. That is a deliberate trade away from the older
     * tuning, which held land under *half* a walking pace on the argument that a
     * boat dragged along a road should cost you real speed. This ladder keeps
     * the ordering (water fastest, snow worst, grass between) and gives up the
     * margin.
     */
    WATER_SPEED_FACTOR: 0.98,
    LAND_SPEED_FACTOR: 0.75,
    SNOW_SPEED_FACTOR: 0.62,
    /**
     * How fast a turn carries the boat round, in radians per second, on water.
     *
     * Slower on water than on land, and that is the real rule rather than a
     * taste: a hull is steered by what it displaces, so it has to be moving
     * before it will come round. On land it just skids.
     */
    TURN: 1.5,
    LAND_TURN: 3.0,
    /**
     * How fast the boat picks up speed, as an acceleration in blocks per
     * second squared. The reciprocal of the drag constant, so speed and braking
     * are the same number read two ways.
     */
    ACCEL: 4.0,
    /**
     * How much of the speed survives per second when the paddle stops. A boat
     * coasts a long way; this is what makes it coast rather than stop dead.
     */
    DRAG: 0.6,
    /**
     * How much of the speed is shed on land per second. Much faster than the
     * water drag, so a boat run up a beach stops almost at once.
     */
    LAND_DRAG: 6.0,

    /**
     * How fast a boat sheds speed over snow, per second.
     *
     * Higher than `LAND_DRAG`, not lower, and the reason is the sign. A boat
     * rolling onto a drift is carrying speed it can no longer push, and it has
     * to come off it quickly or the surface reads as *faster* than the grass
     * beside it: scaling the drag by the same factor that scales the speed
     * divides it, and the boat coasts further over the snow than over the grass.
     * Drag is an exponent, so a surface that makes you slower is one that raises
     * this.
     */
    SNOW_DRAG: 18.0,
    /**
     * How far above the water the hull rides, in blocks. The boat sits *on* the
     * surface rather than in it, so the bottom of the hull is just under and
     * the gunwales are clear of the water.
     */
    RIDE_HEIGHT: 0.12,
    /**
     * How high the rider sits above the water, in blocks. Lower than a standing
     * player, which is what puts the camera below the top of the hull.
     */
    SEAT_HEIGHT: 0.55,
    /**
     * The box a boat occupies, as half extents. The model is 0.9375 wide and
     * 1.875 long, so these are the hull plus the oars.
     */
    HALF: { x: 0.5, y: 0.3, z: 0.95 },
    /**
     * How far a boat may be from the player and survive, in blocks, and how long
     * it gets before it does. A boat is a mob as far as despawning is concerned,
     * so it is the same 64 block distance and the same thirty second grace an
     * animal gets.
     */
    DESPAWN_DISTANCE: 64,
    DESPAWN_GRACE: 30,
    /**
     * How far the oars carry, in blocks.
     *
     * The same default every other sound in the game takes, and for the same
     * reason: without it a boat a hundred blocks up the coast is a metronome that
     * follows you along the bank. A boat you cannot hear the oars of is a boat
     * that has stopped being part of the world you are in.
     */
    PADDLE_RANGE: 16,
    /**
     * How many boats exist at once. Not a vanilla rule - there is none - but
     * a boat is a two block object with a model and a pair of oars on it, and a
     * player who has made twenty of them should not be able to bury the frame
     * rate in them.
     */
    MAX: 8,
    /**
     * How many swings it takes to break a boat, and how long a swing has to be
     * followed by another one.
     *
     * Not vanilla's 60 durability, because that is a damage *pool* rather than a
     * count: a boat in the real game is broken with an axe, and each axe swing
     * takes a large slice of it, while a bare hand takes a much smaller one. Six
     * is the number of clicks that reads as "a thing that takes some work" -
     * below three and a boat is a one-click resource, above about six and
     * picking one up to move it becomes a chore.
     *
     * `BREAK_HITS` is counted in swings rather than in break time, so it does
     * not care what is in your hand. That is a deliberate simplification: a
     * tool-dependent number would mean a boat survives an axe far longer than
     * a fist, and the thing you do to a boat is poke it until it gives.
     */
    BREAK_HITS: 6,

    /**
     * How far a boat leans at the moment it is hit, in radians, at full damage.
     *
     * The damage tell for a boat is not a crack overlay - the real game has none,
     * and neither does this one - it is the hull being knocked over. A fifth of
     * a turn is a hard list: the boat is plainly askew rather than gently
     * dipping, which is what makes a hit read as a hit from the saddle.
     *
     * The lean is a *knock*, not a wound. See `DAMAGE_TILT_SECONDS` for why, but
     * the short version is that the real game tips a struck boat over for a
     * moment and then has it sit upright again, so the lean is not cumulative
     * and a boat that has taken five of its six swings is not visibly more
     * askew than one that has taken one.
     */
    DAMAGE_TILT: 0.35,

    /**
     * How long a struck boat stays over, in seconds.
     *
     * One second, which is long enough to see and short enough that you are not
     * watching your own boat wobble. A lean that stayed would be a progress bar;
     * a lean that vanished on the next frame would be a glitch.
     */
    DAMAGE_TILT_SECONDS: 1.0,

    /**
     * How fast the boat can be swung at again, in seconds.
     *
     * The same gate the mobs use, for the same reason: a click that removes a
     * boat and no click that does not is indistinguishable from a boat with no
     * health at all, which is what this replaced.
     */
    SWING_COOLDOWN: 0.4,

    /**
     * How fast the oars swing, in strokes per second at full speed. A stroke is
     * one pull of each oar, so the two oars are half a period apart.
     */
    STROKE_RATE: 0.9,
    /**
     * How far an oar swings through its arc, in radians.
     */
    STROKE_ARC: 0.75,
    /**
     * How far the hull pitches and rolls with the rowing, in radians, and how
     * far it rocks on the water when it is not moving at all.
     */
    ROLL: 0.12,
    IDLE_ROCK: 0.02,
  },

  /**
   * Pathfinding.
   *
   * Every number here is a bound rather than a setting, because a pathfinder's
   * failure mode is not "a slightly worse route" - it is "the frame stops". A mob
   * that cannot find a path falls back to steering straight at its goal, which is
   * what it always did, so exceeding these costs quality and nothing else.
   */
  PATHFINDING: {
    /**
     * Nodes one query may expand before it gives up.
     *
     * A straight walk across a field is a few dozen. A route that has to go
     * round something, or find its way out of a hollow, runs to a few hundred. A
     * thousand is comfortably past "long" while staying small enough that one
     * query is a rounding error on a frame.
     */
    MAX_NODES: 1000,
    /**
     * Nodes every query together may expand in one frame.
     *
     * The second bound, and the one that actually protects the frame rate: with
     * two dozen mobs each deciding to re-path on the same frame, a per-query cap
     * would still let two dozen thousand nodes go out at once. This caps the
     * whole herd, and a mob that misses out simply keeps the path it had.
     */
    FRAME_BUDGET: 2000,
    /**
     * How far from itself a mob will search, in cells.
     *
     * Also a correctness bound, not only a cost one. Cells are packed into a
     * single number as pathfinding keys, and that packing is only unique inside
     * this window - a search that strayed past it would collide with another
     * cell's key and quietly corrupt itself.
     */
    MAX_RANGE: 48,
    /**
     * How close a mob has to get to a waypoint before it moves to the next, in
     * cells. Below half a block it is already standing on it.
     */
    WAYPOINT_REACHED: 0.9,
    /**
     * How far the goal may move before a mob re-paths, in blocks.
     *
     * A following target walks about, and re-pathing for every step it takes
     * would be a search per frame. A metre of drift is well inside the width of
     * a corridor, so the path stays valid for as long as it is worth keeping.
     */
    GOAL_DRIFT: 1.0,
    /**
     * How often a mob may re-path even if the goal has not moved, in seconds.
     * The backstop for a goal that has come to a stop: without this a mob would
     * follow a stale path for ever if the world changed under it.
     */
    REPATH_INTERVAL: 1.0,
    /**
     * How close another mob has to be before one of them is pushed away, in
     * blocks.
     *
     * Mobs that ignore each other walk through each other and then fight over the
     * same doorway, which looks like one of them has clipped through the other.
     */
    SEPARATION_RADIUS: 0.7,
    /**
     * How hard a mob is pushed out of another mob's space, as a fraction of its
     * walking speed. Enough to separate a clump over a second or two; any harder
     * and a crowd of them visibly explodes outwards.
     */
    SEPARATION_FORCE: 0.8,
  },

  /** The named times /time set understands, in ticks. */  TIME_PRESETS: { day: 1000, noon: 6000, night: 13000, midnight: 18000 },

  /* --- an ender pearl ---
     The cooldown is the real game's: one second, twenty ticks. It is what makes
     the item usable rather than a way to teleport at a keypress rate, and it is
     enforced separately from the quarter-second right-click cooldown that every
     other item shares. */
  PEARL: {
    COOLDOWN: 1.0,
    /** Damage on landing, in half hearts, which is Minecraft's `ender_pearl` type. */
    DAMAGE: 5,
  },

  /* --- fire ---
     Fire is placed with flint and steel and is what makes a nether portal
     enterable. It burns out on its own, it spreads to whatever will take it, and
     it burns the block it is sitting on away. */
  FIRE: {
    /** Seconds a flame lasts before it burns out on its own. */
    LIFETIME: 45,
    /**
     * Seconds before a flame that is sitting on something flammable burns that
     * block away and starts over.
     *
     * This is the difference between fire and a glowing block. Without it a
     * flame sits on a wooden floor for the full three quarters of a minute and
     * never consumes it, so a fire is a light source rather than a fire, and
     * the spread that does happen has nothing to eat as it goes.
     */
    BURN_THROUGH: 1.5,
    /** How often a fire block looks for somewhere to spread, in seconds. Vanilla
        fire spreads on a tick or two rather than on a timer; this is the same
        idea slowed to something a player can see happening, and to something a
        frame budget can afford. */
    SPREAD_INTERVAL: 0.7,
    /** The chance any one attempt succeeds. */
    SPREAD_CHANCE: 0.38,
    /** How many fire blocks one flame may create before it stops spreading. */
    MAX_SPREAD: 48,
    /** A ceiling on how many flames can burn at once, anywhere.

        A fire on a wide flat floor is genuinely self sustaining, because every
        flame that dies is replaced by the ones it lit, and each of those is a
        light source of its own. This is a frame time guard rather than a game
        rule: without it, setting one fire down on a netherrack plain turns the
        whole area into a moving light show. */
    MAX_FLAMES: 160,
    /** Seconds between the ticks of fire damage while the player is in it. */
    DAMAGE_INTERVAL: 1.0,
  },

  /* --- ambience ---
     Cave ambience is a two second rumble. It is off by default: looping it repeats
     a two second file every two seconds forever, which is unbearable, and even as a
     one-shot off a random gap it is a sound nobody asked for. Flip ENABLED to
     true to get it back, and then FIRST_GAP and the gap range below are what stop
     it becoming a loop.

     Underwater ambience is a different thing and is left on: it is a bed the
     player sits in for as long as they stay under, it is a long smooth file
     written to be looped, and being underwater is a state rather than a place. */
  AMBIENT_CAVE: {
    ENABLED: false,
    /** Seconds before the first rumble after walking into somewhere dark. */
    FIRST_GAP: 4,
    /** The gap between the ones after that is randomised over this range. */
    MIN_GAP: 60,
    MAX_GAP: 300,
  },

  /* --- chunk streaming --- */

  /**
   * How long one slice of chunk meshing may take, in milliseconds.
   *
   * Meshing is now interruptible: the mesher is handed this much time, does whole
   * scanline bands, and comes back for the rest next frame. That is the difference
   * between a chunk arriving over four frames and one arriving in a single hitch,
   * and the number is a slice rather than a total because the total is already
   * budgeted elsewhere.
   */
  MESH_SLICE_MS: 2.5,

  /* --- interaction --- */
  USE_COOLDOWN: 0.25,

  /* --- the Nether portal ---
     Vanilla's rule: a frame is at least 2 wide by 3 tall on the inside, and
     obsidian has to be the block you strike. PORTAL_COOLDOWN is the pause
     before a second strike can try again, so holding the button on one block
     cannot relight a portal that was just put out. */
  PORTAL: {
    MIN_WIDTH: 2,
    MIN_HEIGHT: 3,
    MAX_WIDTH: 21,
    MAX_HEIGHT: 21,
    /** How far flint and steel reaches out from the clicked block to close a
        frame that is not in the same plane as the frame already built. */
    EXTRA_SLACK: 2,
    /** How close a portal has to be, in blocks, for a dimension change to find
        it. Vanilla searches a small radius around the arrival point. */
    SEARCH_RADIUS: 12,
    /** Portal coordinates are divided by this on the way in and multiplied by it
        on the way out, the vanilla 1:8. */
    COORD_SCALE: 8,
    /** Height scales by half in each direction. */
    HEIGHT_SCALE: 2,
    /** Seconds the transition veil stays up. */
    TRANSITION_SECONDS: 0.9,
    /**
     * How long a portal will not take you after you arrive.
     *
     * Arriving in the Overworld puts the player back where they were standing,
     * which is inside the portal they just walked through, and arriving in the
     * Nether puts them on the ground with the portal behind their back. Either
     * way there is a moment where a portal could grab them and send them straight
     * back. A few seconds of quiet is the difference between a player who uses
     * the portal and one who gets caught in it.
     */
    REENTRY_DELAY: 5,
    /** Seconds a flint and steel spends after lighting a portal. */
    COOLDOWN: 4.0,
    /**
     * How near a lit portal has to be for its hum to play, in blocks in every
     * direction. The real game starts the hum when a player is close enough to
     * see a portal, not only when they are in one, which is what makes it arrive
     * before the player does.
     */
    HUM_RANGE: 5,
  },

  /* --- persistence --- */
  // Five seconds, which is Bedrock's interval rather than Java's twenty. It is
  // affordable because a save that finds nothing changed skips the encode
  // entirely, so the common case - standing still - costs a position compare and
  // a stats string per tick and no IndexedDB traffic at all. The cost shows up
  // when the player *is* moving, since a walk counts as a change and a large
  // world then re-encodes every two hundred visited chunks twice as often.
  AUTOSAVE_SECONDS: 5,

  /**
   * How long the saving indicator stays up, in milliseconds.
   *
   * It deliberately outlives the write. An IndexedDB write is a few milliseconds
   * whatever the world size, so tying the panel to it showed the animation for a
   * single frame. The arrow stepping into a chest is meant to be watched.
   */
  SAVE_INDICATOR_MIN_MS: 1200,

  /* --- chat --- */
  CHAT_MAX_LENGTH: 256,
  CHAT_LINES: 10,            // lines kept on screen above the prompt
  CHAT_FADE_SECONDS: 60,     // the real game drops a chat line after a minute
  CHAT_HISTORY: 30,
};

/** Mouse button sentinels, so a binding can be a key or a button. */
export const MOUSE_LEFT = 'MouseLeft';
export const MOUSE_MIDDLE = 'MouseMiddle';
export const MOUSE_RIGHT = 'MouseRight';

/** Presses of these alone never bind: they are modifiers, so Ctrl+K is `K`. */
const MODIFIERS = new Set([
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
  'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'CapsLock',
]);

/**
 * Every rebindable action, in the order the Controls screen lists them.
 *
 * `mouse: true` entries are shown but fixed - a mouse button is the only
 * sensible binding for "attack" and "use item", and offering to rebind them
 * would only produce a way to make the game unplayable.
 */
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
  { action: 'pickBlock', code: 'KeyB' },
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
  { action: 'perspective', code: 'F5' },
  { action: 'screenshot', code: 'F2' },
  { action: 'pause', code: 'Escape' },
  { action: 'steps', code: 'KeyM' },
];

/** Every action name, for validation and for the keybind conflict check. */
export const ACTIONS = KEYBINDS.map((b) => b.action);

/** The stock bindings as a plain action -> code object. */
export const DEFAULT_BINDS = Object.fromEntries(KEYBINDS.map((b) => [b.action, b.code]));

/**
 * Fold a stored override map onto the defaults, dropping anything that is not
 * a real action or a real key code, so a hand-edited or stale save can never
 * leave an action unbindable.
 *
 * @param {Record<string,string>|null|undefined} saved
 * @returns {Record<string,string>}
 */
export function resolveBinds(saved) {
  const out = { ...DEFAULT_BINDS };
  if (!saved || typeof saved !== 'object') return out;
  for (const action of ACTIONS) {
    const code = saved[action];
    if (typeof code === 'string' && code.length <= 32) out[action] = code;
  }
  return out;
}

/**
 * Take whichever binding an action currently owns, if the other action is
 * rebindable. Mouse bindings are left alone.
 *
 * @returns {string|null} the action that was holding the key, if any
 */
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
  brightness: 0.0,      // -1 .. 1 gamma offset
  volume: 0.7,
  musicVolume: 0.45,
  muted: false,
  guiScale: 0,           // 0 = auto, otherwise 1..4
  cloudHeight: 148,      // y level of the cloud layer
  language: 'en_us',
  viewBobbing: true,
  smoothLighting: true,
  /**
   * The frame rate readout in the top left corner.
   *
   * On by default and independent of the F3 overlay. It used to be off, and
   * toggling it did nothing at all: the field was written by the options screen
   * and by F3, and read by nothing. F3 was also the only place a frame rate was
   * ever drawn, as the first line of the debug panel - so the one thing the
   * setting appeared to control was the whole debug overlay.
   */
  showFps: true,
  /** What Am I Looking At (WALIA) - show block/item name under crosshair. */
  walia: true,
  playerName: 'Player',
  /** Overrides on top of DEFAULT_BINDS; absent or null means "all default". */
  keybinds: null,
};
