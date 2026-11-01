import { CONFIG } from '../core/Config.js';

const BASE = 'assets/sounds/';

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

    chickenIdle: ['mob/chicken/say1', 'mob/chicken/say2', 'mob/chicken/say3'],
    chickenHurt: ['mob/chicken/hurt1', 'mob/chicken/hurt2'],
    chickenStep: ['mob/chicken/step1', 'mob/chicken/step2'],

    chickenEgg: ['mob/chicken/plop'],

    chickIdle: ['mob/chicken/baby_chicken/ambient1', 'mob/chicken/baby_chicken/ambient2'],
    chickHurt: ['mob/chicken/baby_chicken/hurt1', 'mob/chicken/baby_chicken/hurt2',
      'mob/chicken/baby_chicken/hurt3', 'mob/chicken/baby_chicken/hurt4'],
    chickStep: ['mob/chicken/baby_chicken/step'],

    pigIdle: ['mob/pig/say1', 'mob/pig/say2', 'mob/pig/say3'],
    pigHurt: ['mob/pig/say1', 'mob/pig/say2', 'mob/pig/say3'],
    pigStep: ['mob/pig/step1', 'mob/pig/step2', 'mob/pig/step3', 'mob/pig/step4', 'mob/pig/step5'],
    pigEat: ['mob/pig/eat1', 'mob/pig/eat2'],

    babyPigIdle: ['mob/pig/baby_pig/ambient1', 'mob/pig/baby_pig/ambient2', 'mob/pig/baby_pig/ambient3',
      'mob/pig/baby_pig/ambient4', 'mob/pig/baby_pig/ambient5', 'mob/pig/baby_pig/ambient6'],
    babyPigHurt: ['mob/pig/baby_pig/hit1', 'mob/pig/baby_pig/hit2', 'mob/pig/baby_pig/hit3'],
    babyPigStep: ['mob/pig/baby_pig/step1', 'mob/pig/baby_pig/step2', 'mob/pig/baby_pig/step3',
      'mob/pig/baby_pig/step4', 'mob/pig/baby_pig/step5'],

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

    portalTravel: ['block/end_portal/endportal'],
    splash: ['liquid/splash', 'liquid/splash2'],

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

    zombieFire: ['mob/zombie/fire1', 'mob/zombie/fire2'],

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

    rain: ['ambient/weather/rain1', 'ambient/weather/rain2'],

    portal: ['portal/portal'],
  },
};

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

  nether: [CREDIT('music/nether', 'Celerex', 'Lethal Nether Land')],

  end: [CREDIT('music/TheEnd', null, 'The End')],

  endcredits: [CREDIT('music/haggstromcredits', 'C418', 'Haggstrom')],
};

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

    this.musicEnabled = true;

    this.musicToasts = true;
    this.muted = false;

    this.buffers = new Map();
    this.loading = false;

    this.music = new Map();
    this.currentMusic = null;

    this.currentTrackName = null;

    this.onTrackStart = null;
    this.musicTimer = 0;
    this.playlist = [];
    this.playlistIndex = 0;
  }

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

  setMusicEnabled(on) {
    const want = !!on;
    if (want === this.musicEnabled) return;
    this.musicEnabled = want;
    if (!want) this.stopMusic();
    else if (this._musicContext) this.nextTrack();
  }

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

  click() { this.playFrom(MANIFEST.one.click, { volume: 0.5 }); }

  ignite() { this.playFrom(MANIFEST.one.ignite, { volume: 0.55, rate: 0.9 }); }

  pickup() { this.playFrom(MANIFEST.one.pickup, { volume: 0.4, rate: 1.1 }); }
  bonemeal() { this.playFrom(MANIFEST.one.pickup, { volume: 0.5, rate: 1.3 }); }
  hurt() { this.playFrom(MANIFEST.one.hurt, { volume: 0.7 }); }
  fall() { this.playFrom(MANIFEST.one.fall, { volume: 0.7 }); }
  fallSmall() { this.playFrom(MANIFEST.one.fallSmall, { volume: 0.5 }); }

  chickenIdle(gain = 1) { this.playFrom(MANIFEST.one.chickenIdle, { volume: 0.35 * gain }); }
  chickenHurt(gain = 1) { this.playFrom(MANIFEST.one.chickenHurt, { volume: 0.5 * gain }); }
  chickenStep(gain = 1) { this.playFrom(MANIFEST.one.chickenStep, { volume: 0.22 * gain }); }
  chickenEgg(gain = 1) { this.playFrom(MANIFEST.one.chickenEgg, { volume: 0.45 * gain }); }
  chickIdle(gain = 1) { this.playFrom(MANIFEST.one.chickIdle, { volume: 0.35 * gain }); }
  chickHurt(gain = 1) { this.playFrom(MANIFEST.one.chickHurt, { volume: 0.5 * gain }); }

  chickStep(gain = 1) { this.playFrom(MANIFEST.one.chickStep, { volume: 0.3 * gain }); }
  pigIdle(gain = 1) { this.playFrom(MANIFEST.one.pigIdle, { volume: 0.55 * gain }); }
  pigHurt(gain = 1) { this.playFrom(MANIFEST.one.pigHurt, { volume: 0.7 * gain }); }

  pigStep(gain = 1) { this.playFrom(MANIFEST.one.pigStep, { volume: 0.34 * gain }); }
  pigEat(gain = 1) { this.playFrom(MANIFEST.one.pigEat, { volume: 0.7 * gain }); }
  babyPigIdle(gain = 1) { this.playFrom(MANIFEST.one.babyPigIdle, { volume: 0.45 * gain }); }
  babyPigHurt(gain = 1) { this.playFrom(MANIFEST.one.babyPigHurt, { volume: 0.55 * gain }); }

  babyPigStep(gain = 1) { this.playFrom(MANIFEST.one.babyPigStep, { volume: 0.25 * gain }); }

  boatPaddleWater(gain = 1) { this.playFrom(MANIFEST.one.boatPaddleWater, { volume: 0.45 * gain }); }
  boatPaddleLand(gain = 1) { this.playFrom(MANIFEST.one.boatPaddleLand, { volume: 0.4 * gain }); }
  pearlThrow() { this.playFrom(MANIFEST.one.pearlThrow, { volume: 0.6, rate: 1.3 }); }

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
  chestClose() { this.playFrom(MANIFEST.one.chestClose, { volume: 0.6 }); }

    babyPigStep(gain = 1) { this.playFrom(MANIFEST.one.babyPigStep, { volume: 0.25 * gain }); }
    zombieIdle(gain = 1) { this.playFrom(MANIFEST.one.zombieIdle, { volume: 0.35 * gain }); }
    zombieHurt(gain = 1) { this.playFrom(MANIFEST.one.zombieHurt, { volume: 0.5 * gain }); }
    zombieDeath(gain = 1) { this.playFrom(MANIFEST.one.zombieDeath, { volume: 0.5 * gain }); }
    zombieStep(gain = 1) { this.playFrom(MANIFEST.one.zombieStep, { volume: 0.22 * gain }); }

    zombieFire(gain = 1) { this.playFrom(MANIFEST.one.zombieFire, { volume: 0.7 * gain }); }

    endermanIdle(gain = 1) { this.playFrom(MANIFEST.one.endermanIdle, { volume: 0.35 * gain }); }
    endermanHurt(gain = 1) { this.playFrom(MANIFEST.one.endermanHurt, { volume: 0.5 * gain }); }
    endermanDeath(gain = 1) { this.playFrom(MANIFEST.one.endermanDeath, { volume: 0.5 * gain }); }
    endermanStep(gain = 1) { this.playFrom(MANIFEST.one.endermanStep, { volume: 0.22 * gain }); }

    endermanScream(gain = 1) { this.playFrom(MANIFEST.one.endermanScream, { volume: 0.6 * gain }); }

    endermanStare(gain = 1) { this.playFrom(MANIFEST.one.endermanStare, { volume: 0.6 * gain }); }

    endermanTeleport(gain = 1) { this.playFrom(MANIFEST.one.endermanTeleport, { volume: 1.0 * gain }); }

    creeperIdle(gain = 1) { this.playFrom(MANIFEST.one.creeperIdle, { volume: 0.35 * gain }); }
    creeperHurt(gain = 1) { this.playFrom(MANIFEST.one.creeperHurt, { volume: 0.5 * gain }); }
    creeperDeath(gain = 1) { this.playFrom(MANIFEST.one.creeperDeath, { volume: 0.5 * gain }); }
    creeperStep(gain = 1) { this.playFrom(MANIFEST.one.creeperStep, { volume: 0.22 * gain }); }

  portalFail() {
    this.ignite();
  }

  portalIgnite() {
    this.playFrom(MANIFEST.one.click, { volume: 0.5 });
    this.playFrom(MANIFEST.one.pickup, { volume: 0.5, rate: 0.7, rateJitter: 0.05 });
  }

  portalTravel() {
    this.playFrom(MANIFEST.one.portalTravel, { volume: 0.7 });
  }

  death() {
    this.playFrom(MANIFEST.one.fall, { volume: 0.8, rate: 0.7 });
    this.stopMusic();
  }

  setAmbience(which) {
    if (this._ambience === which) return;
    this._ambience = which;

    for (const [name, el] of this.ambienceEls ?? new Map()) {
      if (name === which || el.paused) continue;
      this._fadeOut(el);
    }
    if (which === 'none') return;

    if (which === 'cave' && !CONFIG.AMBIENT_CAVE.ENABLED) {
      this._ambience = 'none';
      return;
    }

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

      el.loop = which !== 'cave';
      el.volume = 0;
      el.preload = 'auto';
      this.ambienceEls.set(which, el);
    }
    if (which === 'cave') {

      this._scheduleCave(el, CONFIG.AMBIENT_CAVE.FIRST_GAP);
      return;
    }
    if (el.paused) {
      el.currentTime = 0;
      el.play().then(() => this._fadeIn(el)).catch(() => {

        this._pendingAmbience = which;
      });
    } else {
      this._fadeIn(el);
    }
  }

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

  setRain(amount) {

    this._rainAmount = amount;
    const vol = Math.max(0, Math.min(1, amount)) * CONFIG.WEATHER.RAIN_VOLUME;

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

        this._rainPending = true;
      });
    }
    this._rampRain(vol);
  }

  _rampRain(target) {
    const gain = this.weatherGain;
    if (!gain) return;
    if (this._rainFade) clearTimeout(this._rainFade);
    const step = () => {
      const now = gain.gain.value;

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

  playMusic(context) {
    if (this._musicContext === context && this.currentMusic && !this.currentMusic.paused) return;
    this._musicContext = context;

    this._pendingMusic = null;

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

    const { path, title, name, author } = track;

    const token = this._musicToken;

    let el = this.music.get(path);
    if (!el) {
      el = new Audio();
      el.src = BASE + path + '.ogg';

      el.loop = this.playlist.length === 1;
      el.preload = 'auto';
      this.music.set(path, el);
    }
    el.currentTime = 0;
    el.volume = this.muted ? 0 : this.musicVolume;
    el.play().then(() => {
      if (this._musicToken !== token) {

        el.pause();
        return;
      }
      this.currentMusic = el;
      this.currentMusicPath = path;

      this.currentTrackName = title;
      this.currentTrackAuthor = author;
      this.onTrackStart?.(title, path);
    }).catch(() => {

      this._pendingMusic = path;
    });
  }

  stopMusic() {
    for (const el of this.music.values()) {
      if (el.paused) continue;
      el.pause();
      el.currentTime = 0;
    }
    this.currentMusic = null;
    this.currentMusicPath = null;
  }

  update(dt, { underwater = false } = {}) {
    if (!this.musicEnabled) return;
    if (this.currentMusic) {
      if (this.currentMusic.ended) this.nextTrack();
      const target = this.muted ? 0 : this.musicVolume * (underwater ? 0.35 : 1);
      this.currentMusic.volume += (target - this.currentMusic.volume) * Math.min(1, dt * 3);
    }
  }

  resume() {
    if (this._rainPending) {
      this._rainPending = false;

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
