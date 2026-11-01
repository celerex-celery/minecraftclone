import * as THREE from 'three';
import { CONFIG, DEFAULTS, resolveBinds } from './Config.js';

const GRAVITY_DIRECTIONS = [
  { name: 'UP',    pull: new THREE.Vector3(0, 1, 0) },
  { name: 'DOWN',  pull: new THREE.Vector3(0, -1, 0) },
  { name: 'NORTH', pull: new THREE.Vector3(0, 0, 1) },
  { name: 'SOUTH', pull: new THREE.Vector3(0, 0, -1) },
  { name: 'EAST',  pull: new THREE.Vector3(1, 0, 0) },
  { name: 'WEST',  pull: new THREE.Vector3(-1, 0, 0) },
];
import { Blocks, setBlockNameResolver } from '../world/blocks/Blocks.js';
import { Items, setNameResolver } from '../world/blocks/Items.js';
import { TextureAtlas } from '../world/blocks/TextureAtlas.js';
import { ChunkMaterials, createSelectionBox, BreakOverlay, lightColor } from '../world/blocks/Materials.js';
import { ChunkMesher } from '../world/generation/ChunkMesher.js';
import { World } from '../world/environment/World.js';
import { Sky } from '../world/lighting/Sky.js';
import { Particles } from '../world/entities/Particles.js';
import { ItemDrops } from '../world/entities/ItemDrops.js';
import { EntityShadows } from '../world/entities/EntityShadows.js';
import { FallingBlocks } from '../world/blocks/FallingBlocks.js';
import { EnderPearls } from '../world/entities/EnderPearls.js';
import { Spreading } from '../world/blocks/Spreading.js';
import { Mobs } from '../world/entities/Mobs.js';
import { Boats } from '../world/entities/Boat.js';
import { Beds } from '../world/structures/Beds.js';
import { Chests, chestOwner } from '../world/structures/Chests.js';
import { placeBonusChest } from '../world/structures/BonusChest.js';
import { lightPortal, checkPortalNeighbours, findFrame, ignitePortal, findEndPortalFrame, activateEndPortal, playerInPortal, playerInEndPortal, portalNearby, findPortalNear, buildEndExitPortal } from '../world/structures/Portal.js';
import { seedFromString } from '../world/generation/Noise.js';
import { Player } from '../player/Player.js';
import { ViewModel } from '../player/ViewModel.js';
import { PlayerModel } from '../player/PlayerModel.js';
import { Interaction } from '../player/Interaction.js';
import { Inventory } from '../survival/Inventory.js';
import { Survival } from '../survival/Survival.js';
import { tickFurnace, furnaceBlockId, SMELT_TIME } from '../survival/Furnace.js';
import { HUD } from '../ui/HUD.js';
import { Chat } from '../ui/Chat.js';
import { ContainerScreen } from '../ui/ContainerScreen.js';
import { ScreenManager } from '../ui/Screens.js';
import { Advancements } from '../ui/Advancements.js';
import { AdvancementScreen } from '../ui/AdvancementScreen.js';
import { StatisticsScreen } from '../ui/StatisticsScreen.js';
import { StepsScreen } from '../ui/StepsScreen.js';
import { Statistics } from './Statistics.js';
import { PixelFont, COLORS } from '../ui/PixelFont.js';
import { audio } from '../audio/SoundEngine.js';
import { SaveGame } from './SaveGame.js';
import { Input } from './Input.js';
import { PAD } from './Gamepad.js';
import { PadNav } from '../ui/PadNav.js';
import { OnScreenKeyboard } from '../ui/OnScreenKeyboard.js';
import { lang, t } from '../ui/Lang.js';
import { createLogger } from './Logger.js';

const log = createLogger('Game');

function snapToDevicePixels(gui, dpr) {
  if (!(dpr > 0) || !Number.isFinite(dpr) || !(gui > 0)) return gui;

  const wanted = gui * dpr;
  const lo = Math.max(0.5, Math.floor(wanted));
  const hi = Math.ceil(wanted);
  const a = lo / dpr;
  const b = hi / dpr;
  const snapped = Math.abs(a - gui) <= Math.abs(b - gui) ? a : b;

  return Math.abs(snapped - gui) <= 0.5 ? snapped : gui;
}

const STATE = {
  LOADING: 'loading',
  TITLE: 'title',
  PLAYING: 'playing',
  PAUSED: 'paused',
  DEAD: 'dead',
};

function wailaTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return s < 3600 ? s : Math.ceil(s / 60);
}

function crispPixelRatio() {
  return 1;
}

let MAX_ANISOTROPY = 1;

function wait(seconds) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, seconds * 1000)));
}

export class Game {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.assets = assets;
    this.state = STATE.LOADING;
    this.settings = { ...DEFAULTS };

    this._sprintToggled = false;
    this._sneakToggled = false;
    this.audio = audio;
    this.saveGame = SaveGame;
    this.worldId = null;
    this.gameMode = 'survival';
    this.hardcore = false;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,

      sortObjects: true,

      preserveDrawingBuffer: false,
    });

    this._basePixelRatio = crispPixelRatio();
    this.renderer.setPixelRatio(this._basePixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.renderer.autoClear = true;

    this.renderer.localClippingEnabled = false;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xa8c8ee, 60, 140);

    this.scene.frustumCulled = true;
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 1, 0.08, 600);

    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.25);
    this.scene.add(this.ambientLight);

    this.shadows = new EntityShadows(this.scene);

    MAX_ANISOTROPY = this.renderer.capabilities.getMaxAnisotropy();
    this.atlas = new TextureAtlas(
      assets.blockImages, 16, 16, MAX_ANISOTROPY);
    this.liquidTextures = {
      water: makeLiquidFrames(assets.blockImages.water_still),
      lava: makeLiquidFrames(assets.blockImages.lava_still),

      portal: makeSheetTexture(assets.blockImages.nether_portal),
      fire: makeSheetTexture(assets.blockImages.fire),

      seagrass: makeSheetTexture(assets.animatedImages?.seagrass),
    };
    this.materials = new ChunkMaterials(this.atlas.texture, this.liquidTextures);
    this.mesher = new ChunkMesher(this.atlas);

    this.font = new PixelFont(assets.fontSheet);
    this.selection = createSelectionBox();
    this.breakOverlay = new BreakOverlay(assets.destroyStages ?? []);
    this.scene.add(this.selection);
    this.scene.add(this.breakOverlay.mesh);

    this.sky = new Sky(this.scene, assets.clouds);
    this.particles = new Particles(this.scene, this.atlas.texture);
    this.particles.setAtlas(this.atlas);
    this.itemDrops = new ItemDrops(null, this.scene, this.atlas, assets.itemImages, assets.blockImages);
    this._itemDropsByDimension = { overworld: this.itemDrops };

    this.spreading = new Spreading(null);

    this.pearls = new EnderPearls(this.scene, assets.itemImages);

    this._mobsByDimension = {};
    this.mobs = null;

    this._shadowCasters = [];

    this._boatsByDimension = {};
    this.boats = null;

this._bedsByDimension = {};
  this.beds = null;

  this._chestsByDimension = {};
  this.chests = null;
  this._portalVeil = makePortalVeil();

    this.input = new Input(canvas);
    this.input.sensitivity = this.settings.sensitivity;

    this.padNav = new PadNav(this);
    this.onScreenKeyboard = new OnScreenKeyboard(this);
    this.input.onPadChange = (change) => this._onPadChange(change);
    this.hud = new HUD(this);
    this.chat = new Chat(this);
    this.screens = new ScreenManager(this);
    this.advancements = new Advancements(this);
    this.screens.advancements = new AdvancementScreen(this);
    this.statistics = new Statistics(this);
    this.screens.statistics = new StatisticsScreen(this);
    this.screens.steps = new StepsScreen(this);

    this.inventory = new Inventory();
    this.craftGrid = [];

    this.world = null;

    this.worlds = {};
    this.dimension = 'overworld';

    this._positions = {};
    this._transition = 0;
    this._portalDelay = 0;
    this.player = null;
    this.survival = null;
    this.interaction = null;
    this.viewModel = new ViewModel(this.atlas, assets.itemImages, assets.blockImages);
    this.viewModel.setAspect(1);

    this.playerModel = new PlayerModel(this.scene, this.atlas, assets.itemImages, assets.blockImages);

    this.screen = null;
    this.target = null;

    this.fps = 0;
    this._frames = 0;
    this._fpsTimer = 0;
    this.elapsed = 0;
    this.drawCalls = 0;
    this.triangles = 0;
    this.chunkStats = { rendered: 0, total: 0, pending: 0 };
    this.thirdPerson = 0;

    this._bobRight = new THREE.Vector3();
    this._bobUp = new THREE.Vector3();

    this._fovEased = undefined;
    this._itemDropCount = 0;
    this._basePixelRatio = 1;

    this._renderDistanceFloor = 4;
    this._renderDistanceCeiling = CONFIG.RENDER_DISTANCE;
    this._fpsLowStreak = 0;
    this._fpsHighStreak = 0;
    this._lastRenderDistanceChange = 0;

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();

    this._bindGlobalKeys();
    this._bindCanvas();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this._basePixelRatio = crispPixelRatio();

    this.renderer.setPixelRatio(this._basePixelRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewModel.setAspect(w / h);
  }

  _bindCanvas() {
    this.canvas.addEventListener('mousedown', () => {
      audio.init();

      if (this.state === STATE.PLAYING && !this.screen && !this.chat.isOpen) this.input.requestLock();
    });
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === STATE.PLAYING) this.pause();
    };
  }

  _bindGlobalKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3' || e.code === 'F5' || e.code === 'F2') e.preventDefault();
    });

    window.addEventListener('pagehide', () => this.save(true));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.save(true);
    });
  }

  async initLanguage() {

    setBlockNameResolver((name, kind, fallback) => lang.displayName(name, kind, fallback));
    setNameResolver((name, kind, fallback) => lang.displayName(name, kind, fallback));

    await lang.load(this.settings.language ?? 'en_us');
    lang.onChange(() => {
      this.refreshTranslations();
    });
    this.refreshTranslations();
  }

     refreshTranslations() {
    const font = this.font;

    lang.applyToDom((el, text) => {
      if (el.dataset.i18nPh !== undefined) {
        el.placeholder = text;
        return;
      }
      if (el.classList.contains('mc-heading')) {

        const scale = el.id === 'death-title' ? 5
          : (Number(el.dataset.scale) || 3);
        font.set(el, text, {
          scale,
          color: el.id === 'death-title' ? COLORS.red : COLORS.white,
        });
        return;
      }
      el.textContent = text;
    });
    for (const el of document.querySelectorAll('[data-i18n-ph]')) {
      el.placeholder = t(el.getAttribute('data-i18n-ph'));
    }

    this.screens?.title?.onLanguageChanged();
    this.screens?.languages?.refresh();
    this.screens?.pause?.show();

    if (this.screens?.options?.isOpen) this.screens.options.show();
    if (this.screen) { this.screen._build(); this.screen.refresh(); }
    this.hud._invVersion = -1;
  }

  async loadSettings() {
    let stored = null;
    try {
      stored = await this.saveGame.getSettings();
    } catch (err) {
      log.warn('could not read saved settings, using defaults', err);
    }
    if (stored && typeof stored === 'object') {
      for (const [key, value] of Object.entries(stored)) {
        if (key in this.settings) this.settings[key] = value;
      }
    }
    this.settings.keybinds = resolveBinds(this.settings.keybinds);
    this.input.setBinds(this.settings.keybinds);
    return this.settings;
  }

  applySettings() {
    const s = this.settings;
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();

    this._fovEased = undefined;
    this.input.sensitivity = s.sensitivity;
    this.input.setBinds(s.keybinds);
    audio.setVolume(s.volume);
    audio.setMusicVolume(s.musicVolume ?? 0.5);
    audio.setMuted(!!s.muted);
    audio.setMusicEnabled(s.musicEnabled ?? true);
    audio.musicToasts = s.musicToasts ?? true;

    CONFIG.AMBIENT_CAVE.ENABLED = !!s.caveAmbience;
    this.sky.setCloudHeight(s.cloudHeight ?? 192);
    const cloudsOn = s.clouds !== false;
    if (this.sky.cloudLayers) {
      for (const layer of this.sky.cloudLayers) layer.visible = cloudsOn;
    } else if (this.sky.clouds) {
      this.sky.clouds.visible = cloudsOn;
    }
    if (this.world) {

      this._renderDistanceCeiling = s.renderDistance;
      this.applyRenderDistance(s.renderDistance);
    }
    this.updateCameraRanges();
    this.queueSettingsSave();
  }

  queueSettingsSave() {
    clearTimeout(this._settingsTimer);
    this._settingsTimer = setTimeout(() => {
      this.saveGame.putSettings(this.settings).catch((err) => {
        console.warn('could not save settings', err);
      });
    }, 400);
  }

  updateCameraRanges() {
    const far = this.settings.renderDistance * CONFIG.CHUNK_SIZE + 60;
    this.camera.far = far;
    this.camera.updateProjectionMatrix();
    this.sky.setRadius(far);

    if (this.world) {
      const range = this.sky.fogRange(this.settings.renderDistance);
      this.world.scene.fog.near = range.near;
      this.world.scene.fog.far = range.far;
    }
  }

  applyRenderDistance(distance) {
    distance = Math.max(this._renderDistanceFloor, Math.min(this._renderDistanceCeiling, distance));
    if (distance === this.settings.renderDistance) return;
    this.settings.renderDistance = distance;
    if (this.world && this.world.renderDistance !== distance) {
      this.world.renderDistance = distance;
      this.world.invalidate();
    }
    for (const w of Object.values(this.worlds)) {
      if (w === this.world) continue;
      if (w.renderDistance !== distance) {
        w.renderDistance = distance;
        w.invalidate();
      }
    }
    this.updateCameraRanges();
  }

  async createWorldRecord(opts) {
    const id = `w${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
    const record = {
      id,
      name: opts.name || t('menu.newWorld'),
      seed: opts.seed,
      seedText: opts.seedText || '',
      gameMode: opts.gameMode ?? 'survival',
      worldType: opts.worldType ?? 'default',
      islandBiome: opts.islandBiome ?? null,
      difficulty: opts.difficulty ?? 'normal',
      bonusChest: opts.bonusChest === 'on',
      hardcore: opts.gameMode === 'hardcore',
      created: Date.now(),
      lastPlayed: Date.now(),
      payload: null,
    };
    await this.saveGame.put(record);
    return id;
  }

  async playWorld(id) {
    const { record, damaged, recovered } = await this.saveGame.get(id);
    if (!record) {

      this.hud.toast(t(damaged ? 'menu.worldDamaged' : 'menu.worldMissing'), 'bad');
      return;
    }
    if (recovered) {

      this.hud.toast(t('menu.worldRecovered'), 'bad');
    }
    await this.enterWorld(record);
  }

  async renameWorld(id, name, seedText) {
    const { record } = await this.saveGame.get(id);
    if (!record) return;
    if (name) record.name = name;
    if (seedText !== undefined && seedText !== record.seedText) {
      record.seedText = seedText;
      if (seedText) record.seed = seedFromString(seedText);
    }
    await this.saveGame.put(record);
  }

  async deleteWorld(id) {
    await this.saveGame.remove(id);
  }

  async enterWorld(record) {
    log.info('Loading world "%s" (%s, %s)', record.name, record.gameMode, record.worldType);
    this.screens.loading.show();
    this.screens.loading.setProgress(0);
    this.screens.loading.setStatus(t('menu.loadingWorld'));
    await this.createWorld({
      seed: record.seed,
      saveData: record.payload,
      name: record.name,
      gameMode: record.gameMode ?? 'survival',
      worldType: record.worldType ?? 'default',
      islandBiome: record.islandBiome ?? null,
      difficulty: record.difficulty ?? 'normal',
      bonusChest: record.bonusChest,
      hardcore: record.hardcore,
      worldId: record.id,
    });

    this.save(true);
    this.state = STATE.PLAYING;
    this.screens.title.hide();
    this.screens.options.hide();
    this.screens.worlds.hide();
    this.hud.show();
    audio.init();
    audio.resume();
    this.playWorldMusic();
    this.input.requestLock();
    this.hud.toast(record.name, 'info');
  }

  async startWorld(seedText) {
    log.info('Starting a new world');
    await this.createWorld({ seed: seedFromString(seedText) });
    this.state = STATE.PLAYING;
    this.screens.title.hide();
    this.hud.show();
    audio.init();
    audio.resume();
    this.playWorldMusic();
    this.input.requestLock();
  }

  continueWorld() {
    this.saveGame.list().then((worlds) => {
      if (worlds.length) this.playWorld(worlds[0].id);
      else this.startWorld(null);
    });
  }

  async createWorld(opts = {}) {
    const {
      seed = seedFromString(null),
      saveData = null,
      gameMode = 'survival',
      worldType = 'default',
      islandBiome = null,
      difficulty = 'normal',
      worldId = null,
      bonusChest = false,
      hardcore = false,
    } = opts;

    this.bonusChest = bonusChest;
    this.hardcore = hardcore;
    this.screens.loading.show();
    this.screens.loading.setProgress(0);
    this.screens.loading.setStatus(t('menu.buildingWorld'));
    await this._finishCreateWorld(opts);
  }

  async _finishCreateWorld(opts = {}) {
    const {
      seed = seedFromString(null),
      saveData = null,
      gameMode = 'survival',
      worldType = 'default',
      islandBiome = null,
      difficulty = 'normal',
      worldId = null,
      hardcore = false,
    } = opts;

    this.teardownWorld();
    this.worldId = worldId;
    this.gameMode = gameMode;
    this.hardcore = hardcore;

    this._seed = seed >>> 0;
    this._worldType = worldType;
    this._islandBiome = islandBiome;
    this._gravityDir = 'DOWN';
    this._gravityTimer = 0;
    this.worlds = {};
    this._positions = {};
    this.dimension = 'overworld';
    this._transition = 0;
    this._portalDelay = 0;

    this._activateWorld(this._createDimensionWorld('overworld', this._islandBiome), seed, worldType);
    this.updateCameraRanges();
    log.info('World ready (seed %d, %s%s)', this._seed, worldType, saveData ? ', resumed from save' : ', new');

    this.screens.loading.setProgress(0.5);
    this.screens.loading.setStatus(t('menu.generatingChunks'));

    this.player = new Player(this.world);
    this.player.inventory = this.inventory;
    this.player.creative = gameMode === 'creative';

    this.player.spectator = gameMode === 'spectator';

    if (hardcore) {
      this.player.creative = false;
      this.player.spectator = false;
    }

    this.player.flying = false;
    this.survival = new Survival(this.world, this.player);
    this.survival.difficulty = difficulty;
    if (hardcore) {
      this.survival.maxHealth = 2;
      this.survival.hardcore = true;
    }

    this.survival.creative = this.player.creative || this.player.spectator;
    this.interaction = new Interaction(this);
    this._wasUnderwater = null;
    this._wasBuried = null;

    this.survival.toastHandlers.push((msg, kind) => this.hud.toast(msg, kind));
    this.survival.deathHandlers.push((cause) => this.onDeath(cause));
    this.advancements.spawnAt(this.player.position);

    this.inventory.onBreak = (name) => this.statistics.recordItemBroken(name);
    this.inventory.onUse = (name, n) => this.statistics.recordItemUsed(name, n);

    this.survival.hurtHandlers.push((cause, amount) => {
      this.advancements.recordHurt();
      if (cause === 'fall') {
        if (amount >= 3) audio.fall();
        else audio.fallSmall();
      } else if (cause === 'drown') {
        audio.bubble();
      } else {
        audio.hurt();
      }
    });

    this._lastLevel = 0;

    if (saveData) {
      this._restoreDimensions(saveData);
    } else {

      this.advancements.restore(null);
      this.statistics.reset();
      this.player.position.copy(this.world.findSpawn());

      if (gameMode === 'survival') this.startEmpty();
    }

    this.world.buildAreaNow(this.player.position.x, this.player.position.z);

    this.world.settleSpawn(this.player.position);
    this.player.velocity.set(0, 0, 0);
    this.player.fallDistance = 0;

    this.screens.loading.setProgress(0.9);
    this.screens.loading.setStatus(t('menu.finishingUp'));

    if (this.bonusChest && !saveData) {
      console.log('[BonusChest] Conditions met - placing chest');
      const spawnPos = this.world.findSpawn();
      console.log('[BonusChest] Spawn pos:', spawnPos);
      await placeBonusChest(this.world, spawnPos.x, spawnPos.y, spawnPos.z);
    } else {
      console.log('[BonusChest] Skipped:', { bonusChest: this.bonusChest, gameMode, saveData: !!saveData });
    }

    this.statistics.beginSession();

    if (this._worldType === 'cursed') {
      this.hud.toast(`GRAVITY: ${this._gravityDir}`, 'warn');
    }

    this.screens.loading.hide();
  }

  _createDimensionWorld(dimension, islandBiome = null) {
    const world = new World(
      this._seed ?? seedFromString(null), this.scene, this.atlas, this.materials,
      this.mesher, this._worldType ?? 'default', dimension, islandBiome,
    );

    world.falling = new FallingBlocks(this.scene, {
      atlas: this.atlas,
      material: this.materials.opaque,
      dimension,
    });
    world.renderDistance = this.settings.renderDistance;

    this._itemDropsByDimension[dimension] ??= new ItemDrops(
      world, this.scene, this.atlas, this.assets.itemImages, this.assets.blockImages,
    );
    this._itemDropsByDimension[dimension].world = world;

    this.worlds[dimension] = world;
    return world;
  }

  dismountBoat() {
    this.player?.riding?.dismount(this.world);
  }

  canSleep() {
    const time = this.world?.time ?? 0;
    if (time >= 13000 || time < 1000) return true;

    return (this.weather?.rainAmount ?? 0) > 0;
  }

  sleepInBed(x, y, z) {
    if (this._sleeping) return false;
    if (this.player?.spectator || this.player?.creative) return false;

    if (!this.canSleep()) return false;
    this._sleeping = { time: 0, foot: [x, y, z] };
    this.sleepOverlay = this.sleepOverlay ?? document.getElementById('sleep-overlay');
    audio.setAmbience('none');
    return true;
  }

  _updateSleep(dt) {
    const s = this._sleeping;
    if (!s) return;
    const el = this.sleepOverlay ?? document.getElementById('sleep-overlay');
    if (!el) { this._sleeping = null; return; }
    s.time += dt;

    const HALF = 0.5;
    if (s.time < HALF) {
      el.style.opacity = String(Math.min(1, s.time / HALF));
      return;
    }
    if (!s.done) {
      s.done = true;
      el.style.opacity = '1';
      const [x, y, z] = s.foot;

      this.world.spawnPoint = new THREE.Vector3(x + 0.5, y + 1, z + 0.5);

      this.world.setTime(1000);
      this.player.velocity.set(0, 0, 0);
      this.player.fallDistance = 0;
    }
    const back = (s.time - HALF) / HALF;
    if (back >= 1) {
      el.style.opacity = '0';
      this._sleeping = null;
    } else {
      el.style.opacity = String(1 - back);
    }
  }

  get sleeping() {
    return !!this._sleeping;
  }

  _activateWorld(world) {
    this.world = world;    this.dimension = world.dimension;
    this.itemDrops = this._itemDropsByDimension[world.dimension] ?? this.itemDrops;
    this.itemDrops.world = world;

    this.spreading.world = world;
    this.spreading.clear();

    world.onBlockBroken = (x, y, z, id) => {
      this.interaction?.dropBrokenBlock(x, y, z, id);
    };

    this._mobsByDimension[world.dimension] ??= new Mobs(this.scene, world, this);
    this.mobs = this._mobsByDimension[world.dimension];
    this.mobs.world = world;
    this._boatsByDimension[world.dimension] ??= new Boats(this.scene, world);
    this.boats = this._boatsByDimension[world.dimension];
    this.boats.world = world;

    this.boats.splash = (x, y, z, power) => this.particles?.spawnSplash(x, y, z, power);

    this._bedsByDimension[world.dimension] ??= new Beds(this.scene, world);
    this.beds = this._bedsByDimension[world.dimension];
    this.beds.world = world;
    this._chestsByDimension[world.dimension] ??= new Chests(this.scene, world);
    this.chests = this._chestsByDimension[world.dimension];
    this.chests.world = world;
    if (this.player) this.player.world = world;
    if (this.survival) this.survival.world = world;
    this.sky.setDimension(world.dimension, this._worldType);
    this._wasUnderwater = null;
    this._wasBuried = null;

    for (const w of Object.values(this.worlds)) {
      if (w !== world) w.hide();
    }

    for (const dimension of Object.keys(this.worlds)) {
      const on = dimension === world.dimension;
      for (const m of this._dimensionManagers(dimension)) m.setVisible(on);
    }
    world.invalidate();
  }

  _dimensionManagers(dimension) {
    return [
      this._mobsByDimension[dimension],
      this._itemDropsByDimension[dimension],
      this._boatsByDimension[dimension],
      this._bedsByDimension[dimension],
      this._chestsByDimension[dimension],
      this.worlds[dimension]?.falling,
    ].filter(Boolean).concat(this.worlds[dimension]?.weather ?? []);
  }

  _rememberPosition(dimension, position) {
    this._positions[dimension] = {
      position: [position.x, position.y, position.z],
      yaw: this.player.yaw,
      pitch: this.player.pitch,
      flying: this.player.flying,
    };
  }

  async travelTo(dimension) {
    if (this._transition > 0 || !this.player || this.world.dimension === dimension) return;
    const P = CONFIG.PORTAL;
    const from = this.dimension;

    this.dismountBoat();
    this._rememberPosition(from, this.player.position);
    this._transition = P.TRANSITION_SECONDS;

    this.screens.loading.show();
    this.screens.loading.setProgress(0);
    this.screens.loading.setStatus(t('menu.traveling'));

    this._setVeil(0.9);
    await wait(P.TRANSITION_SECONDS * 0.5);

    const leaving = this.world;
    let target = this.worlds[dimension];
    if (!target) {
      target = this._createDimensionWorld(dimension);
      this._restoreWorldSave(dimension, this._pendingSave?.[dimension]);
    }
    this._activateWorld(target);

    const fromNether = from === 'nether';
    const toNether = dimension === 'nether';
    const toEnd = dimension === 'end';
    const fromEnd = from === 'end';

    let spot;
    let freshArrival = false;
    let remembered = this._positions[dimension];

    if (toEnd) {

      const spawnY = target.gen?.portalBaseY ?? 50;
      spot = { x: 0, y: spawnY, z: 0 };
      freshArrival = !target.spawnPoint;
      if (freshArrival) {
        buildEndExitPortal(target);
        target.spawnPoint = new THREE.Vector3(0.5, spawnY + 1, 0.5);
      }
    } else if (fromEnd) {

      const remembered = this._positions['overworld'];
      if (remembered) {
        spot = { x: remembered.position[0], y: remembered.position[1], z: remembered.position[2] };
      } else {

        spot = { x: 0, y: target.gen.heightAt(0, 0) + 1, z: 0 };
      }
      freshArrival = false;
    } else {

      const scale = fromNether ? P.COORD_SCALE : 1 / P.COORD_SCALE;
      const hScale = fromNether ? P.HEIGHT_SCALE : 1 / P.HEIGHT_SCALE;
      const mapped = {
        x: Math.floor(this.player.position.x * scale),
        y: Math.floor(this.player.position.y * hScale),
        z: Math.floor(this.player.position.z * scale),
      };
      mapped.y = Math.max(target.constants.MIN_Y + 2, Math.min(target.constants.MAX_Y - 4, mapped.y));

      const wanted = remembered?.position
        ? { x: remembered.position[0], y: remembered.position[1], z: remembered.position[2] }
        : mapped;

      spot = findPortalNear(target, wanted.x, wanted.y, wanted.z);

      if (!spot) {
        freshArrival = true;
        const base = findArrivalBase(target, mapped.x, mapped.y, mapped.z);
        if (dimension === 'nether') {

          spot = { x: base.x, y: base.y + 1, z: base.z };
          buildReturnPortal(
            target,
            spot.x + 0.5, spot.y, spot.z + 0.5,
            this.player.yaw,
          );
        } else {
          const made = buildArrivalPortal(target, base.x, base.y, base.z);
          spot = { x: Math.floor(made.x), y: Math.floor(made.y), z: Math.floor(made.z) };
        }
        if (!target.spawnPoint) target.spawnPoint = new THREE.Vector3(spot.x, spot.y, spot.z);
      }
      if (!target.spawnPoint) target.spawnPoint = new THREE.Vector3(spot.x, spot.y, spot.z);
    }

    if (remembered && !toEnd && !fromEnd) {
      this.player.position.set(...remembered.position);
      this.player.yaw = remembered.yaw;
      this.player.pitch = remembered.pitch;
      this.player.flying = remembered.flying;
    } else {
      this.player.position.set(spot.x + 0.5, spot.y, spot.z + 0.5);
      if (!freshArrival && !toEnd && !fromEnd) {

        this.player.faceTowards(spot.x + 0.5, spot.z + 0.5);
      }
    }

    this.player.velocity.set(0, 0, 0);
    this.player.fallDistance = 0;
    this.player.clearSprint();
    this.interaction.target = null;
    this.interaction.breakProgress = 0;
    this.interaction.breakTarget = null;
    this.target = null;

    target.buildAreaNow(this.player.position.x, this.player.position.z);
    target.settleSpawn(this.player.position);
    this.player.velocity.set(0, 0, 0);
    this.player.fallDistance = 0;

    this._unstickFromPortal(target);

    leaving.falling?.clear();

    this.pearls.clear();

    audio.portalTravel();

    this._portalDelay = CONFIG.PORTAL.REENTRY_DELAY;

    this.playWorldMusic();
    this.save(true);

    if (fromEnd) {
      await this._showEndScreen();
      this._setVeil(0);

      this._unstickFromPortal(this.world);
    }

    this.screens.loading.hide();
  }

  _unstickFromPortal(world) {

    if (!this.playerInActivePortal() && !this.playerInEndPortal()) return;
    const p = this.player.position;
    const bx = Math.floor(p.x);
    const by = Math.floor(p.y);
    const bz = Math.floor(p.z);
    for (let r = 1; r <= 6; r++) {
      for (let dy = 0; dy <= 1; dy++) {
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const x = bx + dx, y = by + dy, z = bz + dz;
            if (Blocks.get(world.getBlock(x, y, z)).solid) continue;
            if (Blocks.get(world.getBlock(x, y + 1, z)).solid) continue;
            if (!Blocks.get(world.getBlock(x, y - 1, z)).solid) continue;
            p.set(x + 0.5, y, z + 0.5);
            this.player.velocity.set(0, 0, 0);
            return;
          }
        }
      }
    }
  }

  _setVeil(alpha) {
    this._portalVeil.style.opacity = String(alpha);
  }

  async _showEndScreen() {
    const playerName = this.player?.name ?? 'Steve';
    return new Promise((resolve) => {
      this.screens.endScreen.show(playerName, () => {
        this._transition = 0;
        this._setVeil(0);
        resolve();
      });
    });
  }

  playerInActivePortal() {
    if (!this.player || !this.world) return false;
    return playerInPortal(this.world, this.player.position) !== null;
  }

  playerInEndPortal() {
    if (!this.player || !this.world) return false;
    return playerInEndPortal(this.world, this.player.position);
  }

  _restoreDimensions(saveData) {
    const worlds = saveData.worlds ?? { overworld: saveData.world };
    const mobs = saveData.mobs ?? {};
    const itemDrops = saveData.itemDrops ?? {};
    this._pendingSave = worlds;
    this._restoreWorldSave('overworld', worlds.overworld);

    if (mobs.overworld) {
      this._mobsByDimension.overworld ??= new Mobs(this.scene, this.worlds.overworld, this);
      this._mobsByDimension.overworld.deserialize(mobs.overworld);
    }

    if (itemDrops.overworld) {
      this._itemDropsByDimension.overworld ??= new ItemDrops(this.worlds.overworld, this.scene, this.atlas, this.assets.itemImages, this.assets.blockImages);
      this._itemDropsByDimension.overworld.deserialize(itemDrops.overworld);
    }

    const dimension = saveData.dimension === 'nether' ? 'nether' : saveData.dimension === 'end' ? 'end' : 'overworld';
    const positions = saveData.positions ?? {};
    for (const [name, saved] of Object.entries(positions)) {
      this._positions[name] = saved;
    }
    this._pendingSave = null;

    if (dimension === 'nether' && worlds.nether) {
      this._activateWorld(this._createDimensionWorld('nether'));
      this._restoreWorldSave('nether', worlds.nether);

      if (mobs.nether) {
        this._mobsByDimension.nether ??= new Mobs(this.scene, this.worlds.nether, this);
        this._mobsByDimension.nether.deserialize(mobs.nether);
      }

      if (itemDrops.nether) {
        this._itemDropsByDimension.nether ??= new ItemDrops(this.worlds.nether, this.scene, this.atlas, this.assets.itemImages, this.assets.blockImages);
        this._itemDropsByDimension.nether.deserialize(itemDrops.nether);
      }
    } else if (dimension === 'end' && worlds.end) {
      this._activateWorld(this._createDimensionWorld('end'));
      this._restoreWorldSave('end', worlds.end);

      if (mobs.end) {
        this._mobsByDimension.end ??= new Mobs(this.scene, this.worlds.end, this);
        this._mobsByDimension.end.deserialize(mobs.end);
      }

      if (itemDrops.end) {
        this._itemDropsByDimension.end ??= new ItemDrops(this.worlds.end, this.scene, this.atlas, this.assets.itemImages, this.assets.blockImages);
        this._itemDropsByDimension.end.deserialize(itemDrops.end);
      }
    }
    const stored = this._positions[this.dimension];
    if (stored) {
      this.player.position.set(...stored.position);
      this.player.yaw = stored.yaw ?? 0;
      this.player.pitch = stored.pitch ?? 0;
      if (stored.flying) this.player.flying = true;
    } else if (saveData.player?.position) {

      const [x, y, z] = saveData.player.position;
      this.player.position.set(x, y, z);
      this.player.yaw = saveData.player.yaw ?? 0;
      this.player.pitch = saveData.player.pitch ?? 0;
      if (saveData.player.flying) this.player.flying = true;
    } else {
      this.player.position.copy(this.world.findSpawn());
    }
    this.world.time = (saveData.time ?? CONFIG.START_TIME);
    if (saveData.player) {
      this.player.yaw = saveData.player.yaw ?? this.player.yaw;
      this.player.pitch = saveData.player.pitch ?? this.player.pitch;
      this.inventory.fromJSON(saveData.inventory);
    }
    this.advancements.restore(saveData.advancements);
    this.statistics.restore(saveData.statistics);
    this.advancements.spawnAt(this.player.position);
    this.survival.health = saveData.survival?.health ?? CONFIG.MAX_HEALTH;
    this.survival.hunger = saveData.survival?.hunger ?? CONFIG.MAX_HUNGER;
    this.survival.saturation = saveData.survival?.saturation ?? 5;
    this.survival.xp = Math.min(9999, saveData.survival?.xp ?? 0);
    this.survival.level = Math.min(9999, saveData.survival?.level ?? 0);
  }

  _restoreWorldSave(dimension, data) {
    const world = this.worlds[dimension];
    if (!world) return;
    if (!data) {
      world.time = CONFIG.START_TIME;
      return;
    }
    world.loadRestore(data);
    world.time = data.time ?? CONFIG.START_TIME;
  }

  startEmpty() {
    this.inventory.slots.fill(null);
    this.inventory.armour.fill(null);
    this.inventory.selected = 0;
    this.inventory.touch();
  }

  teardownWorld() {
    this.closeScreen();

    this.hud.setSaving(false);
    if (this.worldId) log.info('Unloading world %s', this.worldId);
    this._saveShownAt = undefined;
    for (const drops of Object.values(this._itemDropsByDimension)) drops.clear();
    for (const mobs of Object.values(this._mobsByDimension ?? {})) mobs.clear();
    this._mobsByDimension = {};

    for (const boats of Object.values(this._boatsByDimension ?? {})) boats.clear();
    this._boatsByDimension = {};
    this.boats = null;
    for (const beds of Object.values(this._bedsByDimension ?? {})) beds.clear();
    this._bedsByDimension = {};
    this.beds = null;
    for (const chests of Object.values(this._chestsByDimension ?? {})) chests.clear();
    this._chestsByDimension = {};
    this.chests = null;
    this.pearls?.clear();
    for (const w of Object.values(this.worlds)) w.dispose();
    this.worlds = {};

    audio.setRain(0);
    this._itemDropsByDimension = { overworld: this.itemDrops };
    this._positions = {};
    this.dimension = 'overworld';
    this._setVeil(0);
    this._portalDelay = 0;
    this.world = null;
    this.player = null;
    this.survival = null;
    this.interaction = null;
  }

  quitToTitle() {
    this.save(true);
    this.teardownWorld();
    this.state = STATE.TITLE;
    this.hud.hide();
    this.screens.pause.hide();
    this.screens.death.hide();
    this.screens.options.hide();
    this.screens.languages.hide();
    this.screens.title.show();
    this.input.exitLock();
    audio.setAmbience('none');
    document.getElementById('water-overlay').style.opacity = '0';
    this._wasUnderwater = null;
    this._wasBuried = null;
    audio.playMusic('menu');
    this.hud?.hideMusicToast();
  }

  save(quiet = false) {
    if (!this.world || !this.player) return false;

    if (quiet && !this._isSaveNeeded()) return false;

    this._rememberPosition(this.dimension, this.player.position);

const payload = {
      version: 3,

      dimension: this.dimension,

      worlds: Object.fromEntries(
        Object.entries(this.worlds).map(([name, w]) => [name, w.serialize()]),
      ),

      mobs: Object.fromEntries(
        Object.entries(this._mobsByDimension).map(([name, m]) => [name, m.serialize()]),
      ),

      itemDrops: Object.fromEntries(
        Object.entries(this._itemDropsByDimension).map(([name, d]) => [name, d.serialize()]),
      ),

      positions: { ...this._positions },
      time: this.world.time,
      player: {
        position: this.player.position.toArray(),
        yaw: this.player.yaw,
        pitch: this.player.pitch,
        flying: this.player.flying,
      },
      inventory: this.inventory.toJSON(),
      advancements: this.advancements.toJSON(),
      statistics: this.statistics.toJSON(),
      survival: {
        health: this.survival.health,
        hunger: this.survival.hunger,
        saturation: this.survival.saturation,
        xp: this.survival.xp,
        level: this.survival.level,
      },
    };

    if (!this.worldId) {
      if (!quiet) this.hud.toast(t('hud.saved'), 'good');
      return false;
    }

    if (this._saving) {

      this._saveQueued = !quiet;
      return false;
    }
    this._saving = true;
    this._saveShownAt = performance.now();
    this.hud.setSaving(true);
    this.saveGame.get(this.worldId)
      .then(({ record }) => {
        const next = record ?? { id: this.worldId, created: Date.now() };
        next.payload = payload;
        next.name ??= t('menu.newWorld');
        next.lastPlayed = Date.now();
        return this.saveGame.put(next);
      })
      .then(() => {
        this._markSaved();
        if (!quiet) this.hud.toast(t('hud.saved'), 'good');
      })
      .catch((err) => {
        log.error('save failed', err);

        this.hud.toast(t('hud.saveFailed'), 'bad');
        this._sinceAutosave = 0;
      })
      .finally(() => {
        this._saving = false;

        if (this._saveQueued) {
          this._saveQueued = false;
          this.save(false);
        }
      });
    return true;
  }

  _saveIndicatorDone() {
    if (this._saving) return false;
    if (this._saveShownAt === undefined) return true;
    if (performance.now() - this._saveShownAt < CONFIG.SAVE_INDICATOR_MIN_MS) return false;
    this._saveShownAt = undefined;
    return true;
  }

  pause() {
    if (this.state !== STATE.PLAYING) return;

    this.save(true);
    this.state = STATE.PAUSED;
    this.screens.pause.show();
    this.input.exitLock();
  }

  resume() {
    this.screens.pause.hide();
    this.screens.options.hide();
    this.screens.languages.hide();
    this.state = STATE.PLAYING;
    audio.init();
    this.input.requestLock();
  }

  dropAllOnDeath() {
    const stacks = [];
    for (const s of this.inventory.slots) if (s) stacks.push(s);
    for (const s of this.inventory.armour) if (s) stacks.push(s);

    const p = this.player.position;
    for (let i = 0; i < stacks.length; i++) {

      const ang = i * 2.39996323;

      const r = 0.4 + 0.4 * Math.sqrt(i);
      this.itemDrops.spawn(
        p.x + Math.cos(ang) * r,
        p.y + 0.9,
        p.z + Math.sin(ang) * r,
        stacks[i].name,
        stacks[i].count,
      );
    }

    this.inventory.slots.fill(null);
    this.inventory.armour.fill(null);
    this.inventory.selected = 0;
    this.inventory.touch();
  }

  onDeath(cause) {
    this.state = STATE.DEAD;
    this.statistics.recordDeath();
    this.dismountBoat();
    this.input.exitLock();
    audio.death();
    audio.setAmbience('none');
    document.getElementById('water-overlay').style.opacity = '0';
    this._wasUnderwater = null;
    this._wasBuried = null;

    this.dropAllOnDeath();
    if (this.hardcore) {

      this.screens.death.showHardcore(cause);
    } else {
      this.screens.death.show(cause);
    }
  }

  respawn() {
    this.screens.death.hide();
    this.survival.respawn();
    this.advancements.onRespawn();
    this.player.clearSprint();
    const spawn = this.world.findSpawn();
    this.player.position.copy(spawn);
    this.player.velocity.set(0, 0, 0);
    this.player.fallDistance = 0;

    this.world.settleSpawn(this.player.position);

    this.player.flying = this.player.canFly;
    this._transition = 0;

    this._portalDelay = CONFIG.PORTAL.REENTRY_DELAY;
    this._setVeil(0);
    this.state = STATE.PLAYING;
    this.playWorldMusic();
    this.input.requestLock();
  }

  _onPearlLands(pos) {
    const player = this.player;
    if (!player || player.dead) return;

    const inside = Blocks.get(this.world.getBlock(
      Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z),
    ));
    if (inside.name === 'nether_portal') {
      audio.pearlPop();
      this.travelTo(this.dimension === 'overworld' ? 'nether' : 'overworld');
      return;
    }

    audio.pearlPop();

    let y = pos.y;
    const feet = Math.floor(pos.y);
    if (this.world.isSolid(Math.floor(pos.x), feet, Math.floor(pos.z))) {
      y = feet + 1;
    }
    const from = player.position.clone();
    player.position.set(pos.x, Math.max(this.world.constants.MIN_Y + 1, y), pos.z);
    player.velocity.set(0, 0, 0);
    player.fallDistance = 0;
    this.world.settleSpawn(player.position);

    this.survival.damage(CONFIG.PEARL.DAMAGE, 'ender_pearl', true);
    audio.fallSmall();

    if (player.position.y > from.y) player.fallDistance = 0;
  }

  playWorldMusic() {
    audio.playMusic(this.dimension === 'nether' ? 'nether' : this.dimension === 'end' ? 'end' : 'game');

    this.hud.hideMusicToast();
  }

  showMusicToast() {
    if (!audio.musicToasts) {
      this.hud.hideMusicToast();
      return;
    }
    const name = audio.currentTrackName;
    if (name) this.hud.musicToast(name);
  }

  openScreen(kind, blockPos, chestEntity) {
    this.closeScreen();
    const screen = new ContainerScreen(this, kind, blockPos);
    if (kind === 'furnace' && blockPos) {
      screen.attachFurnace(this.world.getBlockEntity(blockPos.x, blockPos.y, blockPos.z));
    }
    if (kind === 'chest' && chestEntity) {
      screen.attachChest(chestEntity);
    }
    screen.open(blockPos);
    this.screen = screen;
    this.input.exitLock();
  }

  openFurnace(x, y, z) {
    this.openScreen('furnace', { x, y, z });
  }

  openChest(x, y, z) {
    const owner = chestOwner(this.world, x, y, z);
    this.openScreen('chest', { x, y, z }, owner);
    audio.chestOpen();
  }

  markChestDirty() {
    const p = this.screen?.blockPos;
    if (!p) return;
    const c = this.world.chunkAtBlock(p.x, p.z);
    if (c) c.modified = true;
  }

  get playerName() {
    return this.settings.playerName || 'Player';
  }

  setGameMode(mode) {
    this.gameMode = mode;
    const creative = mode === 'creative';
    const spectator = mode === 'spectator';

    if (this.hardcore && creative) return;
    if (this.player) {
      this.player.creative = creative;
      this.player.spectator = spectator;

      this.player.flying = creative || spectator;
      this.player.fallDistance = 0;

      this.player.velocity.set(0, 0, 0);
    }
    if (this.survival) this.survival.creative = creative || spectator;
    if (this.hud) this.hud._applyGameMode();

    if (this.worldId && this.saveGame?.get) {
      this.saveGame.get(this.worldId)
        .then(({ record }) => {
          if (record) this.saveGame.put({ ...record, gameMode: mode });
        })
        .catch(() => {   });
    }
  }

  killPlayer(cause = 'generic') {
    if (!this.survival || this.state !== STATE.PLAYING) return;
    const creative = this.survival.creative;
    this.survival.creative = false;
    this.survival.damage(CONFIG.MAX_HEALTH * 2, cause);
    this.survival.creative = creative;
  }

  closeScreen() {

    if (this.screen?.kind === 'chest') audio.chestClose();
    if (this.screen) {
      this.screen.destroy();
      this.screen = null;
    }
    if (this.state === STATE.PLAYING && this.world) this.input.requestLock();
  }

  emitDigParticles(t) {
    if (t?.hit) this.particles.spawnDig(t.hit, t.id);
  }

  _heldWeapon() {
    const held = this.inventory.held;
    if (!held) return null;
    const def = Items.get(held.name);
    const damage = def?.tool?.damage;

    if (!damage) return null;
    return { damage, type: def.tool.type, wear: () => this.inventory.damageHeld(1) };
  }

  screenshot() {
    this.render();
    const url = this.renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `minecraft-voxel-${Date.now()}.png`;
    a.click();
  }

  async copyCoordinates() {
    const p = this.player?.position;
    if (!p) return;
    const text = `${p.x.toFixed(3)} ${p.y.toFixed(3)} ${p.z.toFixed(3)}`;
    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : null;
    if (!clip?.writeText) {
      this.chat.open(text);
      return;
    }
    try {
      await clip.writeText(text);
      this.hud.toast(t('hud.coordsCopied', text), 'info');
    } catch {
      this.chat.open(text);
    }
  }

  start() {
    this.lastTime = performance.now();
    const loop = (now) => {
      this.raf = requestAnimationFrame(loop);
      let dt = (now - this.lastTime) / 1000;
      this.lastTime = now;
      if (dt > 0.25) dt = 0.25;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  frame(dt) {
    this.elapsed += dt;
    this._frameAvg = this._frameAvg ? this._frameAvg * 0.9 + dt * 0.1 : dt;

    this.input.pollGamepad(dt);

    this._gcTimer = (this._gcTimer ?? 0) + dt;
    if (this._gcTimer >= 60) {
      this._gcTimer = 0;
      if (typeof window !== 'undefined' && window.gc) window.gc();
    }

    this._frames++;
    this._fpsTimer += dt;
    if (this._fpsTimer >= 0.5) {
      this.fps = Math.round(this._frames / this._fpsTimer);
      this._frames = 0;
      this._fpsTimer = 0;

      const now = performance.now();
      if (this.world && now - this._lastRenderDistanceChange > 3000) {
        // render distance is manual only; no adaptive adjustment
      }
    }

    this.handleHotkeys();

    this.padNav.update(dt);

    if (this.state === STATE.PLAYING && this.world) {
      this.updatePlaying(dt);
    } else if (this.state === STATE.PAUSED || this.state === STATE.DEAD) {
      this.updateFrozenCamera();
    }

    this.render();
    this.input.endFrame();
  }

  get chunkBudget() {
    const target = 1 / 60;

    const scale = Math.min(1, target / Math.max(target, this._frameAvg));
    return Math.max(4, Math.min(10, Math.round(10 * scale)));
  }

  handleHotkeys() {
    const input = this.input;

    if (input.isCapturing) return;

    if (this.chat.isOpen) {
      if (input.pressed('pause')) this.chat.close();
      return;
    }

    if (input.pressed('screenshot')) this.screenshot();
    if (input.pressed('debug')) this.hud.toggleDebug();
    if (input.pressed('toggleHud')) this.hud.toggleHud();
    if (input.pressed('perspective')) this.thirdPerson = (this.thirdPerson + 1) % 3;

    if (input.keys.has('F3') && input.justPressed.has('KeyC')) this.copyCoordinates();

    if (input.pressed('pause')) {
      if (this.screens.languages.isOpen) this.screens.languages.hide();
      else if (this.screens.options.isOpen) this.screens.options.hide();
      else if (this.screens.steps?.isOpen) { this.screens.steps.hide(); if (this.state === STATE.PLAYING) this.input.requestLock(); }
      else if (this.screens.advancements?.isOpen) { this.screens.advancements.hide(); this.pause(); }
      else if (this.screens.statistics?.isOpen) { this.screens.statistics.hide(); this.pause(); }
      else if (this.screen) this.closeScreen();
      else if (this.state === STATE.PAUSED) this.resume();
      else if (this.state === STATE.PLAYING) this.pause();
      return;
    }

    if (this.state === STATE.PLAYING && this.screen) {
      const kind = this.screen.kind;
      if (input.pressed('creativeInventory') && kind === 'creative') this.closeScreen();
      else if (input.pressed('inventory') && kind === 'inventory') this.closeScreen();
      return;
    }

    if (this.state !== STATE.PLAYING || this.screen || this.screens.steps?.isOpen) return;

    if (input.pressed('inventory')) this.openScreen('inventory', null);
    if (input.pressed('creativeInventory') && this.gameMode === 'creative') this.openScreen('creative', null);

    if (input.pressed('chat')) this.chat.open('');
    if (input.pressed('command')) this.chat.open('/');

    if (input.pressed('steps')) {
      if (this.screens.steps?.isOpen) {
        this.screens.steps.hide();
        if (this.state === STATE.PLAYING) this.input.requestLock();
      }
      else this.screens.steps?.show();
    }

    if (input.pressed('dropItem')) this.interaction?.dropStack(input.down('sprint'));

    for (let i = 1; i <= 9; i++) {
      if (input.pressed(`hotbar${i}`)) {
        this.inventory.selected = i - 1;
        this.inventory.touch();
      }
    }
    if (input.wheel !== 0) {
      this.inventory.selected = (this.inventory.selected + input.wheel + 9) % 9;
      this.inventory.touch();
    }

    const pad = input.pad;
    if (pad?.connected) {
      let dir = 0;
      if (pad.pressed(PAD.RB)) dir += 1;
      if (pad.pressed(PAD.LB)) dir -= 1;
      if (dir !== 0) {
        this.inventory.selected = (this.inventory.selected + dir + 9) % 9;
        this.inventory.touch();
      }
    }
  }

  _onPadChange(change) {
    if (change === 'found') {
      this.hud.toast(t('hud.padConnected'), 'info');
    } else if (change === 'lost') {
      this.input.exitLock();
      this.hud.toast(t('hud.padLost'), 'info');
    }
  }

  updateFrozenCamera() {

    if (!this.world) {
      this.renderer.clear();
      return;
    }
    this.updateCamera();
  }

  handleJumpTap() {
    const now = performance.now() / 1000;
    const quick = now - (this._lastJumpTap ?? -10) < CONFIG.DOUBLE_TAP_TIME;
    this._lastJumpTap = now;
    if (quick) this.player?.toggleFlight();
    else if (this.player?.onGround) this.statistics.recordJump();
  }

  updatePlaying(dt) {
    const { player, world, survival, input, inventory } = this;

    const uiOpen = !!this.screen || this.chat.isOpen;

    if (this._transition > 0) {
      this._transition -= dt;
      const half = CONFIG.PORTAL.TRANSITION_SECONDS * 0.5;
      this._setVeil(this._transition > half ? 0.9 : Math.max(0, (0.9 * this._transition) / half));
      if (this._transition <= 0) {
        this._transition = 0;
        this._setVeil(0);
      }
    } else if (!uiOpen) {

      if (this._portalDelay > 0) {
        this._portalDelay = Math.max(0, this._portalDelay - dt);
      } else if (this.dimension === 'overworld' && this.playerInEndPortal()) {

        this.travelTo('end');
      } else if (this.dimension === 'end' && this.playerInEndPortal()) {

        this.travelTo('overworld');
      } else if (this.playerInActivePortal()) {

        this.travelTo(this.dimension === 'overworld' ? 'nether' : 'overworld');
      }
    }

    const padLooking = !!this.input.pad?.connected;
    if (input.locked || padLooking) {

      const sens = this.settings.sensitivity / CONFIG.LOOK_SENSITIVITY_MIDDLE;
      const s = sens * CONFIG.LOOK_DEGREES_PER_COUNT * (Math.PI / 180);
      player.yaw -= input.mouse.dx * s;
      player.pitch -= input.mouse.dy * s;

      const look = input.padLook();
      if (look && !uiOpen) {
        const ps = sens * look.x * (Math.PI / 180) * dt;
        const pt = sens * look.y * (Math.PI / 180) * dt;
        player.yaw -= ps;
        player.pitch -= pt;
      }

      const limit = Math.PI / 2 - 0.001;
      player.pitch = Math.max(-limit, Math.min(limit, player.pitch));
    }

    const jumpPressed = !uiOpen && input.pressed('jump');
    if (uiOpen) this._lastJumpTap = -10;
    else if (jumpPressed) this.handleJumpTap();

    const f = (input.down('forward') ? 1 : 0) - (input.down('back') ? 1 : 0);
    const r = (input.down('right') ? 1 : 0) - (input.down('left') ? 1 : 0);

    const toggleSprint = this.settings.toggleSprint !== false;
    const toggleSneak = this.settings.toggleSneak !== false;

    if (toggleSprint) {
      if (!uiOpen && input.pressed('sprint')) this._sprintToggled = !this._sprintToggled;
    } else {
      this._sprintToggled = false;
    }

    if (toggleSneak) {

      if (uiOpen) this._sneakToggled = false;
      else if (input.pressed('sneak')) this._sneakToggled = !this._sneakToggled;
    } else {
      this._sneakToggled = false;
    }

    const intent = {
      forward: uiOpen ? 0 : f,
      right: uiOpen ? 0 : r,

      jump: !uiOpen && input.down('jump'),
      sneak: !uiOpen && (toggleSneak ? this._sneakToggled : input.down('sneak')),

      sprint: !uiOpen && (toggleSprint
        ? (this._sprintToggled || this.input.padSprinting)
        : (input.down('sprint') || this.input.padSprinting)),

      sprintToggle: toggleSprint,
    };

    const wasInWater = player.inWater;

    player.update(dt, intent);
    if (player.inWater !== wasInWater) {
      if (player.inWater) audio.splash();
    }

    if (this._worldType === 'cursed') {
      this._gravityTimer += dt;
      const threshold = this._gravityDir === 'UP' ? 10 : 30;
      if (this._gravityTimer >= threshold) {
        this._gravityTimer = 0;
        const dirs = GRAVITY_DIRECTIONS;
        let next;
        if (this._gravityDir === 'DOWN') {
          const random = dirs.filter(d => d.name !== 'DOWN');
          next = random[Math.floor(Math.random() * random.length)].name;
        } else {
          next = dirs[Math.floor(Math.random() * dirs.length)].name;
        }
        this._gravityDir = next;
        this.hud.toast(`GRAVITY: ${this._gravityDir}`, 'warn');
      }
      const pull = GRAVITY_DIRECTIONS.find(d => d.name === this._gravityDir)?.pull;
      if (pull && this._gravityDir !== 'DOWN' && !player.flying && !player.spectator) {
        const strength = 500;
        player.velocity.x += pull.x * strength * dt;
        player.velocity.y += pull.y * strength * dt;
        player.velocity.z += pull.z * strength * dt;
      }
    }

    if (this._worldType === 'cursed' && player.position.y > 188 && !player.creative && !player.spectator) {
      this.survival.damage(2, 'generic');
    }

    const attacking = input.pressed('attack') && !uiOpen;
    this.boats?.update(dt, player, intent, {
      attacking,
      drop: (item, count, pos) => this.itemDrops.spawn(pos.x, pos.y, pos.z, item, count, null),
    });

    this.beds?.update();

    this.chests?.update(
      dt,
      this.screen?.kind === 'chest' ? this.screen.blockPos : null,
    );
    this._updateSleep(dt);

    if (player.onGround && !player.riding) {
      const speed = Math.hypot(player.velocity.x, player.velocity.z);
      if (speed > 0.6) {
        const below = Blocks.get(world.getBlock(
          Math.floor(player.position.x), Math.floor(player.position.y - 0.2), Math.floor(player.position.z),
        ));
        audio.step(below, player.sneaking ? 0.15 : 0.3);

        survival.addExhaustion((speed > 4.6 ? 0.5 : 0.06) * dt);
      }
    }
    if (player.jumpEvent) {
      player.jumpEvent = false;
      survival.addExhaustion(player.sprinting ? 0.2 : 0.05);
    }

    {
      this.interaction.updateTarget();
      this.target = this.interaction.target;
      this.interaction.tick(dt);

      const screenOpen = uiOpen;
      this.interaction.tickMining(dt, input.down('attack') && !screenOpen);
      this.interaction.tickEating(dt, input.down('useItem') && !screenOpen);

      if (input.pressed('useItem') && !screenOpen) {
        if (!this.interaction.tryOpenBlock()) this.interaction.useItem();
      }
      if (input.pressed('pickBlock') && !screenOpen) this.interaction.pickBlock();
    }

    if (attacking && !this.interaction.mining && !player.spectator) {
      this.viewModel.triggerSwing(this._heldWeapon()?.type ?? null);
    }

    const weapon = this._heldWeapon();
    this.mobs?.update(dt, player, attacking, (item, count, pos) => {
      this.itemDrops.spawn(pos.x, pos.y, pos.z, item, count, null);
    }, () => this.viewModel.triggerSwing(weapon?.type ?? null), weapon);

    survival.update(dt);
    if (survival.level !== this._lastLevel) {
      if (survival.level > this._lastLevel) audio.levelUp();
      this._lastLevel = survival.level;
    }

    this.tickFurnaces(dt);

    if (this.state === STATE.PLAYING) {
      this.spreading.update(dt, Math.floor(world.time), player.position);
    }

    world.updateTime(dt);
    world.update(player.position.x, player.position.z, this.chunkBudget, dt);
    world.applyPendingEntities();

    audio.setRain(world.weather?.rainAmount ?? 0);
    if (this.hud.debugVisible) this.updateChunkStats();
    this._itemDropCount = this.itemDrops.count;

    const held = player.riding ? null : inventory.held;

    this._heldLight = this._heldLight ?? new THREE.Color(1, 1, 1);
    {
      const eye = player.eyePosition;
      const l = world.getLight(
        Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z),
      );
      lightColor(l >> 4, l & 15, this._heldLight);
    }
    this.viewModel.setItem(held ? held.name : null);

    this.playerModel.setHeldItem(held ? held.name : null);
    this.viewModel.update(dt, {
      bob: this.settings.viewBobbing ? player.bobAmount : 0,
      phase: player.bobPhase,

      sneaking: player.crouching,
      mining: this.interaction.mining,
      sprinting: player.sprinting,
      flying: player.flying,
      fallDistance: player.fallDistance,
      light: this._heldLight,
    });

    this.playerModel.update(dt, player, {
      playing: this.state === STATE.PLAYING,
      thirdPerson: this.thirdPerson,
      swing: this.viewModel.swinging ? this.viewModel.swing : 0,
      dayLight: this.sky?.dayLight ?? 1,

      light: this._heldLight,
    });

    this.viewModel.setArm(player.riding ? null : this.playerModel.firstPersonArm());

    this.updateCamera(dt);
    this.particles.update(dt, world);
    this.pearls.update(dt, world, player, (pos) => this._onPearlLands(pos));
    this.itemDrops.update(
      dt,
      player,
      (name, count) => this.inventory.add(name, count),
          (name, count) => {
            audio.pickup();
          },
          () => audio.bubble(),
        );

    this._shadowCasters.length = 0;
    const mobs = this.mobs?.list;
    if (mobs) {
      for (const mob of mobs) {
        const p = mob.pos;
        if (!p) continue;
        this._shadowCasters.push({
          x: p.x, y: p.y, z: p.z,
          width: (mob.variant?.width ?? 0.6) * 1.6,
        });
      }
    }
    for (const it of this.itemDrops.items) {
      if (it.dead) continue;
      this._shadowCasters.push({
        x: it.pos.x, y: it.pos.y + it.lift, z: it.pos.z,
        width: 0.35,
      });
    }
    this.shadows.update(this._shadowCasters, this.camera.position, world);

    const under = player.headInWater;
    const px = Math.floor(player.position.x);
    const py = Math.floor(player.position.y);
    const pz = Math.floor(player.position.z);

    const skyLight = world.getSky(px, py, pz);
    const buried = world.hasSky && !under && skyLight <= 4;

    this._portalNearAt = (this._portalNearAt ?? 0) - dt;
    if (this._portalNearAt <= 0) {
      this._portalNearAt = 0.2;
      this._nearPortal = portalNearby(world, player.position, CONFIG.PORTAL.HUM_RANGE);
    }

    const ambience = under ? 'underwater' : this._nearPortal ? 'portal' : buried ? 'cave' : 'none';

    if (ambience !== this._ambience) {
      this._ambience = ambience;
      audio.setAmbience(ambience);
    }
    audio.update(dt, { underwater: under });

    const flash = Math.min(0.9, survival.hurtFlash);
    if (Math.abs(flash - (this._lastFlash ?? -1)) > 0.02) {
      this._lastFlash = flash;
      document.getElementById('damage-flash').style.opacity = String(flash);
    }

    this.hud.update(dt);
    this.screens?.steps?.update(dt);
    this.showMusicToast();

    if (!this._saving && this._saveShownAt !== undefined && this._saveIndicatorDone()) {
      this.hud.setSaving(false);
    }
    this.chat.update(dt);
    this.statistics.update(dt, player);
    this.advancements.update(dt);

    this.autosave(dt);

    if (this.screen?.kind === 'furnace') this.screen.refresh();
  }

  _isSaveNeeded() {
    for (const w of Object.values(this.worlds)) {
      if (w.editedSinceSave) return true;

      if (w.fluid.dirtySinceSave) return true;
    }
    if (!this._savedPos) return true;

    if (this._savedPos.distanceToSquared(this.player.position) > 0.0004) return true;
    const s = this.survival;
    const stats = `${s.health}|${s.hunger}|${s.saturation}|${s.xp}|${s.level}|${s.exhaustion}`;
    if (stats !== this._savedStats) return true;
    if (this.inventory.version !== this._savedInventory) return true;
    return false;
  }

  _markSaved() {
    this._savedPos = this.player.position.clone();
    const s = this.survival;
    this._savedStats = `${s.health}|${s.hunger}|${s.saturation}|${s.xp}|${s.level}|${s.exhaustion}`;
    this._savedInventory = this.inventory.version;
  }

  autosave(dt) {
    if (!this.worldId) return;
    this._sinceAutosave = (this._sinceAutosave ?? 0) + dt;
    if (this._sinceAutosave < CONFIG.AUTOSAVE_SECONDS) return;
    this._sinceAutosave = 0;
    this.save(true);
  }

  explode(pos, power) {
    const { world, survival, player, itemDrops, particles, mobs } = this;
    const eye = player ? player.eyePosition : null;

    const destroyed = world.explode(pos.x, pos.y, pos.z, power, (id, bx, by, bz) => {
      const def = Blocks.get(id);
      let drops = def.drops ?? [{ item: def.name }];
      for (const d of drops) {
        if (d.chance !== undefined && Math.random() > d.chance) continue;
        const n = d.min !== undefined || d.max !== undefined
          ? (d.min ?? 0) + Math.floor(Math.random() * ((d.max ?? (d.min ?? 0)) - (d.min ?? 0) + 1))
          : 1;
        if (n > 0) itemDrops.spawn(bx + 0.5, by + 0.4, bz + 0.5, d.item, n, pos);
      }
      if (Math.random() < 0.35) particles.spawnBlockBreak(bx, by, bz, id);
    });

    const R = power * 2;
    if (player) {
      const dist = player.position.distanceTo(pos);
      if (dist < R && dist > 0) {
        survival.damage(Math.max(0, power * (1 - dist / R)) + 1, 'explosion');

        const dir = new THREE.Vector3().subVectors(player.position, pos).normalize();
        const kick = Math.max(0, (1 - dist / R)) * 4;
        player.velocity?.addScaledVector(dir, kick);
        player.position.addScaledVector(dir, kick * 0.15);
      }
    }

    if (mobs) {
      for (const mob of mobs.list) {
        if (mob.dead) continue;
        const dist = mob.pos.distanceTo(pos);
        if (dist >= R || dist === 0) continue;
        const dir = new THREE.Vector3().subVectors(mob.pos, pos).normalize();
        mob.hurt(Math.max(0, power * (1 - dist / R)) + 1, dir, mob.hearingGain(mob.pos, mob.variant.range));
        mob.vel.addScaledVector(dir, Math.max(0, (1 - dist / R)) * 5);
      }
    }

    return destroyed;
  }

  tickFurnaces(dt) {
    const { world } = this;
    const updates = [];
    world.forEachBlockEntity((state, x, y, z) => {
      if (state.type !== 'furnace') return;
      const before = state.burn > 0;
      const ready = state.cook >= SMELT_TIME;
      const { burning } = tickFurnace(state, dt);

      if (ready && state.cook < SMELT_TIME) this.advancements.recordSmelted();
      if (before !== burning) updates.push([x, y, z, burning]);
    });
    for (const [x, y, z, burning] of updates) {
      const want = furnaceBlockId(burning);
      if (world.getBlock(x, y, z) !== want) {
        world.setBlock(x, y, z, want, { light: false });
      }
    }
  }

  updateChunkStats() {
    let rendered = 0;
    for (const c of this.world.chunks.values()) if (c.meshed) rendered++;
    this.chunkStats.rendered = rendered;
    this.chunkStats.total = this.world.chunks.size;
    this.chunkStats.pending = this.world._genQueue.length + this.world._lightQueue.length + this.world._meshQueue.length;
  }

  updateCamera(dt = 1 / 60) {
    const { player, camera } = this;

    const mode = player.riding && this.thirdPerson === 0 ? 1 : this.thirdPerson;

    let bobY = 0;
    let bobX = 0;
    if (this.settings.viewBobbing && mode === 0 && !player.flying && !player.spectator) {
      const amount = player.bobAmount * (player.crouching ? 0.3 : 1);
      const sprintMult = player.sprinting ? 1.3 : 1.0;
      bobY = Math.sin(player.bobPhase * 2) * 0.06 * amount * sprintMult;
      bobX = Math.cos(player.bobPhase) * 0.05 * amount * sprintMult;
    }

    if (mode === 0) {
      const eye = player.eyePosition;
      camera.position.copy(eye);
      camera.rotation.order = 'YXZ';
      camera.rotation.set(player.pitch, player.yaw, 0);
    } else {
      const pos = player.cameraOffset(mode);
      camera.position.copy(pos);
      camera.rotation.order = 'YXZ';

      const pitch = mode === 2 ? 0 : player.pitch;
      camera.rotation.set(pitch, player.yaw + (mode === 2 ? Math.PI : 0), 0);
    }

    if (bobX !== 0 || bobY !== 0) {

      const right = this._bobRight.set(1, 0, 0).applyEuler(camera.rotation);
      const up = this._bobUp.set(0, 1, 0).applyEuler(camera.rotation);
      camera.position.addScaledVector(right, bobX);
      camera.position.addScaledVector(up, bobY);
    }

    const sprinting = mode === 0 && player.sprinting && !player.flying && !player.spectator;
    const want = this.settings.fov * (sprinting ? CONFIG.SPRINT_FOV_SCALE : 1);
    const fov = this._fovEased === undefined ? want : this._fovEased;
    const eased = fov + (want - fov) * (1 - Math.exp(-dt * 12));
    if (Math.abs(eased - camera.fov) > 0.005) {
      camera.fov = eased;
      camera.updateProjectionMatrix();
    }
    this._fovEased = eased;

    const tilt = this.survival?.hurtTilt ?? 0;
    if (tilt > 0.001) {
      const e = tilt * tilt;
      camera.rotation.z = -this.survival.tiltSign * e * 0.28;
      camera.rotation.x -= e * 0.10;
    }

    const shake = this.survival?.hurtShake ?? 0;
    if (shake > 0.001) {
      camera.position.x += (Math.random() - 0.5) * shake * 0.15;
      camera.position.y += (Math.random() - 0.5) * shake * 0.15;
      camera.position.z += (Math.random() - 0.5) * shake * 0.15;
    }
  }

  render() {
    const { sky, world, materials, camera } = this;

    if (world) {

      const wx = world.weather;
      if (wx) {
        sky.overcast = wx.current.overcast;
        sky.dimming = wx.dimming;
      }
      const { dayLight } = sky.update(world.time, camera.position, this.elapsed);

      const player = this.player;
      if (player && world.hasSky) {

        const cam = camera.position;
        const px = Math.floor(cam.x);
        const py = Math.floor(cam.y);
        const pz = Math.floor(cam.z);
        const skyLight = world.getSky(px, py, pz);

        const buried = !player.headInWater && skyLight === 0;
        sky.dome.visible = !buried;
        sky.sun.visible = !buried;
        sky.moon.visible = !buried;
        sky.stars.visible = !buried;
        for (const layer of sky.cloudLayers) layer.visible = !buried;
      }

      const range = sky.fogRange(this.settings.renderDistance);

      const wet = wx ? Math.max(wx.rainAmount, wx.current.snow * 0.4) : 0;
      const reach = 1 - wet * CONFIG.WEATHER.FOG_CUT;
      world.scene.fog.color.copy(sky.fogColor);
      world.scene.fog.near = range.near;
      world.scene.fog.far = range.far * reach;

      if (this.player?.headInWater) {
        world.scene.fog.color.setHex(0x050533);
        world.scene.fog.near = 0;
        world.scene.fog.far = 96;
      }

      sky.setFogRange(range.far, 2048);
      materials.update(
        this.elapsed,

        Math.min(1, dayLight + wx?.lightning * CONFIG.WEATHER.LIGHTNING_FLASH),
        this.settings.brightness,
        this.player?.headInWater ? 1 : 0,

        sky.ambient,
        sky.ambientTint,
      );
    }

    const showTarget = this.state === STATE.PLAYING && !this.screen;
    const mob = showTarget ? this.mobs?.picked : null;
    const block = showTarget ? this.target : null;
    if (mob && (!block || this.mobs.pickedDist <= block.dist)) {
      this.selection.setBoxes([mob.bounds()]);
    } else if (block) {
      this.selection.setBlock(block.x, block.y, block.z, block.id);
    } else {
      this.selection.hide();
    }

    const targetDef = this.target ? Blocks.get(this.target.id) : null;
    const waila = this.settings.waila !== false;
    let wailaData = null;
    let specificHint = null;
    if (this.state === STATE.PLAYING && !this.screen) {

      if (waila) {
        const mob = this.mobs?.picked;
        const cell = this.target;
        if (mob && (!cell || this.mobs.pickedDist <= cell.dist)) {
          const info = [];

          if (mob.grow > 0) info.push(t('hud.waila.growth', wailaTime(mob.grow)));
          if (mob.variant.lays && mob.eggTimer > 0) {
            info.push(t('hud.waila.nextEgg', wailaTime(mob.eggTimer)));
          }
          wailaData = {
            name: mob.variant.label,

            health: mob.health,
            maxHealth: mob.variant.health ?? mob.health,
            info,
          };
        } else if (cell) {
          const def = Blocks.get(cell.id);
          if (def) {
            const info = [];

            const left = this.world?.growth?.progressAt(cell.x, cell.y, cell.z);
            if (left !== null && left !== undefined) {
              info.push(t('hud.waila.growth', wailaTime(left)));
            }
            wailaData = {
              name: Blocks.labelOf(def.name) || def.name || 'Unknown',
              icon: def.name,
              info,

              breaking: this.interaction?.mining ? this.interaction.breakProgress : 0,
            };
          }
        }
      }

      if (targetDef) {
        if (targetDef.interactive === 'bed') {
          if (!this.canSleep() && !this._sleeping) specificHint = t('hud.cannotSleep');
        } else if (this.world?.growth) {
          const state = this.world.growth.stateAt(this.target.x, this.target.y, this.target.z);
          if (state) specificHint = t(`hud.sapling${state === 'growing' ? 'Growing' : 'Waiting'}`);
        }
      }
    }
    this.hud?.waila(wailaData);
    this.hud?.hint(specificHint);

    if (this.interaction?.mining && this.target) {
      this.breakOverlay.show(
        this.target.x, this.target.y, this.target.z,
        Math.min(0.999, this.interaction.breakProgress),
      );
    } else {
      this.breakOverlay.hide();
    }

    if (this.fps < 25 && this._basePixelRatio > 1) {
      const targetRatio = Math.max(1, Math.floor(this._basePixelRatio * 0.75));
      if (targetRatio !== this.renderer.getPixelRatio()) {
        this.renderer.setPixelRatio(targetRatio);
      }
    } else if (this.fps > 40 && this.renderer.getPixelRatio() !== this._basePixelRatio) {
      this.renderer.setPixelRatio(this._basePixelRatio);
    }

    this.renderer.clear(true, true, false);

    if (this.world) {
      if (this._lastFogColor === undefined || !this._lastFogColor.equals(this.world.scene.fog.color)) {
        this._lastFogColor = this.world.scene.fog.color.clone();
      }
      if (this._lastFogNear !== this.world.scene.fog.near || this._lastFogFar !== this.world.scene.fog.far) {
        this._lastFogNear = this.world.scene.fog.near;
        this._lastFogFar = this.world.scene.fog.far;
      }
    }

    this.renderer.info.reset();
    this.renderer.render(this.scene, camera);
    this.drawCalls = this.renderer.info.render.calls;
    this.triangles = this.renderer.info.render.triangles;

    if (this.state === STATE.PLAYING && this.thirdPerson === 0 && !this.player?.spectator) {
      this.viewModel.render(this.renderer);
    }
  }
}

function makeLiquidFrames(img) {
  const frames = [];
  if (!img) return frames;
  const frameSize = 16;
  const count = Math.max(1, Math.floor(img.height / frameSize));
  for (let i = 0; i < count; i++) {
    const canvas = document.createElement('canvas');
    canvas.width = frameSize;
    canvas.height = frameSize;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, i * frameSize, frameSize, frameSize, 0, 0, frameSize, frameSize);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.NearestFilter;

    tex.minFilter = THREE.NearestMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = Math.min(4, MAX_ANISOTROPY);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    frames.push(tex);
  }
  return frames;
}

function makeSheetTexture(img) {
  if (!img) return null;
  const tex = new THREE.Texture(img);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function makePortalVeil() {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:400', 'pointer-events:none',
    'background:#2a0a3a', 'opacity:0', 'transition:none',
  ].join(';');
  document.body.appendChild(el);
  return el;
}

export { STATE };
