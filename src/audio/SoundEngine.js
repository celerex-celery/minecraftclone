/**
 * Audio engine backed by the real Minecraft sound files.
 *
 * Short effects are fetched once, decoded into AudioBuffers and replayed
 * through a small pool of sources with a random variant and a slight pitch
 * shift, which is what makes repeated digs and footsteps sound natural instead
 * of machine-gunned.
 *
 * Music tracks are large, so they are streamed lazily through <audio> elements
 * and only the currently needed one is downloaded.
 */

import { CONFIG } from '../core/Config.js';

const BASE = 'assets/sounds/';

/* group -> list of file stems (without .ogg) */
const MANIFEST = {
  dig: {
    stone: ['dig/stone1', 'dig/stone2', 'dig/stone3', 'dig/stone4'],
    wood: ['dig/wood1', 'dig/wood2', 'dig/wood3', 'dig/wood4'],
    grass: ['dig/grass1', 'dig/grass2', 'dig/grass3', 'dig/grass4'],
    gravel: ['dig/gravel1', 'dig/gravel2', 'dig/gravel3', 'dig/gravel4'],
    sand: ['dig/sand1', 'dig/sand2', 'dig/sand3', 'dig/sand4'],
    snow: ['dig/snow1', 'dig/snow2', 'dig/snow3', 'dig/snow4'],
    cloth: ['dig/cloth1', 'dig/cloth2', 'dig/cloth3', 'dig/cloth4'],
    deepslate: ['block/deepslate/break1', 'block/deepslate/break2', 'block/deepslate/break3'],
    glass: ['random/glass1', 'random/glass2', 'random/glass3'],
  },
  step: {
    stone: ['step/stone1', 'step/stone2', 'step/stone3', 'step/stone4', 'step/stone5', 'step/stone6'],
    wood: ['step/wood1', 'step/wood2', 'step/wood3', 'step/wood4', 'step/wood5', 'step/wood6'],
    grass: ['step/grass1', 'step/grass2', 'step/grass3', 'step/grass4', 'step/grass5', 'step/grass6'],
    gravel: ['step/gravel1', 'step/gravel2', 'step/gravel3', 'step/gravel4'],
    sand: ['step/sand1', 'step/sand2', 'step/sand3', 'step/sand4', 'step/sand5'],
    snow: ['step/snow1', 'step/snow2', 'step/snow3', 'step/snow4'],
    cloth: ['step/cloth1', 'step/cloth2', 'step/cloth3', 'step/cloth4'],
    ladder: ['step/ladder1', 'step/ladder2'],
    metal: ['block/iron/step1', 'block/iron/step2', 'block/iron/step3'],
  },
  one: {
    click: ['random/click'],
    woodClick: ['random/wood_click'],
    pickup: ['random/orb', 'random/pop'],
    hurt: ['damage/hit1', 'damage/hit2', 'damage/hit3'],
    fall: ['damage/fallbig'],
    fallSmall: ['damage/fallsmall'],
    ignite: ['fire/ignite'],
    /* the chicken, which is the only mob in the game */
    chickenIdle: ['mob/chicken/say1', 'mob/chicken/say2', 'mob/chicken/say3'],
    chickenHurt: ['mob/chicken/hurt1', 'mob/chicken/hurt2'],
    chickenStep: ['mob/chicken/step1', 'mob/chicken/step2'],
    /**
     * The egg-laying sound, not a landing one.
     *
     * `mob/chicken/plop` is what the sound table lists under `plop`, which in
     * vanilla is the noise a chicken makes when it lays. It was wired up here as
     * a landing thump, which is why a settling chicken sounded like something
     * being dropped into water.
     */
    chickenEgg: ['mob/chicken/plop'],
    /**
     * The chick, which is a different mob rather than a small chicken.
     *
     * The pack gives babies their own voice under `mob/chicken/baby_chicken`, and
     * they are not the adult's sounds pitched up - a different set of recordings,
     * with four hurt sounds to the adult's two and a single step rather than a
     * pair. Only the death sound is shared in shape with the adult's, and it is
     * not wired up here because nothing in the game plays a mob death sound.
     */
    chickIdle: ['mob/chicken/baby_chicken/ambient1', 'mob/chicken/baby_chicken/ambient2'],
    chickHurt: ['mob/chicken/baby_chicken/hurt1', 'mob/chicken/baby_chicken/hurt2',
      'mob/chicken/baby_chicken/hurt3', 'mob/chicken/baby_chicken/hurt4'],
    chickStep: ['mob/chicken/baby_chicken/step'],
    /**
     * The pig.
     *
     * A pig has a whole different voice to a chicken - a grunt, not a cluck -
     * and the pack gives it three of them where the chicken has two, five footstep
     * recordings against the chicken's single one, and a separate pair of
     * eating sounds. Vanilla has no dedicated hurt file for a pig either: it
     * reuses one of the idle grunts, which is what is wired up below.
     */
    pigIdle: ['mob/pig/say1', 'mob/pig/say2', 'mob/pig/say3'],
    pigHurt: ['mob/pig/say1', 'mob/pig/say2', 'mob/pig/say3'],
    pigStep: ['mob/pig/step1', 'mob/pig/step2', 'mob/pig/step3', 'mob/pig/step4', 'mob/pig/step5'],
    pigEat: ['mob/pig/eat1', 'mob/pig/eat2'],
    /**
     * The piglet.
     *
     * Like the chick, the pack gives a baby pig its own voice under
     * `mob/pig/baby_pig`, and it is not the adult's grunts pitched up. Unlike
     * the adult, which borrows idle grunts as hurt sounds, a baby pig has its
     * own hit files (vanilla names them `hit`, not `hurt`), and it keeps the
     * adult's full five footstep recordings.
     */
    babyPigIdle: ['mob/pig/baby_pig/ambient1', 'mob/pig/baby_pig/ambient2', 'mob/pig/baby_pig/ambient3',
      'mob/pig/baby_pig/ambient4', 'mob/pig/baby_pig/ambient5', 'mob/pig/baby_pig/ambient6'],
    babyPigHurt: ['mob/pig/baby_pig/hit1', 'mob/pig/baby_pig/hit2', 'mob/pig/baby_pig/hit3'],
    babyPigStep: ['mob/pig/baby_pig/step1', 'mob/pig/baby_pig/step2', 'mob/pig/baby_pig/step3',
      'mob/pig/baby_pig/step4', 'mob/pig/baby_pig/step5'],
    /**
     * A thrown ender pearl.
     *
     * The pack has no `item/ender_pearl/throw` or `/pop`, so these borrow the two
     * sounds that sit in the same place: the short throw is a click, and the pop
     * as it lands is literally the pop. Neither is a guess about mood - they are
     * the same two files, used where they fit.
     */
    pearlThrow: ['random/click'],
    pearlPop: ['random/pop'],
    eat: ['random/eat1', 'random/eat2', 'random/eat3'],
    drink: ['random/drink'],
    levelUp: ['random/levelup'],
    craft: ['ui/loom/take_result1', 'ui/loom/take_result2'],
    chestOpen: ['block/chest/open'],
    chestClose: ['block/chest/close1', 'block/chest/close2'],
    toastIn: ['ui/toast/in'],
    bubble: ['ui/hud/hud_bubble'],
    // the sound of going through a portal. The pack has no block/portal/travel,
    // and this is the same descending whoosh the real game uses for one, which
    // is close enough to be the right cue
    portalTravel: ['block/end_portal/endportal'],
    splash: ['liquid/splash', 'liquid/splash2'],
    /**
     * The oars.
     *
     * Two sets in the real game and both of them are here, because they are the
     * difference between a boat on a river and a boat on a beach: `paddle_water`
     * is a stroke through water and `paddle_land` is a scrape over ground, and a
     * boat that only ever made the first would still be convincing in a river
     * and completely wrong the moment it came ashore.
     *
     * Six and six out of the eight and six the pack ships. A stroke is played
     * about every 0.4s, so a boat under full paddle gets through the whole set
     * before repeating, and the ones left out are the two that sat closest to
     * the ones already chosen.
     */
    boatPaddleWater: ['entity/boat/paddle_water1', 'entity/boat/paddle_water2',
      'entity/boat/paddle_water3', 'entity/boat/paddle_water4',
      'entity/boat/paddle_water5', 'entity/boat/paddle_water6'],
    boatPaddleLand: ['entity/boat/paddle_land1', 'entity/boat/paddle_land2',
      'entity/boat/paddle_land3', 'entity/boat/paddle_land4',
      'entity/boat/paddle_land5', 'entity/boat/paddle_land6'],
    heavySplash: ['liquid/heavy_splash'],
    swim: ['liquid/swim1', 'liquid/swim2', 'liquid/swim3'],
    fuse: ['random/fuse'],
    explode: ['random/explode1', 'random/explode2'],
    zombieIdle: ['mob/zombie/idle1', 'mob/zombie/idle2', 'mob/zombie/idle3'],
    zombieHurt: ['mob/zombie/hurt1', 'mob/zombie/hurt2'],
    zombieDeath: ['mob/zombie/death1', 'mob/zombie/death2'],
    zombieStep: ['mob/zombie/step1', 'mob/zombie/step2', 'mob/zombie/step3', 'mob/zombie/step4', 'mob/zombie/step5'],
    // NEW: zombie fire sounds
    zombieFire: ['mob/zombie/fire1', 'mob/zombie/fire2'],
    /**
     * The enderman.
     *
     * The pack ships no `mob/enderman/*` files yet, so these borrow the nearest
     * existing recordings: zombie for the voice (low, guttural, unsettling) and
     * the zombie step for footfalls. Drop real enderman recordings into
     * `assets/sounds/mob/enderman/{idle,hurt,death,step}.ogg` and they will be
     * picked up automatically - the manifest keys are named for them.
     */
    endermanIdle: ['mob/enderman/idle1', 'mob/enderman/idle2', 'mob/enderman/idle3', 'mob/enderman/idle4', 'mob/enderman/idle5'],
    endermanHurt: ['mob/enderman/hit1', 'mob/enderman/hit2', 'mob/enderman/hit3', 'mob/enderman/hit4'],
    endermanDeath: ['mob/enderman/death'],
    endermanStep: ['mob/zombie/step1', 'mob/zombie/step2', 'mob/zombie/step3', 'mob/zombie/step4', 'mob/zombie/step5'],
    endermanScream: ['mob/enderman/scream1', 'mob/enderman/scream2', 'mob/enderman/scream3', 'mob/enderman/scream4'],
    endermanStare: ['mob/enderman/stare'],
    endermanTeleport: ['mob/enderman/portal', 'mob/enderman/portal2'],
    creeperIdle: ['mob/creeper/say1', 'mob/creeper/say2', 'mob/creeper/say3', 'mob/creeper/say4'],
    creeperHurt: ['mob/creeper/say1', 'mob/creeper/say2', 'mob/creeper/say3', 'mob/creeper/say4'],
    creeperDeath: ['mob/creeper/death'],
    creeperStep: ['mob/zombie/step1', 'mob/zombie/step2', 'mob/zombie/step3', 'mob/zombie/step4', 'mob/zombie/step5'],
  },
  ambient: {
    cave: ['ambient/cave/cave1', 'ambient/cave/cave5', 'ambient/cave/cave9',
      'ambient/cave/cave14', 'ambient/cave/cave19', 'ambient/cave/cave23'],
    underwater: ['ambient/underwater/underwater_ambience'],
    /**
     * The rain.
     *
     * Not a key `setAmbience` can be given - see `setRain`, which drives this
     * list on its own channel. The pack ships these two as short one-shots
     * rather than a written-to-be-looped bed, so one is picked at random and
     * looped; at a couple of seconds each that is short enough not to read as a
     * loop point once it is faded down under the rest of the mix.
     */
    rain: ['ambient/weather/rain1', 'ambient/weather/rain2'],
    // the hum of a lit nether portal. A five second file, meant to be looped -
    // unlike the cave rumble, which is an event and is never looped
    portal: ['portal/portal'],
  },
};

/**
 * The music, by context.
 *
 * Each entry is a path plus the credit the game shows for it. Vanilla names its
 * tracks the same way — `music.minecraft.stratum`, `music.minecraft.13` — and
 * puts "author - title" in a toast in the top left when one starts, so the credit
 * is part of the track rather than something the interface invents.
 *
 * The author is optional. The Nether track has none written against it, because
 * a guess would be worse than nothing, so it shows its title alone.
 */
const CREDIT = (path, author, name) => ({
  path,
  author,
  name,
  title: author ? `${author} - ${name}` : name,
});
const C418 = 'C418';

const MUSIC = {
  menu: [CREDIT('music/minecraft', C418, 'Minecraft')],
  game: [
    CREDIT('music/a_familiar_room', C418, 'A Familiar Room'),
    CREDIT('music/dry_hands', C418, 'Dry Hands'),
    CREDIT('music/wet_hands', C418, 'Wet Hands'),
    CREDIT('music/oxygene', C418, 'Oxygené'),
    CREDIT('music/sweden', C418, 'Sweden'),
    CREDIT('music/key', C418, 'Key'),
  ],
  /**
   * The Nether's own track, and only its own track.
   *
   * A separate context rather than another entry in the overworld's list, so
   * walking through a portal changes the music instead of occasionally shuffling
   * it, and so the whole dimension has one piece of music to it the way the real
   * game has a handful for the Nether rather than the overworld's rotation.
   */
  nether: [CREDIT('music/nether', 'Celerex', 'Lethal Nether Land')],
  /**
   * The End's own track, and only its own track.
   *
   * Single track, so the engine loops it automatically (SoundEngine.js:864).
   */
  end: [CREDIT('music/TheEnd', null, 'The End')],
  /**
   * End credits music - plays when returning from the End to Overworld.
   */
  endcredits: [CREDIT('music/haggstromcredits', 'C418', 'Haggstrom')],
};

/** Block definition -> material group used to pick dig / step sounds. */
const MATERIAL_FOR_BLOCK = (name) => {
  if (!name) return 'stone';
  if (name.includes('leaves') || name.includes('grass') || name.includes('fern')
    || name.includes('sugar_cane') || name.includes('sapling') || name.includes('vine')) return 'grass';
  if (name.includes('dead_bush')) return 'grass';
  if (name.includes('log') || name.includes('planks') || name.includes('crafting')
    || name.includes('furnace') || name === 'chest' || name === 'bookshelf') return 'wood';
  if (name === 'sand' || name === 'red_sand') return 'sand';
  if (name === 'gravel' || name === 'clay') return 'gravel';
  if (name.includes('snow') || name.includes('ice')) return 'snow';
  // a bed is cloth over a wooden frame, and the cloth sounds are the half of it
  // you actually hear - the frame is under the whole thing and never struck
  if (name.includes('leather') || name.includes('wool') || name.includes('bed')) return 'cloth';
  if (name.includes('iron_block') || name.includes('gold_block') || name.includes('diamond_block')) return 'metal';
  if (name === 'glass' || name === 'ice') return 'glass';
  if (name.includes('deepslate')) return 'deepslate';
  return 'stone';
};

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.enabled = true;
    this.volume = 0.7;
    this.musicVolume = 0.5;
    /**
     * Music on or off, separately from the master mute.
     *
     * Muted is everything; this is only the music, so a player who wants the
     * sound effects and no music turns this off. It is its own switch because
     * "music volume at zero" and "no music at all" are different intentions: one
     * is quieter, the other is the music gone.
     */
    this.musicEnabled = true;
    /** whether the now-playing panel is drawn at all */
    this.musicToasts = true;
    this.muted = false;

    /** path -> Promise<AudioBuffer|null> */
    this.buffers = new Map();
    this.loading = false;

    this.music = new Map();      // path -> HTMLAudioElement
    this.currentMusic = null;
    /** the name of the track playing now, for the toast in the corner */
    this.currentTrackName = null;
    /** called with (name, path) whenever a track actually starts */
    this.onTrackStart = null;
    this.musicTimer = 0;
    this.playlist = [];
    this.playlistIndex = 0;
  }

  /* ================================================================
     setup
     ================================================================ */

  /** Must be called from a user gesture. */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(this.ctx.destination);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 1;
    this.sfxGain.connect(this.master);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.musicVolume;
    this.musicGain.connect(this.master);
    /**
     * The weather bed, on its own gain, feeding the master.
     *
     * The rain is the one ambience that is routed through the audio graph rather
     * than played straight out of the element, because it is the one that has to
     * respond to the volume and mute settings. The cave and portal beds set
     * `el.volume` directly and so bypass both - which is a pre-existing gap they
     * have always had, not something this channel introduced, but there is no
     * reason to add a fourth bed with the same problem.
     *
     * The gain is created here rather than per rain element because the graph
     * cannot be torn down and rebuilt cheaply, and the element is created lazily
     * whenever it first rains.
     */
    this.weatherGain = this.ctx.createGain();
    this.weatherGain.gain.value = 1;
    this.weatherGain.connect(this.master);

    this.loading = true;
    this.preload();
  }

  get ready() {
    return this.enabled && this.ctx && this.ctx.state === 'running';
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = this.muted ? 0 : v;
  }

  setMusicVolume(v) {
    this.musicVolume = v;
    if (this.musicGain) this.musicGain.gain.value = v;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
  }

  /**
   * Music on or off, apart from its own volume.
   *
   * Muted is the master switch and takes everything with it; this is the one
   * that only stops the music, so a player who wants the sound effects and
   * nothing else turns this off and leaves `muted` alone. Turning it off stops
   * whatever is playing rather than running it silently to the end.
   */
  setMusicEnabled(on) {
    const want = !!on;
    if (want === this.musicEnabled) return;
    this.musicEnabled = want;
    if (!want) this.stopMusic();
    else if (this._musicContext) this.nextTrack();
  }

  /* ================================================================
     loading
     ================================================================ */

  async fetchBuffer(path) {
    if (this.buffers.has(path)) return this.buffers.get(path);
    const p = (async () => {
      try {
        const res = await fetch(BASE + path + '.ogg');
        if (!res.ok) throw new Error(res.status);
        const raw = await res.arrayBuffer();
        return await this.ctx.decodeAudioData(raw);
      } catch {
        return null;
      }
    })();
    this.buffers.set(path, p);
    return p;
  }

  /** Warm the small effect files so the first dig is not delayed. */
  preload() {
    const jobs = [];
    for (const group of ['dig', 'step']) {
      for (const key of Object.keys(MANIFEST[group])) {
        for (const p of MANIFEST[group][key]) jobs.push(this.fetchBuffer(p));
      }
    }
    for (const key of Object.keys(MANIFEST.one)) {
      for (const p of MANIFEST.one[key]) jobs.push(this.fetchBuffer(p));
    }
    Promise.all(jobs).then(() => { this.loading = false; });
  }

  /* ================================================================
     playback
     ================================================================ */

  /**
   * Play one file from a list of variants.
   * @param {string[]} list
   * @param {{volume?:number, rate?:number, rateJitter?:number}} opts
   */
  playFrom(list, opts = {}) {
    if (!this.ready || !list?.length) return;
    const path = list[(Math.random() * list.length) | 0];
    this.fetchBuffer(path).then((buf) => {
      if (!buf || !this.ready) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = (opts.rate ?? 1) * (1 + (Math.random() - 0.5) * (opts.rateJitter ?? 0.12));
      const g = this.ctx.createGain();
      g.gain.value = opts.volume ?? 0.6;
      src.connect(g).connect(this.sfxGain);
      src.start();
    });
  }

  group(group, key) {
    return MANIFEST[group]?.[key] ?? MANIFEST.dig.stone;
  }

  materialFor(def) {
    return MATERIAL_FOR_BLOCK(def?.name);
  }

  /* ---------------- block sounds ---------------- */

  dig(def) {
    const mat = MATERIAL_FOR_BLOCK(def?.name);
    this.playFrom(this.group('dig', mat), { volume: 0.35 });
  }

  breakBlock(def) {
    const mat = MATERIAL_FOR_BLOCK(def?.name);
    this.playFrom(this.group('dig', mat), { volume: 0.8, rate: 0.82, rateJitter: 0.1 });
  }

  place(def) {
    const mat = MATERIAL_FOR_BLOCK(def?.name);
    this.playFrom(this.group('step', mat) ?? this.group('step', 'stone'), { volume: 0.6, rate: 1.1 });
  }

  step(def, volume = 0.3) {
    if (this._lastStep && this.ctx.currentTime - this._lastStep < 0.26) return;
    this._lastStep = this.ctx.currentTime;
    const mat = MATERIAL_FOR_BLOCK(def?.name);
    this.playFrom(this.group('step', mat), { volume, rate: 0.95 + Math.random() * 0.15 });
  }

  /* ---------------- player ---------------- */

  click() { this.playFrom(MANIFEST.one.click, { volume: 0.5 }); }

  /** Flint and steel striking a block that is not a frame. */
  ignite() { this.playFrom(MANIFEST.one.ignite, { volume: 0.55, rate: 0.9 }); }

  pickup() { this.playFrom(MANIFEST.one.pickup, { volume: 0.4, rate: 1.1 }); }
  hurt() { this.playFrom(MANIFEST.one.hurt, { volume: 0.7 }); }
  fall() { this.playFrom(MANIFEST.one.fall, { volume: 0.7 }); }
  fallSmall() { this.playFrom(MANIFEST.one.fallSmall, { volume: 0.5 }); }
  /**
   * The mob and vehicle sounds, and the one thing they all have in common.
   *
   * Every one of these takes a `gain` between 0 and 1, and it is the mob's or
   * the boat's *hearing gain* - how much of its sound actually reaches the
   * listener at the distance it happens to be standing. It is not a stylistic
   * knob and it is not optional: a sound with no distance rule is a sound that
   * is played at full volume from anywhere in the world, and a chicken clucking
   * from the far side of a continent is the single loudest way this game can
   * sound broken.
   *
   * Where the caller gets the number is in `Mob.update`, and it is the whole of
   * the fix: nothing here decides whether it is audible, so nothing here has to
   * know about mobs.
   */
  chickenIdle(gain = 1) { this.playFrom(MANIFEST.one.chickenIdle, { volume: 0.35 * gain }); }
  chickenHurt(gain = 1) { this.playFrom(MANIFEST.one.chickenHurt, { volume: 0.5 * gain }); }
  chickenStep(gain = 1) { this.playFrom(MANIFEST.one.chickenStep, { volume: 0.22 * gain }); }
  chickenEgg(gain = 1) { this.playFrom(MANIFEST.one.chickenEgg, { volume: 0.45 * gain }); }
  chickIdle(gain = 1) { this.playFrom(MANIFEST.one.chickIdle, { volume: 0.35 * gain }); }
  chickHurt(gain = 1) { this.playFrom(MANIFEST.one.chickHurt, { volume: 0.5 * gain }); }
  /**
   * Louder than an adult's step, which is the one place the two really differ in
   * practice: a chick is a fraction of the size and its single step file is
   * pitched to sound like something that small, so playing it at the adult's
   * 0.22 makes it inaudible from two blocks away.
   */
  chickStep(gain = 1) { this.playFrom(MANIFEST.one.chickStep, { volume: 0.3 * gain }); }
  pigIdle(gain = 1) { this.playFrom(MANIFEST.one.pigIdle, { volume: 0.55 * gain }); }
  pigHurt(gain = 1) { this.playFrom(MANIFEST.one.pigHurt, { volume: 0.7 * gain }); }
  /**
   * A pig's footfalls are heavier than a chicken's and the pack supplies five of
   * them, so a herd sounds like a herd rather than five animals stepping in
   * lockstep. Louder too: a pig is a quarter again the height of a chicken and
   * the recording is pitched for something that size.
   */
  pigStep(gain = 1) { this.playFrom(MANIFEST.one.pigStep, { volume: 0.34 * gain }); }
  pigEat(gain = 1) { this.playFrom(MANIFEST.one.pigEat, { volume: 0.7 * gain }); }
  babyPigIdle(gain = 1) { this.playFrom(MANIFEST.one.babyPigIdle, { volume: 0.45 * gain }); }
  babyPigHurt(gain = 1) { this.playFrom(MANIFEST.one.babyPigHurt, { volume: 0.55 * gain }); }
  /**
   * Softer than a pig's step, for the same reason a chick's is louder than a
   * chicken's: the recording is pitched for a much smaller animal, so it gets
   * played at the volume that size needs. Half the height of a pig, roughly
   * three quarters of the weight it would have if scaled up, and its step files
   * already sound light on their own.
   */
  babyPigStep(gain = 1) { this.playFrom(MANIFEST.one.babyPigStep, { volume: 0.25 * gain }); }
  /**
   * A stroke through water, and a scrape over ground.
   *
   * Louder than they look on paper, because a boat's oar is a metre of wood
   * moving through a metre of water a couple of times a second and the real
   * game plays it unattenuated. At half that it is a rhythm and nothing else.
   *
   * Attenuated like everything else in this group: an oar two hundred blocks up
   * the coast is not something anyone is meant to hear, and without the range it
   * is a metronome that follows you along the shore.
   */
  boatPaddleWater(gain = 1) { this.playFrom(MANIFEST.one.boatPaddleWater, { volume: 0.45 * gain }); }
  boatPaddleLand(gain = 1) { this.playFrom(MANIFEST.one.boatPaddleLand, { volume: 0.4 * gain }); }
  pearlThrow() { this.playFrom(MANIFEST.one.pearlThrow, { volume: 0.6, rate: 1.3 }); }
  /** The pop as a pearl lands, which is the last sound before you are moved. */
  pearlPop() { this.playFrom(MANIFEST.one.pearlPop, { volume: 0.7 }); }
  eat() { this.playFrom(MANIFEST.one.eat, { volume: 0.5 }); }
  drink() { this.playFrom(MANIFEST.one.drink, { volume: 0.5 }); }
  levelUp() { this.playFrom(MANIFEST.one.levelUp, { volume: 0.8 }); }
  craft() { this.playFrom(MANIFEST.one.craft, { volume: 0.6 }); }
  bubble() { this.playFrom(MANIFEST.one.bubble, { volume: 0.4 }); }
  splash() { this.playFrom(MANIFEST.one.splash, { volume: 0.7 }); }
  heavySplash() { this.playFrom(MANIFEST.one.heavySplash, { volume: 0.8 }); }
  swim() { this.playFrom(MANIFEST.one.swim, { volume: 0.4 }); }
  fuse() { this.playFrom(MANIFEST.one.fuse, { volume: 0.5 }); }
  explode() { this.playFrom(MANIFEST.one.explode, { volume: 1.0 }); }
  chestOpen() { this.playFrom(MANIFEST.one.chestOpen, { volume: 0.6 }); }
  /**
   * Softer than a pig's step, for the same reason a chick's is louder than a
   * chicken's: the recording is pitched for a much smaller animal, so it gets
   * played at the volume that size needs. Half the height of a pig, roughly
   * three quarters of the weight it would have if scaled up, and its step files
   * already sound light on their own.
   */
    babyPigStep(gain = 1) { this.playFrom(MANIFEST.one.babyPigStep, { volume: 0.25 * gain }); }
    zombieIdle(gain = 1) { this.playFrom(MANIFEST.one.zombieIdle, { volume: 0.35 * gain }); }
    zombieHurt(gain = 1) { this.playFrom(MANIFEST.one.zombieHurt, { volume: 0.5 * gain }); }
    zombieDeath(gain = 1) { this.playFrom(MANIFEST.one.zombieDeath, { volume: 0.5 * gain }); }
    zombieStep(gain = 1) { this.playFrom(MANIFEST.one.zombieStep, { volume: 0.22 * gain }); }
    // NEW: zombie fire
    zombieFire(gain = 1) { this.playFrom(MANIFEST.one.zombieFire, { volume: 0.7 * gain }); }

    endermanIdle(gain = 1) { this.playFrom(MANIFEST.one.endermanIdle, { volume: 0.35 * gain }); }
    endermanHurt(gain = 1) { this.playFrom(MANIFEST.one.endermanHurt, { volume: 0.5 * gain }); }
    endermanDeath(gain = 1) { this.playFrom(MANIFEST.one.endermanDeath, { volume: 0.5 * gain }); }
    endermanStep(gain = 1) { this.playFrom(MANIFEST.one.endermanStep, { volume: 0.22 * gain }); }
    /**
     * The scream an enderman lets out the moment it is provoked by a stare.
     * Played once at the provocation point, not repeated while it chases.
     */
    endermanScream(gain = 1) { this.playFrom(MANIFEST.one.endermanScream, { volume: 0.6 * gain }); }

    endermanStare(gain = 1) { this.playFrom(MANIFEST.one.endermanStare, { volume: 0.6 * gain }); }

    endermanTeleport(gain = 1) { this.playFrom(MANIFEST.one.endermanTeleport, { volume: 1.0 * gain }); }

    creeperIdle(gain = 1) { this.playFrom(MANIFEST.one.creeperIdle, { volume: 0.35 * gain }); }
    creeperHurt(gain = 1) { this.playFrom(MANIFEST.one.creeperHurt, { volume: 0.5 * gain }); }
    creeperDeath(gain = 1) { this.playFrom(MANIFEST.one.creeperDeath, { volume: 0.5 * gain }); }
    creeperStep(gain = 1) { this.playFrom(MANIFEST.one.creeperStep, { volume: 0.22 * gain }); }

  /* ---------------- nether portals ----------------

  /* ---------------- nether portals ----------------

      The pack ships no `block/portal/trigger` or `block/portal/travel` file, so
      both are built from sounds it does have. Feedback for a portal in the real
      game is *only* sound - there is no chat line for lighting one or for going
      through one - so these two carry all of it. */

  /** Flint and steel striking a block that is not a frame. */
  portalFail() {
    this.ignite();
  }

  /** A portal catching: the flint strike, then the portal waking up. */
  portalIgnite() {
    this.playFrom(MANIFEST.one.click, { volume: 0.5 });
    this.playFrom(MANIFEST.one.pickup, { volume: 0.5, rate: 0.7, rateJitter: 0.05 });
  }

  /** Going through one. The long descending whoosh, which is what the game uses. */
  portalTravel() {
    this.playFrom(MANIFEST.one.portalTravel, { volume: 0.7 });
  }

  death() {
    this.playFrom(MANIFEST.one.fall, { volume: 0.8, rate: 0.7 });
    this.stopMusic();
  }

  /* ---------------- ambience ---------------- */

  /**
   * Cross fade between ambience beds.
   *
   * These are not one kind of thing and are not treated as one. Underwater and the
   * portal hum are *states the player is in* - they are beds, and the files are
   * long and written to be looped, so they loop. Cave ambience is an *event*: the
   * real game plays a two second rumble every once in a while when you are
   * somewhere dark, not continuously, and looping that turns a two second file
   * into something that repeats every two seconds forever, which is the single
   * most annoying sound a game can make. So it is a one-shot off a long random gap
   * and is never looped.
   *
   * @param {'none'|'cave'|'underwater'|'portal'} which
   */
  setAmbience(which) {
    if (this._ambience === which) return;
    this._ambience = which;

    // fade out whatever is currently playing
    for (const [name, el] of this.ambienceEls ?? new Map()) {
      if (name === which || el.paused) continue;
      this._fadeOut(el);
    }
    if (which === 'none') return;

    if (which === 'cave' && !CONFIG.AMBIENT_CAVE.ENABLED) {
      this._ambience = 'none';
      return;
    }

    // leaving a cave cancels the rumble that was lined up, so it cannot fire two
    // seconds after the player walks out into the sun
    if (this._caveTimer) {
      clearTimeout(this._caveTimer);
      this._caveTimer = null;
    }

    const list = MANIFEST.ambient[which];
    if (!list) return;
    this.ambienceEls ??= new Map();
    let el = this.ambienceEls.get(which);
    if (!el) {
      el = new Audio();
      el.src = BASE + list[(Math.random() * list.length) | 0] + '.ogg';
      // a looping bed is only right for a file written to be looped
      el.loop = which !== 'cave';
      el.volume = 0;
      el.preload = 'auto';
      this.ambienceEls.set(which, el);
    }
    if (which === 'cave') {
      // a one-shot: the first one comes almost immediately, so entering a cave
      // sounds like something happening, and the long gap after it is what keeps
      // it from becoming a loop
      this._scheduleCave(el, CONFIG.AMBIENT_CAVE.FIRST_GAP);
      return;
    }
    if (el.paused) {
      el.currentTime = 0;
      el.play().then(() => this._fadeIn(el)).catch(() => {
        // blocked until the first user gesture; retry on resume()
        this._pendingAmbience = which;
      });
    } else {
      this._fadeIn(el);
    }
  }

  /**
   * Play one cave rumble, then line up the next one a long way off.
   *
   * The gap is randomised over a wide range rather than fixed, because a fixed
   * gap is just a metronome: at twenty seconds it is a machine gun, and at four
   * minutes it is fine. The range runs from a minute to five, and starts over
   * from scratch each time the player leaves a cave, so walking back in does not
   * always catch you on the same beat.
   */
  _scheduleCave(el, delay) {
    if (this._caveTimer) {
      clearTimeout(this._caveTimer);
      this._caveTimer = null;
    }
    const F = CONFIG.AMBIENT_CAVE;
    const wait = delay ?? (F.MIN_GAP + Math.random() * (F.MAX_GAP - F.MIN_GAP));
    this._caveTimer = setTimeout(() => {
      this._caveTimer = null;
      if (this._ambience !== 'cave' || this.muted) return;
      el.currentTime = 0;
      el.play().then(() => this._fadeIn(el)).catch(() => {});
      this._scheduleCave(el, null);
    }, wait * 1000);
  }

  /**
   * The rain, as a continuous bed whose volume follows how hard it is raining.
   *
   * This is deliberately *not* another key in `MANIFEST.ambient`. Those are
   * mutually exclusive: `setAmbience` fades out every bed that is not the one it
   * was asked for, because underwater, in a cave and at a portal are states you
   * are in rather than things layered on top of each other. Rain is not one of
   * those - it rains inside a cave mouth and over a portal and while you are
   * underwater at the surface - so it gets its own channel that nothing else
   * touches. Sharing the exclusive switch would have meant rain cutting out the
   * moment you walked into a tunnel, which is the opposite of right.
   *
   * It is driven by an amount rather than a boolean for the same reason the
   * visuals are: a shower that starts and stops at full volume reads as a sound
   * effect, and one that swells and eases reads as weather. The volume follows
   * the weather system's own eased intensity, so the sound and the sight of it
   * arrive together.
   *
   * @param {number} amount 0..1, how hard it is raining
   */
  setRain(amount) {
    // remembered so a resume after an autoplay block can pick up where the
    // weather actually is, rather than restarting at full or not at all
    this._rainAmount = amount;
    const vol = Math.max(0, Math.min(1, amount)) * CONFIG.WEATHER.RAIN_VOLUME;
    // below this it is not worth an element playing at all, and starting one
    // for a drizzle means a click of silence before the fade even begins
    if (vol < 0.01) {
      if (this._rainEl && !this._rainEl.paused) this._rampRain(0);
      return;
    }

    if (!this._rainEl) {
      const el = new Audio();
      const list = MANIFEST.ambient.rain;
      el.src = BASE + list[(Math.random() * list.length) | 0] + '.ogg';
      el.loop = true;
      el.volume = 1;
      el.preload = 'auto';
      this._rainEl = el;
      // route it through the graph so the volume and mute settings reach it.
      // `createMediaElementSource` is once-per-element for the lifetime of the
      // page, and the element is cached, so this runs exactly once. Without a
      // context - no user gesture yet - the element plays direct and simply
      // does not respond to mute until the next reload, which is the same
      // position the other beds are in anyway.
      if (this.ctx && !this._rainSrc) {
        try {
          this._rainSrc = this.ctx.createMediaElementSource(el);
          this._rainSrc.connect(this.weatherGain);
        } catch {
          this._rainSrc = null;
        }
      }
    }
    const el = this._rainEl;
    if (el.paused) {
      el.play().catch(() => {
        // blocked until the first user gesture; resume() picks it up
        this._rainPending = true;
      });
    }
    this._rampRain(vol);
  }

  /**
   * Ease the weather bed's gain toward a target.
   *
   * It ramps the gain node rather than the element's own `volume`, because the
   * element is held at full and the graph is what the master gain sits behind -
   * ramping `el.volume` as well would square the two together. It is also its
   * own ramp rather than `_fadeIn`, which steps a fixed 0.05 every 60ms: that is
   * fine for a bed that only ever goes to one volume, but this one has a new
   * target every frame while the weather eases, and a fixed step against a moving
   * target chatters.
   *
   * @param {number} target
   */
  _rampRain(target) {
    const gain = this.weatherGain;
    if (!gain) return;
    if (this._rainFade) clearTimeout(this._rainFade);
    const step = () => {
      const now = gain.gain.value;
      // get within a twentieth of the target, then stop: below that the ramp is
      // stepping less than the value the next frame will ask for anyway
      if (Math.abs(target - now) < 0.05) {
        gain.gain.value = target;
        this._rainFade = null;
        return;
      }
      gain.gain.value = now + (target - now) * 0.25;
      this._rainFade = setTimeout(step, 60);
    };
    step();
  }

  _fadeIn(el) {
    this._clearFade(el);
    const target = el.dataset.targetVolume ? Number(el.dataset.targetVolume) : 0.3;
    el.dataset.fading = 'in';
    const step = () => {
      if (el.dataset.fading !== 'in') return;
      if (el.volume < target) {
        el.volume = Math.min(target, el.volume + 0.05);
        el._fadeTimer = setTimeout(step, 60);
      }
    };
    step();
  }

  _fadeOut(el) {
    this._clearFade(el);
    el.dataset.fading = 'out';
    const step = () => {
      if (el.dataset.fading !== 'out') return;
      if (el.volume > 0) {
        el.volume = Math.max(0, el.volume - 0.05);
        el._fadeTimer = setTimeout(step, 60);
      } else {
        el.pause();
      }
    };
    step();
  }

  _clearFade(el) {
    if (el._fadeTimer) clearTimeout(el._fadeTimer);
    el._fadeTimer = null;
  }

  /* ---------------- music ---------------- */

  /**
   * Start the playlist for a context: 'menu', 'game' or 'nether'.
   *
   * Switching context stops the current track and starts the new one from the
   * beginning. That is deliberate rather than a fade: the tracks are long, and a
   * Nether track that began twenty seconds in because the player happened to walk
   * through a portal would sound like a mistake. The crossfade the rest of the
   * sound uses is not worth the wait for a context that changes once every few
   * minutes.
   */
  playMusic(context) {
    if (this._musicContext === context && this.currentMusic && !this.currentMusic.paused) return;
    this._musicContext = context;
    // A track parked by the autoplay policy belonged to the *previous* context.
    // Keeping it would mean the title screen's music starting up on top of the
    // Nether's one, several seconds after the player walked through a portal.
    this._pendingMusic = null;
    // Any play() still in flight is now stale, and must not be allowed to claim
    // currentMusic when it resolves
    this._musicToken = (this._musicToken ?? 0) + 1;
    this.stopMusic();
    this.playlist = MUSIC[context] ?? MUSIC.game;
    this.playlistIndex = (Math.random() * this.playlist.length) | 0;
    this.nextTrack();
  }

  nextTrack() {
    if (!this._musicContext || !this.musicEnabled) return;
    const track = this.playlist[this.playlistIndex % this.playlist.length];
    this.playlistIndex++;
    // `title` is the credit as it is shown, "author - song"
    const { path, title, name, author } = track;
    // The context this track belongs to, so a slow play() cannot overwrite the
    // current one after the player has already moved somewhere else
    const token = this._musicToken;

    let el = this.music.get(path);
    if (!el) {
      el = new Audio();
      el.src = BASE + path + '.ogg';
      // Loop single-track playlists (like endcredits) automatically
      el.loop = this.playlist.length === 1;
      el.preload = 'auto';
      this.music.set(path, el);
    }
    el.currentTime = 0;
    el.volume = this.muted ? 0 : this.musicVolume;
    el.play().then(() => {
      if (this._musicToken !== token) {
        // the context moved on while this was starting: stop it rather than let
        // it play over the track that replaced it
        el.pause();
        return;
      }
      this.currentMusic = el;
      this.currentMusicPath = path;
      // and tell whoever is drawing the screen what is playing, so the panel in
      // the corner can credit it
      this.currentTrackName = title;
      this.currentTrackAuthor = author;
      this.onTrackStart?.(title, path);
    }).catch(() => {
      // blocked until a gesture; retry once the player interacts
      this._pendingMusic = path;
    });
  }

  /**
   * Stop the music, all of it.
   *
   * Every cached element is paused rather than just the one currently pointed at,
   * and that is the whole point. `currentMusic` is only assigned inside a play()
   * promise, so between a `play()` call and its resolution it is still the
   * *previous* track - or null, if this is the first one. Pausing only that
   * element therefore misses anything whose promise has not landed yet, which is
   * exactly how two tracks end up playing at once: the new context starts a
   * track, and a moment later a stale promise resolves and leaves the old one
   * running. Walking the whole cache makes that impossible.
   */
  stopMusic() {
    for (const el of this.music.values()) {
      if (el.paused) continue;
      el.pause();
      el.currentTime = 0;
    }
    this.currentMusic = null;
    this.currentMusicPath = null;
  }

  /** Called from the game loop: handles track changes and underwater muffling. */
  update(dt, { underwater = false } = {}) {
    if (!this.musicEnabled) return;
    if (this.currentMusic) {
      if (this.currentMusic.ended) this.nextTrack();
      const target = this.muted ? 0 : this.musicVolume * (underwater ? 0.35 : 1);
      this.currentMusic.volume += (target - this.currentMusic.volume) * Math.min(1, dt * 3);
    }
  }

  /** Resume music that was blocked by the browser autoplay policy. */
  resume() {
    if (this._rainPending) {
      this._rainPending = false;
      // the bed was created but never started; play it at whatever the weather
      // is asking for now, which may well be silence
      this.setRain(this._rainAmount ?? 0);
    }
    if (this._pendingAmbience) {
      const which = this._pendingAmbience;
      this._pendingAmbience = null;
      this._ambience = null;
      this.setAmbience(which);
    }
    if (this._pendingMusic) {
      const path = this._pendingMusic;
      this._pendingMusic = null;
      // only worth resuming if it still belongs to the playlist in play. A track
      // parked before the context changed is not wanted: the title screen's music
      // must not start up in the middle of the Nether.
      if (this.playlist?.some((t) => t.path === path)) {
        const token = this._musicToken;
        const el = this.music.get(path);
        const track = this.playlist.find((t) => t.path === path);
        el?.play().then(() => {
          if (this._musicToken !== token) {
            el.pause();
            return;
          }
          this.currentMusic = el;
          this.currentTrackName = track?.title;
          this.currentTrackAuthor = track?.author;
          this.onTrackStart?.(track?.title, path);
        }).catch(() => {});
        return;
      }
    }
    if (this._musicContext && this.currentMusic && this.currentMusic.paused) {
      this.currentMusic.play().catch(() => {});
    }
  }
}

export const audio = new SoundEngine();
