/**
 * Game orchestrator.
 *
 * Owns the renderer, the world, the player and every screen, and runs the
 * frame loop: input -> player physics -> interaction -> chunk streaming ->
 * survival -> tile entities -> render.
 */

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
import { Blocks, setBlockNameResolver } from '../world/Blocks.js';
import { Items, setNameResolver } from '../world/Items.js';
import { TextureAtlas } from '../world/TextureAtlas.js';
import { ChunkMaterials, createSelectionBox, BreakOverlay, lightColor } from '../world/Materials.js';
import { ChunkMesher } from '../world/ChunkMesher.js';
import { World } from '../world/World.js';
import { Sky } from '../world/Sky.js';
import { Particles } from '../world/Particles.js';
import { ItemDrops } from '../world/ItemDrops.js';
import { FallingBlocks } from '../world/FallingBlocks.js';
import { EnderPearls } from '../world/EnderPearls.js';
import { Spreading } from '../world/Spreading.js';
import { Mobs } from '../world/Mobs.js';
import { Boats } from '../world/Boat.js';
import { Beds } from '../world/Beds.js';
import { Chests, chestOwner } from '../world/Chests.js';
import {
  findPortalNear, playerInPortal, buildArrivalPortal, findArrivalBase, buildReturnPortal,
  portalNearby, findEndPortalFrame, activateEndPortal, playerInEndPortal, buildEndExitPortal,
} from '../world/Portal.js';
import { seedFromString } from '../world/Noise.js';
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

/**
 * Nudge a GUI scale to the nearest value that fills whole device pixels.
 *
 * The HUD is drawn at its natural pixel size and then scaled by `scale(--gui)`
 * on the way to the screen, so what the compositor gets to do is a rescale from
 * the HUD's pixels to the panel's device pixels. If that ratio is a whole number
 * the rescale is exact and every `image-rendering` setting is moot: the icon is
 * crisp *and* smooth, because nothing had to be interpolated.
 *
 * This matters because a whole `--gui` is not enough on its own. At 125% or
 * 150% Windows scaling - a device ratio of 1.25 or 1.5, which is most desktops -
 * a GUI scale of 2 means 2.5 device pixels per HUD pixel. The compositor has to
 * interpolate a fifth of a pixel either way, and there are only two ways to
 * render that: nearest neighbour, which reads as hard uneven blocks, or
 * smoothing, which reads as blur. Neither is wanted.
 *
 * A *fractional* GUI scale fixes it, because 1.6 at 1.25 is exactly 2 device
 * pixels. So the search is over fractions, not just the whole numbers the
 * options menu offers - close to what was asked for, and the closest value that
 * divides cleanly.
 *
 * @param {number} gui the scale that was asked for
 * @param {number} dpr device pixels per CSS pixel
 * @returns {number} the same scale, or the nearest one that is pixel exact
 */
function snapToDevicePixels(gui, dpr) {
  if (!(dpr > 0) || !Number.isFinite(dpr) || !(gui > 0)) return gui;

  // The whole-pixel scales are exactly the ones of the form k / dpr, so there is
  // no need to search for one: take the k either side of what was asked for and
  // keep whichever lands closest. Both candidates are exact by construction.
  const wanted = gui * dpr;
  const lo = Math.max(0.5, Math.floor(wanted));
  const hi = Math.ceil(wanted);
  const a = lo / dpr;
  const b = hi / dpr;
  const snapped = Math.abs(a - gui) <= Math.abs(b - gui) ? a : b;

  // If moving that far would change the size noticeably, the display ratio is
  // too awkward to be worth it and the original is kept.
  return Math.abs(snapped - gui) <= 0.5 ? snapped : gui;
}

const STATE = {
  LOADING: 'loading',
  TITLE: 'title',
  PLAYING: 'playing',
  PAUSED: 'paused',
  DEAD: 'dead',
};

/**
 * Seconds, the way the crosshair panel counts them down.
 *
 * Rounded up, never down: a countdown that reads "0s" while something is still
 * growing reads as stuck, and 0s is the one value that is definitely wrong. The
 * ceiling also keeps the number from flickering between two values on alternate
 * frames while a tenth of a second is all that separates them, which matters
 * because the panel repaints every frame it is aimed at anything.
 *
 * Minutes past an hour, so a long timer does not turn into five digits.
 *
 * @param {number} seconds
 * @returns {number}
 */
function waliaTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return s < 3600 ? s : Math.ceil(s / 60);
}

/**
 * The device pixel ratio the framebuffer is drawn at.
 *
 * This has to be a WHOLE number, and that is the whole point of the function.
 * The canvas is sized in device pixels but laid out in CSS pixels by
 * `#game-canvas { width: 100%; height: 100% }`, so the browser's compositor is
 * the one that turns the framebuffer into what you actually see. At a whole
 * ratio the drawing buffer maps one-to-one onto device pixels and the
 * compositor has nothing to do.
 *
 * At a fractional ratio it has to rescale, and it rescales with bilinear
 * filtering. Every 16x16 block texture gets a half-pixel of bleed from its
 * neighbours and the whole world comes out subtly soft - the exact look of a
 * screenshot taken through a camera lens, which is not what Minecraft looks
 * like. The 1.25 that used to be hardcoded here did that on every monitor: on a
 * normal 1x display the browser downscaled a 1.25x buffer into a 1x box, and
 * on a 125% or 150% Windows display the mismatch was just as bad.
 *
 * Flooring the device ratio is what fixes it, and it is a straight win rather
 * than a trade: the old fractional value bought supersampling that nothing
 * here could use, because the nearest-neighbour sampling that keeps the blocks
 * crisp is undone again by the rescale afterwards.
 *
 * @returns {number} 1, 2, ... - never 0 and never fractional
 */
function crispPixelRatio() {
  return Math.max(1, Math.floor(window.devicePixelRatio || 1));
}

/**
 * The driver's anisotropy ceiling, read off the renderer once at startup.
 *
 * Module level rather than an instance field because the liquid textures are
 * built by a plain helper rather than a method, and they are constructed during
 * `new Game(...)` before any of them is reachable as `this.something`.
 */
let MAX_ANISOTROPY = 1;

/** Resolves after a delay. The portal transition is the only async path here. */
function wait(seconds) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, seconds * 1000)));
}

export class Game {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.assets = assets;
    this.state = STATE.LOADING;
    this.settings = { ...DEFAULTS };
    this.audio = audio;
    this.saveGame = SaveGame;
    this.worldId = null;
    this.gameMode = 'survival';

    /* ---------------- renderer ---------------- */
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    // Whole device pixels per CSS pixel - see crispPixelRatio(). The blocky 16px
    // textures are crisp anyway, so anything fractional only costs fill rate
    // and buys a blurry composite.
    this._basePixelRatio = crispPixelRatio();
    this.renderer.setPixelRatio(this._basePixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.autoClear = true;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xa8c8ee, 60, 140);
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 1, 0.08, 600);

    /* ---------------- shared resources ---------------- */
    // The anisotropy ceiling is the driver's, and it has to be read off the
    // renderer rather than guessed: the atlas wants it at construction time
    // because it decides how the mip chain is sampled.
    MAX_ANISOTROPY = this.renderer.capabilities.getMaxAnisotropy();
    this.atlas = new TextureAtlas(
      assets.blockImages, 16, 16, MAX_ANISOTROPY);
    this.liquidTextures = {
      water: makeLiquidTexture(assets.blockImages.water_still),
      lava: makeLiquidTexture(assets.blockImages.lava_still),
      // The nether portal and the fire both play through animation frames cut out
      // of the pack's 16 x 512 strips, so both get their own texture rather than
      // going through the block atlas.
      portal: makeSheetTexture(assets.blockImages.nether_portal),
      fire: makeSheetTexture(assets.blockImages.fire),
      // Seagrass ships as a single vertical strip of frames rather than a grid,
      // so it needs no cutting - but it does need the same clamped, unmipmapped
      // setup, or the frame shader samples across from one frame into the next.
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
    // Grass creeping over dirt, and seagrass living on the seabed. Holds no
    // state of its own beyond a queue of positions to look at again, so one is
    // enough for the whole game and it survives a change of world.
    this.spreading = new Spreading(null);
    /**
     * Thrown ender pearls.
     *
     * Not per dimension: a pearl only ever flies in the world it was thrown in,
     * and stepping through a portal mid-flight is the case the real game treats
     * as "the pearl is gone". One pool, cleared on a dimension change.
     */
    this.pearls = new EnderPearls(this.scene, assets.itemImages);
    /** the chicken herd, per world, because a mob standing in the Overworld must
     *  not still be there after a trip to the Nether */
    this._mobsByDimension = {};
    this.mobs = null;
    /** Boats, per world, for the same reason the mobs are: both systems live in
     *  the one three.js scene, so a boat left floating in the Overworld would
     *  keep drawing over the top of the Nether. */
    this._boatsByDimension = {};
    this.boats = null;
    /** Beds, per world, for the same reason: their meshes live in the one
     *  three.js scene, so an Overworld bed left behind would keep drawing over
     *  the Nether after a portal trip. */
this._bedsByDimension = {};
  this.beds = null;
  /** Chests, for the same reason as beds: their artwork is scene objects, so an
   *  Overworld chest left behind would keep drawing over the Nether. */
  this._chestsByDimension = {};
  this.chests = null;
  this._portalVeil = makePortalVeil();

    /* ---------------- systems ---------------- */
    this.input = new Input(canvas);
    this.input.sensitivity = this.settings.sensitivity;
    // Controller support. The screens are navigated by their DOM, the game by
    // the same actions a keyboard binds to, so both halves live where they are
    // used: PadNav drives the menus, and Input answers `pressed('jump')` whether
    // the player pressed space or A.
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
    /**
     * Both dimensions, keyed by name. Only one is ever streamed at a time and
     * `this.world` always points at the one the player is standing in; the other
     * keeps its terrain in memory and simply stops being drawn.
     */
    this.worlds = {};
    this.dimension = 'overworld';
    /** Per-dimension player state, so a round trip through a portal returns
     *  you to where you left rather than to the surface. */
    this._positions = {};
    this._transition = 0;
    this._portalDelay = 0;
    this.player = null;
    this.survival = null;
    this.interaction = null;
    this.viewModel = new ViewModel(this.atlas, assets.itemImages, assets.blockImages);
    this.viewModel.setAspect(1);
    // The body, seen in third person. Added once and left to follow the player
    // across worlds, so a trip through a portal does not reload the model - and
    // it hides itself in first person, which is where it spends its life. It is
    // given the atlas and the item images as well, because it draws the held
    // item hanging off the right arm in third person, the same way the view
    // model draws the one in the right hand in first.
    this.playerModel = new PlayerModel(this.scene, this.atlas, assets.itemImages, assets.blockImages);

    this.screen = null;          // open ContainerScreen
    this.target = null;

    this.fps = 0;
    this._frames = 0;
    this._fpsTimer = 0;
    this.elapsed = 0;
    this.drawCalls = 0;
    this.triangles = 0;
    this.chunkStats = { rendered: 0, total: 0, pending: 0 };
    this.thirdPerson = 0;
    // scratch for the head bob: the camera's own right and up, reused every frame
    // so the bob does not allocate a pair of vectors sixty times a second
    this._bobRight = new THREE.Vector3();
    this._bobUp = new THREE.Vector3();
    /** The field of view on its way to the sprinting one, eased. */
    this._fovEased = undefined;
    this._itemDropCount = 0;
    this._basePixelRatio = 1;

    /* Adaptive render distance: when the measured frame rate stays below target,
       the render distance is stepped down so fewer chunks are generated, lit,
       meshed and drawn; it steps back up once the frame rate recovers. The
       player's own options choice is the ceiling, so auto-scaling never renders
       farther than they asked for. */
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

  /* ================================================================
     setup
     ================================================================ */

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this._basePixelRatio = crispPixelRatio();
    // Rendered at native resolution, at a whole device pixel ratio. There used
    // to be an adaptive resolution scaler here that dropped the pixel ratio
    // when the frame rate sagged and gave it back when there was headroom, with
    // a Render Scale slider as its target. The two fought each other: the
    // scaler nudged the same value the slider owned, so the slider slowly
    // drifted, and the result was a scene that quietly rendered softer than
    // the user asked for. The slider is gone and the scaler with it - if the
    // frame rate needs help, the frame budget is the thing to look at.
    this.renderer.setPixelRatio(this._basePixelRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewModel.setAspect(w / h);
    this.applyGuiScale();
  }

  /**
   * Minecraft style GUI scale, used for the in-game HUD (hotbar, hearts, toasts).
   * `guiScale: 0` means auto, which keeps the hotbar at roughly a quarter of
   * the screen width on any display.
   *
   * Menus deliberately do NOT scale with this - a full inventory panel has too
   * much content, and scaling it turns into a wall of pixels. They are sized in
   * plain pixels with viewport guards instead.
   */
  applyGuiScale() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const manual = this.settings.guiScale ?? 0;
    const auto = Math.max(1, Math.min(3, Math.round(Math.min(w, h) / 380)));
    const gui = snapToDevicePixels(manual > 0 ? manual : auto, window.devicePixelRatio || 1);
    document.documentElement.style.setProperty('--gui', String(gui));
    this.guiScale = gui;
  }

  _bindCanvas() {
    this.canvas.addEventListener('mousedown', () => {
      audio.init();
      // The chat is not a screen, so `!this.screen` does not exclude it - and
      // the chat screen only covers the strip along the bottom, so a click
      // anywhere above it lands on the canvas and would take the pointer back
      // in the middle of a message.
      if (this.state === STATE.PLAYING && !this.screen && !this.chat.isOpen) this.input.requestLock();
    });
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === STATE.PLAYING) this.pause();
    };
  }

  // The browser acts on these before the page sees them, so they are swallowed
  // here. The bindings themselves are handled per frame in handleHotkeys().
  _bindGlobalKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3' || e.code === 'F5' || e.code === 'F2') e.preventDefault();
    });

    // A backgrounded tab is the last reliable chance to write the world out:
    // `pagehide` fires on close, on reload and on mobile app switches, where
    // `beforeunload` does not. IndexedDB is async so it is not guaranteed to
    // finish, which is exactly why the timer autosave above exists too.
    window.addEventListener('pagehide', () => this.save(true));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.save(true);
    });
  }

  /**
   * Load the chosen language and point the registries at the translator, so
   * every block and item name resolves through the JSON files.
   */
  async initLanguage() {
    // names resolve through the active language once this is wired up
    setBlockNameResolver((name, kind, fallback) => lang.displayName(name, kind, fallback));
    setNameResolver((name, kind, fallback) => lang.displayName(name, kind, fallback));

    await lang.load(this.settings.language ?? 'en_us');
    lang.onChange(() => {
      this.refreshTranslations();
    });
    this.refreshTranslations();
  }

  /**
   * Put the real version number on the title screen.
   *
   * It used to be a translated string, hard-coded in three language files, which
   * is how the title came to say 1.2 while the game was at 1.4: two copies of a
   * fact with nothing keeping them together. This reads the one copy, so it
   * cannot drift.
   *
   * `package.json` sits at the project root, which the dev server serves. If the
   * fetch fails - opened straight off the disk with a `file://` URL, say - the
   * line is left empty rather than showing a version that is not the version.
   */
  async loadVersion() {
    const el = document.getElementById('title-version');
    try {
      const res = await fetch('package.json', { cache: 'no-store' });
      if (!res.ok) return;
      const pkg = await res.json();
      if (!pkg?.version || !el) return;
      this.version = String(pkg.version);
      el.textContent = t('menu.version', this.version);
    } catch {
      // no version rather than a wrong one
    }
  }

  /** Re-render every string that is currently on screen. */  refreshTranslations() {
    const font = this.font;
    // static markup buttons and headings
    lang.applyToDom((el, text) => {
      if (el.dataset.i18nPh !== undefined) {
        el.placeholder = text;
        return;
      }
      if (el.id === 'title-version') {
        // plain text, styled by CSS. Deliberately skipped: the version line is
        // filled in by loadVersion() once it has read package.json, and letting
        // lang overwrite it would put the number back to whatever a translation
        // file happens to say.
        return;
      }
      if (el.classList.contains('mc-heading')) {
        // White everywhere. The options and pause buttons sit on the dimmed
        // world and the title screen is dark too, so one colour is right for
        // all of them. `data-scale` sizes a heading per screen: the death
        // title is a display line and the menu titles are the same size as
        // the buttons under them, which is what the real game does.
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
    // the options panel renders its labels through the bitmap font too
    if (this.screens?.options?.isOpen) this.screens.options.show();
    if (this.screen) { this.screen._build(); this.screen.refresh(); }
    this.hud._invVersion = -1;      // force the hotbar to redraw
  }

  /**
   * Restore saved settings over the defaults.
   *
   * A stored value only wins if it has the right shape: an old or hand-edited
   * record can hold anything, and one bad type must not take the whole options
   * screen down. Unknown keys are dropped, and the keybind map is folded back
   * through `resolveBinds` so a stale action name cannot leave a control
   * permanently unbound.
   */
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
    // a changed field of view is a new destination, not a new place to ease from:
    // dragging the slider and having the view slide there is a stutter, not a
    // transition
    this._fovEased = undefined;
    this.input.sensitivity = s.sensitivity;
    this.input.setBinds(s.keybinds);
    audio.setVolume(s.volume);
    audio.setMusicVolume(s.musicVolume ?? 0.5);
    audio.setMuted(!!s.muted);
    audio.setMusicEnabled(s.musicEnabled ?? true);
    audio.musicToasts = s.musicToasts ?? true;
    // the cave rumble is off by default and the option is what turns it on
    CONFIG.AMBIENT_CAVE.ENABLED = !!s.caveAmbience;
    this.sky.setCloudHeight(s.cloudHeight ?? 148);
    const cloudsOn = s.clouds !== false;
    if (this.sky.cloudLayers) {
      for (const layer of this.sky.cloudLayers) layer.visible = cloudsOn;
    } else if (this.sky.clouds) {
      this.sky.clouds.visible = cloudsOn;
    }
    if (this.world) {
      // the player's options choice is the ceiling for adaptive scaling
      this._renderDistanceCeiling = s.renderDistance;
      this.applyRenderDistance(s.renderDistance);
    }
    this.updateCameraRanges();
    this.applyGuiScale();
    this.queueSettingsSave();
  }

  /**
   * Write the settings out, but only once the player stops dragging.
   *
   * Every slider and toggle calls applySettings on each `input` event, so
   * without the debounce a single drag of the render distance slider fires
   * hundreds of full IndexedDB writes.
   */
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
    this.sky.setRadius(Math.min(400, far * 0.42));
  }

  /**
   * Apply a render distance to every loaded world and rebuild the chunk queues
   * so the new distance takes effect on the next frame. Clamped to the adaptive
   * floor and the player's chosen ceiling.
   */
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

  /* ================================================================
     world lifecycle
     ================================================================ */

  /** Create a brand new world record and store it. */
  async createWorldRecord(opts) {
    const id = `w${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
    const record = {
      id,
      name: opts.name || t('menu.newWorld'),
      seed: opts.seed,
      seedText: opts.seedText || '',
      gameMode: opts.gameMode ?? 'survival',
      worldType: opts.worldType ?? 'default',
      difficulty: opts.difficulty ?? 'normal',
      created: Date.now(),
      lastPlayed: Date.now(),
      payload: null,
    };
    await this.saveGame.put(record);
    return id;
  }

  /** Load a stored world by id. */
  async playWorld(id) {
    const record = await this.saveGame.get(id);
    if (!record) {
      this.hud.toast(t('menu.worldMissing'), 'bad');
      return;
    }
    this.enterWorld(record);
  }

  async renameWorld(id, name, seedText) {
    const record = await this.saveGame.get(id);
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

  enterWorld(record) {
    log.info('Loading world "%s" (%s, %s)', record.name, record.gameMode, record.worldType);
    this.createWorld({
      seed: record.seed,
      saveData: record.payload,
      name: record.name,
      gameMode: record.gameMode ?? 'survival',
      worldType: record.worldType ?? 'default',
      difficulty: record.difficulty ?? 'normal',
      worldId: record.id,
    });
    // Write straight away. A world that has only just been created would
    // otherwise have a null payload until the first timer tick, and one lost
    // tab in that window would take the whole thing with it.
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

  /** Legacy entry: jump straight into a world with the given seed text. */
  startWorld(seedText) {
    log.info('Starting a new world');
    this.createWorld({ seed: seedFromString(seedText) });
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

  createWorld(opts = {}) {
    const {
      seed = seedFromString(null),
      saveData = null,
      gameMode = 'survival',
      worldType = 'default',
      difficulty = 'normal',
      worldId = null,
    } = opts;

    this._finishCreateWorld(opts);
  }

  async _finishCreateWorld(opts = {}) {
    const {
      seed = seedFromString(null),
      saveData = null,
      gameMode = 'survival',
      worldType = 'default',
      difficulty = 'normal',
      worldId = null,
    } = opts;

    this.teardownWorld();
    this.worldId = worldId;
    this.gameMode = gameMode;

    this._seed = seed >>> 0;
    this._worldType = worldType;
    this._gravityDir = 'DOWN';
    this._gravityTimer = 0;
    this.worlds = {};
    this._positions = {};
    this.dimension = 'overworld';
    this._transition = 0;
    this._portalDelay = 0;

    this._activateWorld(this._createDimensionWorld('overworld'), seed, worldType);
    this.updateCameraRanges();
    log.info('World ready (seed %d, %s%s)', this._seed, worldType, saveData ? ', resumed from save' : ', new');

    this.player = new Player(this.world);
    this.player.inventory = this.inventory;
    this.player.creative = gameMode === 'creative';
    // spectator is command-only, so a save that somehow carries it still works
    this.player.spectator = gameMode === 'spectator';
    // a new creative or spectator world opens with the player already in the
    // air; a loaded world keeps whatever was saved
    this.player.flying = this.player.canFly && !saveData;
    this.survival = new Survival(this.world, this.player);
    this.survival.difficulty = difficulty;
    // spectator is creative in every way that matters to the survival rules:
    // no hunger, no damage, no drowning, and bars that stay full
    this.survival.creative = this.player.creative || this.player.spectator;
    this.interaction = new Interaction(this);
    this._wasUnderwater = null;
    this._wasBuried = null;

    this.survival.toastHandlers.push((msg, kind) => this.hud.toast(msg, kind));
    this.survival.deathHandlers.push((cause) => this.onDeath(cause));
    this.advancements.spawnAt(this.player.position);
    // a stack running out is the inventory's business, but the statistics are
    // what care about it
    this.inventory.onBreak = (name) => this.statistics.recordItemBroken(name);
    this.inventory.onUse = (name, n) => this.statistics.recordItemUsed(name, n);

    // taking a hit plays the vanilla hurt sound. A fall gets the softer
    // landing thud for a short drop and the big one for a real plunge, which
    // is the split the real game makes.
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

    // level ups get the real Minecraft jingle
    this._lastLevel = 0;

    if (saveData) {
      this._restoreDimensions(saveData);
    } else {
      // a brand new world: nothing earned and nothing counted yet
      this.advancements.restore(null);
      this.statistics.reset();
      this.player.position.copy(this.world.findSpawn());
      // a new world starts empty-handed; a loaded one keeps its save
      if (gameMode === 'survival') this.startEmpty();
    }

    // force the spawn area to build immediately
    this.world.buildAreaNow(this.player.position.x, this.player.position.z);
    // now that the spawn chunks exist, drop the player onto real standable
    // ground instead of whatever the height map guessed
    this.world.settleSpawn(this.player.position);
    this.player.velocity.set(0, 0, 0);
    this.player.fallDistance = 0;
    this.statistics.beginSession();

    // Cursed world: show initial gravity direction
    if (this._worldType === 'cursed') {
      this.hud.toast(`GRAVITY: ${this._gravityDir}`, 'warn');
    }
  }

  /**
   * Build one dimension: its world, its own falling-block animation and its own
   * dropped-item pool.
   *
   * The two systems that matter have to be per dimension rather than shared.
   * A falling block commits itself to whichever world it was spawned in, and a
   * dropped item is drawn and picked up against the world it is lying in, so
   * one shared instance would drop a pile of sand into the Nether and let the
   * player pick up items through the floor.
   */
  _createDimensionWorld(dimension) {
    const world = new World(
      this._seed ?? seedFromString(null), this.scene, this.atlas, this.materials,
      this.mesher, this._worldType ?? 'default', dimension,
    );
    // sand and gravel animate down rather than teleporting to the floor
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

  /**
   * Get the player out of any boat they are in.
   *
   * Called by everything that moves the player somewhere the boat is not: a
   * dimension change, a death, a teleport. Each of those would otherwise leave
   * the player holding a boat that is in another place, and the boat - which
   * owns their position - would quietly drag them back to it on the next frame.
   * That reads as a teleport that did not take, and it happens every time.
   */
  dismountBoat() {
    this.player?.riding?.dismount(this.world);
  }

  /* ------------------------------------------------------------------ beds */

  /**
   * Is it dark enough to sleep?
   *
   * Vanilla's rule, not "is the sun down": you may sleep at night, and you may
   * also sleep in the middle of the day if it is raining or storming, because
   * that is the one daytime the sky is dark enough to call night. The clock
   * alone would refuse the second case, which is the whole reason a player ever
   * tries it.
   *
   * @returns {boolean}
   */
  canSleep() {
    const time = this.world?.time ?? 0;
    if (time >= 13000 || time < 1000) return true;
    // a storm is the one daytime dark enough to call night. `rainAmount` is the
    // interpolated strength, so this also covers a storm that is only just
    // starting, which is what the real game lets you sleep through.
    return (this.weather?.rainAmount ?? 0) > 0;
  }

  /**
   * Sleep in a bed: fade out, wake up at dawn, and make this bed the place the
   * player comes back to.
   *
   * The payoff for a whole day/night cycle being built, so it is worth doing
   * properly: the fade is two halves of a second, the clock is moved while the
   * screen is fully black (so the jump is never visible), and the respawn point
   * is the bed - which is what makes a bed worth building before a storm and
   * what makes dying somewhere far away cost something.
   *
   * Setting `world.spawnPoint` is the whole of the respawn rule: `findSpawn`
   * already returns it in preference to anything else, and `respawn` already
   * puts the player there. Nothing else has to know a bed exists.
   *
   * @param {number} x @param {number} y @param {number} z the bed's foot cell
   * @returns {boolean} whether the player went to sleep
   */
  sleepInBed(x, y, z) {
    if (this._sleeping) return false;
    if (this.player?.spectator || this.player?.creative) return false;
    // No popup. The rule is a permanent one, not an event, and it is said once
    // in the text under the crosshair (`_bedHint`) rather than thrown at the
    // player as a message every time they try a bed in daylight - which is what
    // it used to do, and which made an ordinary thing to fail at look like an
    // error.
    if (!this.canSleep()) return false;
    this._sleeping = { time: 0, foot: [x, y, z] };
    this.sleepOverlay = this.sleepOverlay ?? document.getElementById('sleep-overlay');
    audio.setAmbience('none');
    return true;
  }

  /**
   * Advance the sleep fade.
   *
   * Two stages either side of the clock jump: black at half a second, the jump,
   * and back out over the same. Driven from the update loop rather than a timer
   * so that a tab that loses focus mid-sleep does not leave the screen black.
   *
   * @param {number} dt
   */
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
      // the bed is the respawn point, and the player wakes on the side of it
      this.world.spawnPoint = new THREE.Vector3(x + 0.5, y + 1, z + 0.5);
      // straight to morning. `setTime` rather than an assignment, so the date
      // rolls with the clock the way it does for /time set.
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

  /**
   * Whether the player is in bed right now.
   *
   * @returns {boolean}
   */
  get sleeping() {
    return !!this._sleeping;
  }

  /** Make a world the active one and point every system that caches it at it. */
  _activateWorld(world) {
    this.world = world;    this.dimension = world.dimension;
    this.itemDrops = this._itemDropsByDimension[world.dimension] ?? this.itemDrops;
    this.itemDrops.world = world;
    // the spreading rules read and write the active world, and their queue of
    // positions belongs to the world it was built for
    this.spreading.world = world;
    this.spreading.clear();
    // Something that lost the ground under it hands its block to the player, and
    // that is a game-layer concern - the drops, the sounds, the statistics. The
    // world works out *that* it happened (`World._settleAbove`); who gets the
    // cactus is this file's business.
    //
    // Set on every activation rather than once, because the hook holds a closure
    // over the world it was made for and would otherwise keep handing drops to the
    // previous dimension's item pool after a portal.
    world.onBlockBroken = (x, y, z, id) => {
      this.interaction?.dropBrokenBlock(x, y, z, id);
    };
    // a chicken left behind in another dimension stays there
    this._mobsByDimension[world.dimension] ??= new Mobs(this.scene, world, this);
    this.mobs = this._mobsByDimension[world.dimension];
    this.mobs.world = world;
    this._boatsByDimension[world.dimension] ??= new Boats(this.scene, world);
    this.boats = this._boatsByDimension[world.dimension];
    this.boats.world = world;
    // a boat makes its own bow wave, and the particle pool is a game-layer thing
    // the boat should not reach into
    this.boats.splash = (x, y, z, power) => this.particles?.spawnSplash(x, y, z, power);
    // a bed is the one block drawn by a manager rather than by the mesher, and
    // it lives in the dimension it was built in like everything else
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
    // Every *other* dimension stops drawing. Both worlds live in one three.js
    // scene, so a chunk that is still meshed keeps drawing over the top of
    // whichever one the player is actually standing in. It has to be the ones we
    // are leaving, not the one we are arriving in: hiding the wrong one leaves
    // the overworld on screen with the Nether drawn through it.
    for (const w of Object.values(this.worlds)) {
      if (w !== world) w.hide();
    }
    /**
     * ...and so is everything a manager owns.
     *
     * `World.hide()` throws away the terrain's geometry and nothing else, and
     * every manager keeps its objects in the one shared three.js scene: mobs,
     * dropped items, beds, chests, boats. Hiding only the chunks left the
     * Overworld's herd and its furniture standing in the Nether's sky, at
     * Overworld heights, which is a very odd first impression of the dimension.
     *
     * They are hidden rather than cleared, so the chicken is still where it was
     * when the player comes back the other way.
     */
    for (const dimension of Object.keys(this.worlds)) {
      const on = dimension === world.dimension;
      for (const m of this._dimensionManagers(dimension)) m.setVisible(on);
    }
    world.invalidate();
  }

  /**
   * The per-dimension managers that own scene objects, for one dimension.
   *
   * Only the ones that have been built: a dimension the player has never
   * arrived at has no manager yet, and there is nothing to hide.
   *
   * @param {string} dimension
   * @returns {Array<{setVisible(visible:boolean):void}>}
   */
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

  /**
   * Put the player where they were last standing in this dimension.
   *
   * The Overworld's first arrival is its spawn; the Nether's is a portal, and
   * that is remembered so dying down there brings you back through the portal
   * you came in by rather than onto the roof.
   */
  _rememberPosition(dimension, position) {
    this._positions[dimension] = {
      position: [position.x, position.y, position.z],
      yaw: this.player.yaw,
      pitch: this.player.pitch,
      flying: this.player.flying,
    };
  }

  /**
   * Step through a portal.
   *
   * The 1:8 in x and z and the halving in y are the vanilla scale, so a portal
   * built at the overworld's surface arrives near the Nether's mid height rather
   * than wherever that y would land in an unscaled world. Coming back multiplies
   * instead, which is what keeps a return portal under the one you left from.
   */
  async travelTo(dimension) {
    if (this._transition > 0 || !this.player || this.world.dimension === dimension) return;
    const P = CONFIG.PORTAL;
    const from = this.dimension;
    // off the boat before the position is remembered, or the game saves a seat
    // in a river as the place to put the player back to
    this.dismountBoat();
    this._rememberPosition(from, this.player.position);
    this._transition = P.TRANSITION_SECONDS;

    // the veil goes up first, and the dimension swap happens under it
    this._setVeil(0.9);
    await wait(P.TRANSITION_SECONDS * 0.5);

    const leaving = this.world;
    let target = this.worlds[dimension];
    if (!target) {
      target = this._createDimensionWorld(dimension);
      this._restoreWorldSave(dimension, this._pendingSave?.[dimension]);
    }
    this._activateWorld(target);

    // Handle different dimension transitions
    const fromNether = from === 'nether';
    const toNether = dimension === 'nether';
    const toEnd = dimension === 'end';
    const fromEnd = from === 'end';

    let spot;
    let freshArrival = false;
    let remembered = this._positions[dimension];

    if (toEnd) {
      // Overworld -> End: spawn at the exit portal (0, island surface, 0)
      // The EndGen generates an exit portal at the island surface
      const spawnY = target.gen?.portalBaseY ?? 50;
      spot = { x: 0, y: spawnY, z: 0 };
      freshArrival = !target.spawnPoint;
      if (freshArrival) {
        buildEndExitPortal(target);
        target.spawnPoint = new THREE.Vector3(0.5, spawnY + 1, 0.5);
      }
    } else if (fromEnd) {
      // End -> Overworld: return to the remembered position (where end portal was)
      const remembered = this._positions['overworld'];
      if (remembered) {
        spot = { x: remembered.position[0], y: remembered.position[1], z: remembered.position[2] };
      } else {
        // Fallback to world spawn
        spot = { x: 0, y: target.gen.heightAt(0, 0) + 1, z: 0 };
      }
      freshArrival = false;
    } else {
      // Nether <-> Overworld: use coordinate scaling
      const scale = fromNether ? P.COORD_SCALE : 1 / P.COORD_SCALE;
      const hScale = fromNether ? P.HEIGHT_SCALE : 1 / P.HEIGHT_SCALE;
      const mapped = {
        x: Math.floor(this.player.position.x * scale),
        y: Math.floor(this.player.position.y * hScale),
        z: Math.floor(this.player.position.z * scale),
      };
      mapped.y = Math.max(target.constants.MIN_Y + 2, Math.min(target.constants.MAX_Y - 4, mapped.y));

      // and the remembered position wins when there is one: returning through the
      // same pair of portals is what the player expects
      const wanted = remembered?.position
        ? { x: remembered.position[0], y: remembered.position[1], z: remembered.position[2] }
        : mapped;

      spot = findPortalNear(target, wanted.x, wanted.y, wanted.z);
      // Only the first arrival has nothing to come back to. The Nether gets a
      // portal built at the player's back rather than in front of them, so turning
      // round is all it takes to go home.
      if (!spot) {
        freshArrival = true;
        const base = findArrivalBase(target, mapped.x, mapped.y, mapped.z);
        if (dimension === 'nether') {
          // stand on the ground, facing as they were, with the portal behind them
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
        // face the portal you came out of, which is the one thing in the Nether
        // the player can see and recognise. A fresh arrival keeps the direction
        // they walked in facing, because the portal is behind them.
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

    // build the arrival area before the veil comes down, so nobody watches a
    // wall of ungenerated rock
    target.buildAreaNow(this.player.position.x, this.player.position.z);
    target.settleSpawn(this.player.position);
    this.player.velocity.set(0, 0, 0);
    this.player.fallDistance = 0;
    // A remembered position can be inside the very portal they left by, and a
    // player standing in a live portal changes dimension on the next frame - so
    // left alone they bounce between the two forever. Step them clear first.
    this._unstickFromPortal(target);

    leaving.falling?.clear();
    // a pearl only ever flies in the world it was thrown in, and stepping through
    // a portal mid-flight is the case the real game treats as the pearl being lost
    this.pearls.clear();
    // the sound of going through one. The real game says nothing in chat when you
    // change dimension. It plays the portal travel sound and that is the whole of
    // the feedback, so a line of text here would be a thing this game does that
    // Minecraft does not.
    audio.portalTravel();
    // A few seconds during which a portal will not take the player again. Arriving
    // in the Overworld puts them back inside the portal they walked through, and
    // arriving in the Nether puts one at their back; either way there is a moment
    // where the player could be grabbed and sent straight back.
    this._portalDelay = CONFIG.PORTAL.REENTRY_DELAY;
    // the Nether has its own track, so stepping through a portal changes the
    // music as well as the place
    this.playWorldMusic();
    this.save(true);

    // Show end screen when returning from the End to Overworld
    // Keep veil up during end screen to prevent world flash
    if (fromEnd) {
      await this._showEndScreen();
      this._setVeil(0);
      // Force unstick after screen in case delay expired
      this._unstickFromPortal(this.world);
    }
  }

  /**
   * Step the player out of a portal they have just been placed inside.
   *
   * Only ever called right after a dimension change, and only when they landed in
   * one. The search is a small box for a cell with solid ground under it and two
   * blocks of air over it; if there is nothing, they are left where they are,
   * because a portal with no way out of it is a world the player built
   * themselves.
   */
  _unstickFromPortal(world) {
    // Check both nether and end portals
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

  /** The purple veil, 0 to 1. */
  _setVeil(alpha) {
    this._portalVeil.style.opacity = String(alpha);
  }

  /**
   * Show the end screen when returning from the End to Overworld.
   * Fades in quote, shows continue button after 3s, fades out on click.
   */
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

  /**
   * Is the player standing in a portal that is open to enter?
   *
   * A sheet of `nether_portal` blocks only exists where a complete obsidian
   * frame was lit, so this is the whole test: being made of portal blocks is what
   * makes it a door.
   */
  playerInActivePortal() {
    if (!this.player || !this.world) return false;
    return playerInPortal(this.world, this.player.position) !== null;
  }

  /**
   * Is the player standing in an active end portal (teleports to End)?
   */
  playerInEndPortal() {
    if (!this.player || !this.world) return false;
    return playerInEndPortal(this.world, this.player.position);
  }

  /**
   * Restore both dimensions out of a save record.
   *
   * Only the overworld used to be written out. A record that carries only
   * `world` is an older one and still loads: it becomes the overworld, and the
   * Nether is built fresh the first time anyone goes through a portal.
   */
  _restoreDimensions(saveData) {
    const worlds = saveData.worlds ?? { overworld: saveData.world };
    const mobs = saveData.mobs ?? {};
    const itemDrops = saveData.itemDrops ?? {};
    this._pendingSave = worlds;
    this._restoreWorldSave('overworld', worlds.overworld);
    // restore mobs for overworld
    if (mobs.overworld) {
      this._mobsByDimension.overworld ??= new Mobs(this.scene, this.worlds.overworld, this);
      this._mobsByDimension.overworld.deserialize(mobs.overworld);
    }
    // restore item drops for overworld
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
      // restore mobs for nether
      if (mobs.nether) {
        this._mobsByDimension.nether ??= new Mobs(this.scene, this.worlds.nether, this);
        this._mobsByDimension.nether.deserialize(mobs.nether);
      }
      // restore item drops for nether
      if (itemDrops.nether) {
        this._itemDropsByDimension.nether ??= new ItemDrops(this.worlds.nether, this.scene, this.atlas, this.assets.itemImages, this.assets.blockImages);
        this._itemDropsByDimension.nether.deserialize(itemDrops.nether);
      }
    } else if (dimension === 'end' && worlds.end) {
      this._activateWorld(this._createDimensionWorld('end'));
      this._restoreWorldSave('end', worlds.end);
      // restore mobs for end
      if (mobs.end) {
        this._mobsByDimension.end ??= new Mobs(this.scene, this.worlds.end, this);
        this._mobsByDimension.end.deserialize(mobs.end);
      }
      // restore item drops for end
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
      // A save written before positions existed carried the position at the top
      // level. It is a real position and it is the player's own, so it is worth
      // more than the world spawn, which is a guess about where a brand new world
      // begins and is exactly where this bug was putting everyone.
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

  /**
   * Begin a brand new survival world with nothing in the bag.
   *
   * Handing out a pickaxe and some planks on spawn skips the whole game: you can
   * punch wood, craft a bench and mine stone for yourself, which is the point of
   * survival mode. Empty is a genuine fresh start.
   *
   * Only for a new world. A loaded world restores its inventory from the save
   * instead, and respawning keeps what the player was carrying, so neither goes
   * through here.
   */
  startEmpty() {
    this.inventory.slots.fill(null);
    this.inventory.armour.fill(null);
    this.inventory.selected = 0;
    this.inventory.touch();
  }

  teardownWorld() {
    this.closeScreen();
    // the indicator outlives the write, so it has to be put down by hand when
    // the world it belongs to goes away
    this.hud.setSaving(false);
    if (this.worldId) log.info('Unloading world %s', this.worldId);
    this._saveShownAt = undefined;
    for (const drops of Object.values(this._itemDropsByDimension)) drops.clear();
    for (const mobs of Object.values(this._mobsByDimension ?? {})) mobs.clear();
    this._mobsByDimension = {};
    // the player must be off the boat before the boat goes, or they would be
    // left holding a reference to something that is no longer in the world
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
    // the rain belongs to the world that was just torn down, and its bed is
    // independent of every other ambience - so nothing else here would stop it
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

  /** Show the loading screen with an optional status message. */
  /* ================================================================
     save
     ================================================================ */

  /**
   * Write the current world into its IndexedDB record.
   * IndexedDB is async, so this is deliberately not awaited by the frame loop;
   * a save already in flight is not restarted.
   */
  save(quiet = false) {
    if (!this.world || !this.player) return false;

    // A quiet save that has nothing to write is skipped outright. A 5 second
    // timer is only affordable because most of those saves find an untouched
    // world and never run the encoder.
    if (quiet && !this._isSaveNeeded()) return false;

    // Record where the player is *now*, in the dimension they are in.
    //
    // This used to happen only on a dimension change, which meant an ordinary
    // save wrote an empty `positions` and loading fell through to findSpawn() -
    // so every world opened at its spawn point no matter where you had actually
    // built. The per-dimension map has to be filled on the way *out* of a save,
    // not as a side effect of travelling, or it is only ever right for the
    // dimension you happen to have visited last.
    this._rememberPosition(this.dimension, this.player.position);

const payload = {
      version: 3,
      /** which dimension the player is standing in */
      dimension: this.dimension,
      /** every dimension that has been visited, keyed by name. An older record
       *  carried a single `world`; it still loads, as the overworld. */
      worlds: Object.fromEntries(
        Object.entries(this.worlds).map(([name, w]) => [name, w.serialize()]),
      ),
      /** mobs per dimension (only interacted mobs are saved) */
      mobs: Object.fromEntries(
        Object.entries(this._mobsByDimension).map(([name, m]) => [name, m.serialize()]),
      ),
      /** item drops per dimension */
      itemDrops: Object.fromEntries(
        Object.entries(this._itemDropsByDimension).map(([name, d]) => [name, d.serialize()]),
      ),
      /** where the player stands in each dimension, so a portal is a door
       *  between two places rather than a one way trip */
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

    // an unnamed world has nowhere to go yet
    if (!this.worldId) {
      if (!quiet) this.hud.toast(t('hud.saved'), 'good');
      return false;
    }

    if (this._saving) {
      // A save is already writing. Rather than dropping this one - which is how
      // the last few edits go missing when the tab closes mid-write - remember
      // that another is owed and run it as soon as this one lands.
      this._saveQueued = !quiet;
      return false;
    }
    this._saving = true;
    this._saveShownAt = performance.now();
    this.hud.setSaving(true);
    this.saveGame.get(this.worldId)
      .then((record) => {
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
        // A silent failure here means the player loses work without ever being
        // told, so a background save that breaks still says so.
        this.hud.toast(t('hud.saveFailed'), 'bad');
        this._sinceAutosave = 0;
      })
      .finally(() => {
        this._saving = false;
        // The indicator is *not* taken down here.
        //
        // An IndexedDB write on a world of any size finishes in a few
        // milliseconds, so tying the panel to the write meant the one and a half
        // second animation was over before the eye landed on it - it flashed for a
        // single frame. It stays up for a minimum, cleared by the frame loop, so
        // it is actually watchable. A save landing during that hold restarts the
        // minimum rather than truncating it, so two quick saves read as one
        // continuous indicator.
        if (this._saveQueued) {
          this._saveQueued = false;
          this.save(false);
        }
      });
    return true;
  }

  /** Whether the saving indicator has been up long enough to be worth looking at. */
  _saveIndicatorDone() {
    if (this._saving) return false;
    if (this._saveShownAt === undefined) return true;
    if (performance.now() - this._saveShownAt < CONFIG.SAVE_INDICATOR_MIN_MS) return false;
    this._saveShownAt = undefined;
    return true;
  }

  /* ================================================================
     pause / resume / death
     ================================================================ */

  pause() {
    if (this.state !== STATE.PLAYING) return;
    // pausing is the most common moment to stop playing, so it is the right
    // moment to write the world out
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

  /**
   * Scatter everything the player was carrying across the ground on death.
   *
   * Stacks go out on a golden-angle spiral rather than all at the feet: dropped
   * items merge when they land within about two thirds of a block of each
   * other, so a pile of everything in one spot would collapse into a handful of
   * entities and lose most of what you were carrying before you could see it.
   */
  dropAllOnDeath() {
    const stacks = [];
    for (const s of this.inventory.slots) if (s) stacks.push(s);
    for (const s of this.inventory.armour) if (s) stacks.push(s);

    const p = this.player.position;
    for (let i = 0; i < stacks.length; i++) {
      // golden angle: successive points never share a nearest neighbour, so
      // the spread stays even however many stacks there are
      const ang = i * 2.39996323;
      // sqrt spacing keeps the area uniform instead of clumping at the centre
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
    // survival stakes: everything you are carrying hits the ground
    this.dropAllOnDeath();
    this.screens.death.show(cause);
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
    // the spawn chunks are already built here, so the point can be settled
    // onto clear ground straight away
    this.world.settleSpawn(this.player.position);
    // respawning re-applies the game mode, so a creative or spectator player
    // comes back up
    this.player.flying = this.player.canFly;
    this._transition = 0;
    // and the same grace period on respawn: the player respawns at the portal in
    // the Nether, and a portal that grabs them there is a death loop
    this._portalDelay = CONFIG.PORTAL.REENTRY_DELAY;
    this._setVeil(0);
    this.state = STATE.PLAYING;
    this.playWorldMusic();
    this.input.requestLock();
  }

  /**
   * The music for wherever the player is standing.
   *
   * The Nether has its own track rather than sharing the overworld's rotation, so
   * walking through a portal changes the music instead of occasionally shuffling
   * it. Called on entering a world, on respawning, and on every dimension change,
   * because a respawn in the Nether must not hand the player the overworld's.
   */
  /**
   * A thrown pearl has landed: take the thrower to it, for 5 damage.
   *
   * The two sounds are the real pair, and the order is the real one. The pop is
   * the pearl; the *teleport itself makes no sound at all* - the only thing you
   * hear is the small fall thud, and that belongs to the damage, so it plays only
   * when there is damage to play it for.
   *
   * Landing in lava is fine, and is a trick the real game is built around: a pearl
   * entity is not destroyed by lava, so throwing one into a lake drops you at the
   * bottom of it.
   */
  _onPearlLands(pos) {
    const player = this.player;
    if (!player || player.dead) return;

    // a pearl that lands inside a nether portal takes the thrower through it,
    // which is how the real game moves you between dimensions without a portal
    const inside = Blocks.get(this.world.getBlock(
      Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z),
    ));
    if (inside.name === 'nether_portal') {
      audio.pearlPop();
      this.travelTo(this.dimension === 'overworld' ? 'nether' : 'overworld');
      return;
    }

    audio.pearlPop();

    // land on top of whatever it hit, not inside it
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

    // and the damage, which is the whole trade: a pearl is a fast way across a
    // ravine and a way to come back up one at half a heart
    this.survival.damage(CONFIG.PEARL.DAMAGE, 'ender_pearl', true);
    audio.fallSmall();

    // falling cancels the fall damage the arrival would otherwise be, so a pearl
    // thrown before touching the ground only ever costs the pearl's own damage
    if (player.position.y > from.y) player.fallDistance = 0;
  }

  playWorldMusic() {
    audio.playMusic(this.dimension === 'nether' ? 'nether' : this.dimension === 'end' ? 'end' : 'game');
    // the panel belongs to the world, not to whatever was playing before it
    this.hud.hideMusicToast();
  }

  /**
   * The name of the track playing, shown in the top left corner.
   *
   * Driven off the sound engine rather than off a timer, so the panel appears
   * when a track actually starts - including the one the browser's autoplay
   * policy held back until the first click, which is otherwise the very first
   * thing a player would never see named. It re-asks every frame and the HUD
   * ignores a name it is already showing, so this costs a string compare.
   */
  showMusicToast() {
    if (!audio.musicToasts) {
      this.hud.hideMusicToast();
      return;
    }
    const name = audio.currentTrackName;
    if (name) this.hud.musicToast(name);
  }

  /* ================================================================
     container screens
     ================================================================ */

  openScreen(kind, blockPos) {
    this.closeScreen();
    const screen = new ContainerScreen(this, kind, blockPos);
    if (kind === 'furnace' && blockPos) {
      screen.attachFurnace(this.world.getBlockEntity(blockPos.x, blockPos.y, blockPos.z));
    }
    screen.open(blockPos);
    this.screen = screen;
    this.input.exitLock();
  }

  openFurnace(x, y, z) {
    this.openScreen('furnace', { x, y, z });
  }

  /**
   * Open a chest, whichever half of it was clicked.
   *
   * The screen is handed the entity that *owns* the contents rather than the one
   * under the crosshair, because a double chest keeps its 54 slots on the left
   * half only. Clicking the right-hand side without this opens a grid of 27
   * permanently empty slots, which reads as a broken chest rather than as a
   * deliberate rule.
   */
  openChest(x, y, z) {
    this.openScreen('chest', { x, y, z });
    this.screen?.attachChest(chestOwner(this.world, x, y, z));
    audio.chestOpen();
  }

  /**
   * Flag a chest's contents as changed, so the chunk they live in gets written
   * to disk.
   *
   * The furnace does not need this - a furnace's contents change only while the
   * smelting tick is running, which already marks the chunk dirty - but a chest
   * is edited by a mouse click and nothing else happens in the frame, so without
   * this the contents would be lost on the next save.
   */
  markChestDirty() {
    const p = this.screen?.blockPos;
    if (!p) return;
    const c = this.world.chunkAtBlock(p.x, p.z);
    if (c) c.modified = true;
  }

  /** The name commands and chat use for the local player. */
  get playerName() {
    return this.settings.playerName || 'Player';
  }

  /**
   * Switch game mode without leaving the world, the way /gamemode does.
   * Everything that caches the mode - the player, the survival rules, the HUD
   * and the world record - is updated together.
   */
  setGameMode(mode) {
    this.gameMode = mode;
    const creative = mode === 'creative';
    const spectator = mode === 'spectator';
    if (this.player) {
      this.player.creative = creative;
      this.player.spectator = spectator;
      // creative and spectator hand out the flying ability immediately, and
      // taking the mode away takes it back - dropping the player out of the sky
      this.player.flying = creative || spectator;
      this.player.fallDistance = 0;
      // a spectator has no hitbox, so anything it is standing in simply stops
      this.player.velocity.set(0, 0, 0);
    }
    if (this.survival) this.survival.creative = creative || spectator;
    if (this.hud) this.hud._applyGameMode();
    // the new mode is what a fresh load of this world has to start in
    if (this.worldId && this.saveGame?.get) {
      this.saveGame.get(this.worldId)
        .then((record) => {
          if (record) this.saveGame.put({ ...record, gameMode: mode });
        })
        .catch(() => { /* the mode still applies to this session */ });
    }
  }

  /** Kill the player, used by /kill. Creative is immune to damage but not here. */
  killPlayer(cause = 'generic') {
    if (!this.survival || this.state !== STATE.PLAYING) return;
    const creative = this.survival.creative;
    this.survival.creative = false;
    this.survival.damage(CONFIG.MAX_HEALTH * 2, cause);
    this.survival.creative = creative;
  }

  closeScreen() {
    // A chest closing is the one screen close with a sound of its own, and the
    // real game plays it on the same hinge the lid animation closes on - so this
    // goes before the screen is torn down, while its position is still readable.
    if (this.screen?.kind === 'chest') audio.chestClose();
    if (this.screen) {
      this.screen.destroy();
      this.screen = null;
    }
    if (this.state === STATE.PLAYING && this.world) this.input.requestLock();
  }

  /* ================================================================
     helpers used by interaction
     ================================================================ */

  emitDigParticles(t) {
    if (t?.hit) this.particles.spawnDig(t.hit, t.id);
  }

  /**
   * What the held stack would do to a mob if it were swung at one right now, or
   * null for a bare hand.
   *
   * Built fresh on each swing rather than cached, because the answer changes the
   * moment the selected slot does, and a cached one would have a player swapping
   * from a sword to a block and still hitting with a sword.
   *
   * The damage comes off the item's own `tool.damage`, which is the real game's
   * own figure: a wooden sword 4, a stone one 5, a diamond one 7, and an axe or
   * shovel well behind the sword of its tier. A hand with nothing in it is the
   * caller's `?? 1`, which is also the real game's bare hand.
   *
   * @returns {{damage:number, wear:()=>void}|null}
   */
  _heldWeapon() {
    const held = this.inventory.held;
    if (!held) return null;
    const def = Items.get(held.name);
    const damage = def?.tool?.damage;
    // An item with no damage of its own - flint and steel, a block - is not a
    // weapon, and swinging it at a chicken should cost nothing and hit for
    // nothing more than a fist.
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

  /* ================================================================
     frame
     ================================================================ */

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

    // The controller is polled rather than listened for, and everything this
    // frame - hotkeys, look, the screens - reads the state this leaves. It
    // goes first, or the pad answers a frame behind the keyboard.
    this.input.pollGamepad(dt);

    // Hand the JS heap back on a schedule. Chunk meshes come and go constantly,
    // so without a trim V8 waits until the heap is nearly full before a major
    // GC and the process rides near its cap in the meantime. window.gc only
    // exists when Electron launches with --expose-gc, so a browser build just
    // skips this. Once a minute, outside the frame the GC lands in.
    this._gcTimer = (this._gcTimer ?? 0) + dt;
    if (this._gcTimer >= 60) {
      this._gcTimer = 0;
      if (typeof window !== 'undefined' && window.gc) window.gc();
    }

    // fps counter
    this._frames++;
    this._fpsTimer += dt;
    if (this._fpsTimer >= 0.5) {
      this.fps = Math.round(this._frames / this._fpsTimer);
      this._frames = 0;
      this._fpsTimer = 0;
      // Adaptive render distance: step the visible chunk count down when the
      // frame rate stays low, and back up once it recovers. Render distance is
      // the single biggest lever on triangles, draw calls, chunk meshing and
      // the world sim, so it cuts the cost of a slow frame directly.
      const now = performance.now();
      if (this.world && now - this._lastRenderDistanceChange > 3000) {
        if (this.fps < 50) {
          this._fpsLowStreak = (this._fpsLowStreak ?? 0) + 1;
          this._fpsHighStreak = 0;
          if (this._fpsLowStreak >= 2 && this.settings.renderDistance > this._renderDistanceFloor) {
            this.applyRenderDistance(this.settings.renderDistance - 1);
            this._fpsLowStreak = 0;
            this._lastRenderDistanceChange = now;
          }
        } else if (this.fps > 60) {
          this._fpsHighStreak = (this._fpsHighStreak ?? 0) + 1;
          this._fpsLowStreak = 0;
          if (this._fpsHighStreak >= 4 && this.settings.renderDistance < this._renderDistanceCeiling) {
            this.applyRenderDistance(this.settings.renderDistance + 1);
            this._fpsHighStreak = 0;
            this._lastRenderDistanceChange = now;
          }
        } else {
          this._fpsLowStreak = 0;
          this._fpsHighStreak = 0;
        }
      }
    }

    this.handleHotkeys();
    // Menus: the pad walks them and presses what the mouse would have.
    this.padNav.update(dt);

    if (this.state === STATE.PLAYING && this.world) {
      this.updatePlaying(dt);
    } else if (this.state === STATE.PAUSED || this.state === STATE.DEAD) {
      this.updateFrozenCamera();
    }

    this.render();
    this.input.endFrame();
  }

  /**
   * Chunk work per frame, adapted to the measured frame time so a slow machine
   * streams chunks more gently instead of stuttering.
   */
  get chunkBudget() {
    const target = 1 / 60;
    const scale = target / Math.max(target, this._frameAvg);
    return Math.max(4, Math.min(26, Math.round(12 * scale)));
  }

  handleHotkeys() {
    const input = this.input;

    // The Controls screen swallows the keyboard while it waits for a key press.
    if (input.isCapturing) return;

    // the chat box has its own keyboard: Enter, Escape and the arrow keys are
    // handled inside the input, everything else is just text
    if (this.chat.isOpen) {
      if (input.pressed('pause')) this.chat.close();
      return;
    }

    // F2/F3/F5 are global: they work from any screen, like the real game.
    if (input.pressed('screenshot')) this.screenshot();
    if (input.pressed('debug')) this.hud.toggleDebug();
    if (input.pressed('perspective')) this.thirdPerson = (this.thirdPerson + 1) % 3;

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

    // the inventory keys close their own screen, the way the real game does
    if (this.state === STATE.PLAYING && this.screen) {
      const kind = this.screen.kind;
      if (input.pressed('creativeInventory') && kind === 'creative') this.closeScreen();
      else if (input.pressed('inventory') && kind === 'inventory') this.closeScreen();
      return;
    }

    if (this.state !== STATE.PLAYING || this.screen || this.screens.steps?.isOpen) return;

    if (input.pressed('inventory')) this.openScreen('inventory', null);
    if (input.pressed('creativeInventory')) this.openScreen('creative', null);

    // T opens chat, / opens chat with the command slash already typed
    if (input.pressed('chat')) this.chat.open('');
    if (input.pressed('command')) this.chat.open('/');

    // M opens the step counter app
    if (input.pressed('steps')) {
      if (this.screens.steps?.isOpen) {
        this.screens.steps.hide();
        if (this.state === STATE.PLAYING) this.input.requestLock();
      }
      else this.screens.steps?.show();
    }

    // Ctrl+Q drops the whole stack, Q drops one
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

    // The shoulder pair cycles the hotbar, and the d-pad's right direction
    // opens the chat, which is the same thing the real game's d-pad is for. The
    // d-pad is not movement - that is the left stick's job alone, so a thumb on
    // the hat switch can never walk the player at all.
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

  /**
   * A controller arriving or leaving.
   *
   * Announced once rather than per event, which is what the real game does:
   * plugging one in while playing hands you a player in a world, and the toast
   * is the only way to find out the half of it that has no keyboard.
   */
  _onPadChange(change) {
    if (change === 'found') {
      this.hud.toast(t('hud.padConnected'), 'info');
    } else if (change === 'lost') {
      this.input.exitLock();
      this.hud.toast(t('hud.padLost'), 'info');
    }
  }

  updateFrozenCamera() {
    // keep the world visible but frozen behind menus
    if (!this.world) {
      this.renderer.clear();
      return;
    }
    this.updateCamera();
  }

  /**
   * One jump tap. Two inside the vanilla double tap window toggle flight.
   *
   * The tap that starts the flight is also a normal jump, which is what the
   * real game does: double tapping on the ground takes you off it.
   */
  handleJumpTap() {
    const now = performance.now() / 1000;
    const quick = now - (this._lastJumpTap ?? -10) < CONFIG.DOUBLE_TAP_TIME;
    this._lastJumpTap = now;
    if (quick) this.player?.toggleFlight();
    else if (this.player?.onGround) this.statistics.recordJump();
  }

  updatePlaying(dt) {
    const { player, world, survival, input, inventory } = this;
    // typing in the chat box takes the keyboard away from the player
    const uiOpen = !!this.screen || this.chat.isOpen;

    /* ---- the portal transition ----
       The veil is the whole transition: it goes up over the first half of the
       window, the dimension swap happens underneath it, and it comes back down
       over the second half. Nothing else about the swap is instantaneous, so
       this is the only place the timing has to be right. */
    if (this._transition > 0) {
      this._transition -= dt;
      const half = CONFIG.PORTAL.TRANSITION_SECONDS * 0.5;
      this._setVeil(this._transition > half ? 0.9 : Math.max(0, (0.9 * this._transition) / half));
      if (this._transition <= 0) {
        this._transition = 0;
        this._setVeil(0);
      }
    } else if (!uiOpen) {
      // A lit portal is always open. There is no second condition to satisfy and
      // nothing to be in the right place about, so this is one call - except
      // straight after arriving, when the player has just been put down either
      // inside a portal or with one at their back, and a portal that grabs them
      // immediately would send them straight back where they came from.
      if (this._portalDelay > 0) {
        this._portalDelay = Math.max(0, this._portalDelay - dt);
      } else if (this.dimension === 'overworld' && this.playerInEndPortal()) {
        // Entering an activated end portal frame in overworld -> travel to End
        this.travelTo('end');
      } else if (this.dimension === 'end' && this.playerInEndPortal()) {
        // Standing in the exit portal in the End -> return to overworld
        this.travelTo('overworld');
      } else if (this.playerInActivePortal()) {
        // Nether portal
        this.travelTo(this.dimension === 'overworld' ? 'nether' : 'overworld');
      }
    }

    /* ---- look ---- */
    // A controller looks without the pointer being locked, which is the whole
    // point of looking with a stick: there is no cursor to trap. Everything
    // else the lock guards still guards it, so a player using a mouse is
    // unchanged and a player using a controller simply has no lock to lose.
    const padLooking = !!this.input.pad?.connected;
    if (input.locked || padLooking) {
      // Java's mouse look, in its own units: 0.15 degrees per mouse *count* at
      // 100% sensitivity, which at a 500 count per inch mouse is about 75 degrees
      // across an inch of travel. The slider here is 1..15 with 3 as its middle,
      // so the constant below is that 0.15 degrees divided by three.
      //
      // This used to be `sensitivity * 0.0022` radians, which at the default of 3
      // turned 0.38 degrees per count - two and a half times as fast as the real
      // game at its own default, and fast enough that fine aiming was a matter
      // of moving the mouse less rather than of turning less. It was not wrong about
      // the sensitivity being a multiplier; it was wrong about what one unit of it
      // was worth.
      const sens = this.settings.sensitivity / CONFIG.LOOK_SENSITIVITY_MIDDLE;
      const s = sens * CONFIG.LOOK_DEGREES_PER_COUNT * (Math.PI / 180);
      player.yaw -= input.mouse.dx * s;
      player.pitch -= input.mouse.dy * s;

      // The stick, in the mouse's own units: degrees per second, scaled by the
      // same slider, integrated against the frame time. Sign conventions are
      // the mouse's too - a stick pushed right turns right, one pushed down
      // looks down - so both controls land in the same two numbers.
      const look = input.padLook();
      if (look && !uiOpen) {
        const ps = sens * look.x * (Math.PI / 180) * dt;
        const pt = sens * look.y * (Math.PI / 180) * dt;
        player.yaw -= ps;
        player.pitch -= pt;
      }

      // Vanilla stops the pitch a hair short of straight up or down rather than
      // exactly at it, so the view never locks dead vertical and the horizon
      // stays readable at full tilt.
      const limit = Math.PI / 2 - 0.001;
      player.pitch = Math.max(-limit, Math.min(limit, player.pitch));
    }

    /* ---- movement intent ---- */
    // two jump taps in a row toggle creative flight; the tap does nothing at
    // all in survival, where the mode has no flying ability
    //
    // The press is read once, here, because `pressed` is a latch and a second
    // read in the same frame comes back false. Both the flight double tap and the
    // jump itself want it, so the one answer goes to both.
    const jumpPressed = !uiOpen && input.pressed('jump');
    if (uiOpen) this._lastJumpTap = -10;
    else if (jumpPressed) this.handleJumpTap();

    const f = (input.down('forward') ? 1 : 0) - (input.down('back') ? 1 : 0);
    const r = (input.down('right') ? 1 : 0) - (input.down('left') ? 1 : 0);
    const intent = {
      forward: uiOpen ? 0 : f,
      right: uiOpen ? 0 : r,
      // Held, and that is the whole of it: a jump repeats on every landing, so
      // holding space while moving is a run of hops rather than one jump and then
      // nothing. Swimming and creative flight read the same held state, which is
      // right for both of them.
      jump: !uiOpen && input.down('jump'),
      sneak: !uiOpen && input.down('sneak'),
      // Sneaking is the controller's B, and sprinting is a full push of the
      // left stick - the way a console sprints, and the reason no one has to
      // be told to click a stick in.
      sprint: !uiOpen && (input.down('sprint') || this.input.padSprinting),
    };

    const wasInWater = player.inWater;

    player.update(dt, intent);
    if (player.inWater !== wasInWater) {
      if (player.inWater) audio.splash();
    }

    // Cursed world: directional gravity pulls the player every frame
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

    // Cursed world: sky ceiling damages players above it
    if (this._worldType === 'cursed' && player.position.y > 188 && !player.creative && !player.spectator) {
      this.survival.damage(2, 'generic');
    }

    /* ---- the boat the player is in ----
       Immediately after the player's own update, and before anything reads their
       position, because the boat *is* their position: the camera, the view
       model, the survival checks and the mob spawner all have to see the seat and
       not the last frame's feet. The player's own update has already taken its
       early exit by this point, so the two are never both moving the same body.

       The same argument says the order of the two lines above matters: the
       player samples the medium *before* the boat moves them, so a boat that has
       just carried them into a waterfall does not drown them on the same frame -
       one frame late is the difference between a warning and a bug report. */
    // One click, one answer. `input.pressed` latches per action for the frame, so
    // whichever system asks first consumes it and every system after it is told
    // the button was not pressed. Boats and mobs both want to know about an
    // attack, and the boats asked first, which meant a swing was spent on a boat
    // that was not there and the chicken in front of you could not be hit at all.
    // So it is read here, once, and handed to both.
    const attacking = input.pressed('attack') && !uiOpen;
    this.boats?.update(dt, player, intent, {
      attacking,
      drop: (item, count, pos) => this.itemDrops.spawn(pos.x, pos.y, pos.z, item, count, null),
    });
    // the beds, which rebuild themselves when the world's block entities have
    // moved rather than being told - one mesh per bed, off a version counter
    this.beds?.update();
    // and the chests, the same way, plus the lid of whichever one is open
    this.chests?.update(
      dt,
      this.screen?.kind === 'chest' ? this.screen.blockPos : null,
    );
    this._updateSleep(dt);
    // footsteps. A player in a boat has no feet, and the hull makes its own
    // noise, so there is nothing here to play.
    if (player.onGround && !player.riding) {
      const speed = Math.hypot(player.velocity.x, player.velocity.z);
      if (speed > 0.6) {
        const below = Blocks.get(world.getBlock(
          Math.floor(player.position.x), Math.floor(player.position.y - 0.2), Math.floor(player.position.z),
        ));
        audio.step(below);
        // walking slowly costs a trickle of exhaustion, sprinting a lot
        survival.addExhaustion((speed > 4.6 ? 0.5 : 0.06) * dt);
      }
    }
    if (player.jumpEvent) {
      player.jumpEvent = false;
      survival.addExhaustion(player.sprinting ? 0.2 : 0.05);
    }

    /* ---- interaction ---- */
    {
      this.interaction.updateTarget();
      this.target = this.interaction.target;
      this.interaction.tick(dt);

      const screenOpen = uiOpen;
      this.interaction.tickMining(dt, input.down('attack') && !screenOpen);
      this.interaction.tickEating(dt, input.down('useItem') && !screenOpen);

      // Attack only mines; opening a crafting table or a furnace is the use
      // action, the way it works in the real game.
      if (input.pressed('useItem') && !screenOpen) {
        if (!this.interaction.tryOpenBlock()) this.interaction.useItem();
      }
      if (input.pressed('pickBlock') && !screenOpen) this.interaction.pickBlock();
    }

    /* ---- a click that hits nothing still swings ---- */
    // Vanilla swings the hand on every attack press, whatever is under the
    // crosshair: a block, a chicken or thin air. Punching air is how you get a
    // swing at all, because a held button on a block is the mining loop and
    // takes its swings from there, and a click on a chicken takes one from the
    // mob's own hit. So this covers exactly the case the other two do not.
    //
    // `interaction.mining` is read as it stands here, which is the state the
    // previous frame's `tickMining` left - which is the state that matters,
    // since a swing that was going to start this frame has not started yet.
    if (attacking && !this.interaction.mining && !player.spectator) {
      this.viewModel.triggerSwing(this._heldWeapon()?.type ?? null);
    }

    // The chicken herd: wandering, being hit, and leaving what it leaves. Ahead
    // of the view model's own update below, because a hit has to put the held
    // item through its arc on the same frame the bird takes the damage - the
    // mob's swing goes in as a callback, and a callback fired after the pose
    // was written would show up a frame late, once per hit.
    //
    // `attacking` is the one read further up the frame, not a second
    // `input.pressed('attack')` - a second read would come back false, because
    // the first one consumed the press.
    const weapon = this._heldWeapon();
    this.mobs?.update(dt, player, attacking, (item, count, pos) => {
      this.itemDrops.spawn(pos.x, pos.y, pos.z, item, count, null);
    }, () => this.viewModel.triggerSwing(weapon?.type ?? null), weapon);

    /* ---- survival ---- */
    survival.update(dt);
    if (survival.level !== this._lastLevel) {
      if (survival.level > this._lastLevel) audio.levelUp();
      this._lastLevel = survival.level;
    }

    /* ---- furnaces ---- */
    this.tickFurnaces(dt);

    /* ---- the slow block changes ---- */
    // Grass creeping over dirt and seagrass living on the seabed. Driven off
    // the world tick counter so it runs at the vanilla rate whatever the frame
    // rate is, and skipped entirely while a menu owns the screen.
    if (this.state === STATE.PLAYING) {
      this.spreading.update(dt, Math.floor(world.time), player.position);
    }

    /* ---- world streaming ---- */
    world.updateTime(dt);
    world.update(player.position.x, player.position.z, this.chunkBudget, dt);
    world.applyPendingEntities();
    // The rain bed follows the weather's own eased intensity rather than its
    // settled kind, so a shower is heard building and clearing with the drops
    // rather than switching on and off. Driven here rather than from the world
    // because sound is a game-layer concern and the world does not know one
    // exists.
    audio.setRain(world.weather?.rainAmount ?? 0);
    if (this.hud.debugVisible) this.updateChunkStats();
    this._itemDropCount = this.itemDrops.count;

    /* ---- held item ---- */
    // A player in a boat has both hands on the oars, so there is nothing in
    // them. Showing the held stack anyway would put a boat - or whatever else -
    // floating in front of the camera over the boat the player is actually in.
    const held = player.riding ? null : inventory.held;
    // The light everything the player carries is standing in. The real game
    // lights the held item and the fist by the block they are at, so a torch in
    // an unlit cave lights the block in your hand and the same block under the
    // noon sun is bright. One lookup per frame; `lightColor` in Materials.js
    // runs the same vanilla ramp the terrain shader does, so the item and the
    // wall it is held against can never disagree.
    this._heldLight = this._heldLight ?? new THREE.Color(1, 1, 1);
    {
      const eye = player.eyePosition;
      const l = world.getLight(
        Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z),
      );
      lightColor(l >> 4, l & 15, this._heldLight);
    }
    this.viewModel.setItem(held ? held.name : null);
    // The same stack in the third person hand: the body hangs it off the right
    // arm and carries it through the walk and the swing, so the two views agree
    // about what is held without either knowing about the other.
    this.playerModel.setHeldItem(held ? held.name : null);
    this.viewModel.update(dt, {
      bob: this.settings.viewBobbing ? player.bobAmount : 0,
      phase: player.bobPhase,
      // the pose, not the key: a player held crouched because they cannot
      // stand has a low camera, so the arm has to come down with it
      sneaking: player.crouching,
      mining: this.interaction.mining,
      sprinting: player.sprinting,
      flying: player.flying,
      fallDistance: player.fallDistance,
      light: this._heldLight,
    });

    /* ---- the body ---- */
    // The same swing the held item is on, so the arm in third person and the
    // item in first person are mid-arc at the same moment. The sky's own
    // `dayLight` is a frame stale here, because the world is lit during render
    // and this runs before it - which is a frame of a smoothly changing value
    // and not something worth reordering the loop over.
    this.playerModel.update(dt, player, {
      playing: this.state === STATE.PLAYING,
      thirdPerson: this.thirdPerson,
      swing: this.viewModel.swinging ? this.viewModel.swing : 0,
      dayLight: this.sky?.dayLight ?? 1,
      // The block light at the player's own feet, which outranks the sky's
      // dimming for everything the player is wearing or holding.
      light: this._heldLight,
    });

    // The first person arm, once the model behind it has landed. Asked for
    // every frame and only built once, because the model arrives
    // asynchronously and until it does there is no arm to be had. Null in a
    // boat, where both hands are on the oars and the camera is behind you.
    this.viewModel.setArm(player.riding ? null : this.playerModel.firstPersonArm());

    this.updateCamera(dt);
    this.particles.update(dt, world);
    this.pearls.update(dt, world, player, (pos) => this._onPearlLands(pos));
    this.itemDrops.update(
      dt,
      player,
      (name, count) => this.inventory.add(name, count),
          (name, count) => {
            // pickup sound and "+count" message removed: silent pickup like chat
          },
          () => audio.bubble(),
        );

    /* ---- ambience ----
       Three beds, and which one is playing is a state, not an event: underwater
       while the head is in water, the hum of a portal while one is near, the
       cave rumble while somewhere dark, and nothing at all otherwise. Being
       underwater wins, so only ever one of them plays. */
    const under = player.headInWater;
    const px = Math.floor(player.position.x);
    const py = Math.floor(player.position.y);
    const pz = Math.floor(player.position.z);
    // sky light 4 or lower means the sky is genuinely blocked, which is the same
    // rule the real game uses to decide on cave ambience - except in the Nether,
    // where there is no sky light anywhere at all, so the rule would say the whole
    // dimension is buried and the rumble would never stop. The Nether is lit by
    // lava, glowstone and fire instead.
    const skyLight = world.getSky(px, py, pz);
    const buried = world.hasSky && !under && skyLight <= 4;

    // The hum of a lit portal, whenever one is near - not only when standing in
    // it, which is the rule the real game uses. Re-read a few times a second
    // rather than every frame: the check is a box of a few hundred cells, which
    // is nothing, but there is no reason to do it sixty times a second to start
    // and stop a hum.
    this._portalNearAt = (this._portalNearAt ?? 0) - dt;
    if (this._portalNearAt <= 0) {
      this._portalNearAt = 0.2;
      this._nearPortal = portalNearby(world, player.position, CONFIG.PORTAL.HUM_RANGE);
    }
    // being underwater wins: one bed at a time
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
    // The saving indicator outlives the write on purpose; see save().
    if (!this._saving && this._saveShownAt !== undefined && this._saveIndicatorDone()) {
      this.hud.setSaving(false);
    }
    this.chat.update(dt);
    this.statistics.update(dt, player);
    this.advancements.update(dt);

    this.autosave(dt);

    if (this.screen?.kind === 'furnace') this.screen.refresh();
  }

  /**
   * Periodic save, so progress survives a closed tab or a crash.
   *
   * Cheap when nothing has changed: `world.serialize` only walks chunks the
   * player has actually modified, so an untouched world writes an empty chunk
   * list rather than the whole terrain.
   */
  /**
   * Is there anything worth writing out?
   *
   * A block changed, the player moved, or a stat moved. Walking the whole world
   * to ask would cost more than just saving, so the block answer comes from a
   * flag the world raises itself and the rest is a couple of comparisons.
   */
  _isSaveNeeded() {
    for (const w of Object.values(this.worlds)) {
      if (w.editedSinceSave) return true;
      // This used to ask the flow sim how many cells it still had queued, which
      // meant a world with any liquid in it was permanently "changed" and got
      // fully re-encoded every ten seconds while the player stood still. What it
      // actually wants to know is whether a liquid cell was written since the last
      // save, which is what the sim now reports.
      if (w.fluid.dirtySinceSave) return true;
    }
    if (!this._savedPos) return true;
    // about two centimetres, so standing still is silent but walking is not
    if (this._savedPos.distanceToSquared(this.player.position) > 0.0004) return true;
    const s = this.survival;
    const stats = `${s.health}|${s.hunger}|${s.saturation}|${s.xp}|${s.level}|${s.exhaustion}`;
    if (stats !== this._savedStats) return true;
    if (this.inventory.version !== this._savedInventory) return true;
    return false;
  }

  /** Remember what was just written, so the next save can spot a change. */
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

  /**
   * Explode at a world position: blocks are destroyed by the world, loot and
   * particles are spilled, and anything close enough is hurt - player and mobs
   * alike. TNT caught in the blast lights its own fuse inside World.
   */
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

    // anything close enough takes the blast, dampened by distance
    const R = power * 2;
    if (player) {
      const dist = player.position.distanceTo(pos);
      if (dist < R && dist > 0) {
        survival.damage(Math.max(0, power * (1 - dist / R)) + 1, 'explosion');
        // knock the player back along the blast line
        const dir = new THREE.Vector3().subVectors(player.position, pos).normalize();
        const kick = Math.max(0, (1 - dist / R)) * 4;
        player.velocity?.addScaledVector(dir, kick);
        player.position.addScaledVector(dir, kick * 0.15);
      }
    }

    // mobs in range take the same blast, thrown away from the centre
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
      // counted the moment an item finishes, not every tick it sits there
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
    // A boat is only ever interesting from outside it, and the real game puts you
    // in third person the moment you sit down without asking. It is a local
    // override rather than a change to `thirdPerson` so that F5 still cycles
    // normally while you are in one, and so getting out does not leave the view
    // somewhere the player did not put it.
    const mode = player.riding && this.thirdPerson === 0 ? 1 : this.thirdPerson;

    /* ---- the head bob ---- */
    //
    // Java bobs the camera as well as the arm, and it is the bob that makes
    // walking feel like walking: a vertical bounce and a lateral sway a quarter
    // cycle out of step with it, both scaled by how fast the player is actually
    // going. The player's own `bobAmount` is the speed term and `bobPhase` is the
    // phase, so the view and the first-person arm are on the same cycle - which
    // they were not when the two had their own.
    //
    // It is applied in camera space, so the sway is sideways however the player
    // is facing, and it is scaled down while crouching exactly as vanilla scales
    // it down. Flying is the one case with no bob at all: a player holding the
    // jump key in creative would otherwise bob for ever, because the walk cycle
    // has nothing to stop it.
    //
    // The crosshair and everything the game aims with are still read off the
    // player's own yaw and pitch, so the target does not slide off the middle of
    // the screen while the view wobbles around it.
    let bobY = 0;
    let bobX = 0;
    if (this.settings.viewBobbing && mode === 0 && !player.flying && !player.spectator) {
      const amount = player.bobAmount * (player.crouching ? 0.3 : 1);
      bobY = Math.sin(player.bobPhase * 2) * 0.045 * amount;
      bobX = Math.cos(player.bobPhase) * 0.035 * amount;
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
      // Front view (mode 2): camera in front, looking at player's face
      // Use 0 pitch (horizontal) instead of player.pitch so camera stays focused on player
      // Back view (mode 1): follows player pitch for normal third-person feel
      const pitch = mode === 2 ? 0 : player.pitch;
      camera.rotation.set(pitch, player.yaw + (mode === 2 ? Math.PI : 0), 0);
    }

    if (bobX !== 0 || bobY !== 0) {
      // the camera's own right and up, so the offset follows where the player is
      // looking without the world having to know about it
      const right = this._bobRight.set(1, 0, 0).applyEuler(camera.rotation);
      const up = this._bobUp.set(0, 1, 0).applyEuler(camera.rotation);
      camera.position.addScaledVector(right, bobX);
      camera.position.addScaledVector(up, bobY);
    }

    /* ---- the sprinting field of view ---- */
    //
    // Vanilla widens the view by 10% while sprinting and eases it in and out over
    // a few ticks, which with the speed increase is most of why running *reads*
    // as running before you have looked at anything. A fraction of the FOV
    // rather than a fixed number of degrees, so it is ten percent of whatever
    // the player has chosen - and eased rather than switched, because a hard cut
    // at the moment the sprint key goes down looks like a bug rather than a
    // speed.
    const sprinting = mode === 0 && player.sprinting && !player.flying && !player.spectator;
    const want = this.settings.fov * (sprinting ? CONFIG.SPRINT_FOV_SCALE : 1);
    const fov = this._fovEased === undefined ? want : this._fovEased;
    const eased = fov + (want - fov) * (1 - Math.exp(-dt * 12));
    if (Math.abs(eased - camera.fov) > 0.005) {
      camera.fov = eased;
      camera.updateProjectionMatrix();
    }
    this._fovEased = eased;

    // Damage tilt: the view leans and dips briefly when you are hit. Set after
    // the pitch/yaw above so it is applied on top of the player's aim, and
    // eased rather than applied raw so the recovery reads as a wobble settling.
    const tilt = this.survival?.hurtTilt ?? 0;
    if (tilt > 0.001) {
      const e = tilt * tilt;                       // ease out: small hits barely lean
      camera.rotation.z = -this.survival.tiltSign * e * 0.14;
      camera.rotation.x -= e * 0.05;
    }
  }

  render() {
    const { sky, world, materials, camera } = this;

    if (world) {
      // The weather writes into the sky rather than the sky asking for it: the
      // sky recomputes its own colours every frame, so anything set before
      // `sky.update` would be read and then overwritten, and anything set after
      // would be one frame stale. Between the two is the only place a value
      // survives.
      const wx = world.weather;
      if (wx) {
        sky.overcast = wx.current.overcast;
        sky.dimming = wx.dimming;
      }
      const { dayLight } = sky.update(world.time, camera.position, this.elapsed);
      const range = sky.fogRange(this.settings.renderDistance);
      // Rain pulls the far plane in. It is the cheapest honest way to say
      // "you cannot see as far" - the drops are drawn either way, but a
      // landscape that stays crisp to the horizon under a downpour looks wrong
      // in a way that is hard to name.
      const wet = wx ? Math.max(wx.rainAmount, wx.current.snow * 0.4) : 0;
      const reach = 1 - wet * CONFIG.WEATHER.FOG_CUT;
      world.scene.fog.color.copy(sky.fogColor);
      world.scene.fog.near = range.near;
      world.scene.fog.far = range.far * reach;
      sky.setFogRange(range.near * 0.5, range.far * reach);
      materials.update(
        this.elapsed,
        // a lightning flash, added on top of the weather's own dimming rather
        // than replacing it - a storm at midnight still has to go dark
        Math.min(1, dayLight + wx?.lightning * CONFIG.WEATHER.LIGHTNING_FLASH),
        this.settings.brightness,
        this.player?.headInWater ? 1 : 0,
        // the dimension's ambient light level and its tint, which is what keeps
        // the Nether readable where nothing is lighting it
        sky.ambient,
        sky.ambientTint,
      );
    }

    /* ---- selection box + break overlay ----
       Three cases, in the order they can happen. A mob under the crosshair wins
       over the block behind it, because a bird three blocks away is inside a
       wall you are also looking at about half the time and the outline has to
       be on the thing you are about to hit. Otherwise the block, outlined as
       the shape it is actually drawn in - `setBlock` rather than a unit cube,
       so a flower is a panel and a slab is half a block.

       A mob only takes the outline when it is nearer than the block face, so
       aiming at the wall behind a chicken does not outline the chicken. */
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

    /* ---- the crosshair hint ----
       One line, one slot: whatever the player is looking at that has something
       to say about itself. A bed in daylight says it cannot be slept in; a
       sapling says whether it is growing or waiting for spring, which is a
       distinction the world cannot show on its own - a paused sapling looks
       exactly like a broken one.

       WALIA (What Am I Looking At): the panel under the crosshair. */
    const targetDef = this.target ? Blocks.get(this.target.id) : null;
    const walia = this.settings.walia !== false;
    let waliaData = null;
    let specificHint = null;
    if (this.state === STATE.PLAYING && !this.screen) {
      // WALIA: what is under the crosshair, as a block or as a mob
      if (walia) {
        const mob = this.mobs?.picked;
        const cell = this.target;
        if (mob && (!cell || this.mobs.pickedDist <= cell.dist)) {
          const info = [];
          // a countdown the player is actually watching. A chick grows into a
          // chicken and a chicken lays an egg; an adult has neither, so the lines
          // are absent rather than printed as zero
          if (mob.grow > 0) info.push(t('hud.walia.growth', waliaTime(mob.grow)));
          if (mob.variant.lays && mob.eggTimer > 0) {
            info.push(t('hud.walia.nextEgg', waliaTime(mob.eggTimer)));
          }
          waliaData = {
            name: mob.variant.label,
            // health in points, not hearts: the panel halves it, so a mob on an
            // odd point of health shows a half heart rather than rounding up
            health: mob.health,
            maxHealth: mob.variant.health ?? mob.health,
            info,
          };
        } else if (cell) {
          const def = Blocks.get(cell.id);
          if (def) {
            const info = [];
            // seconds until the sapling is a tree, while the wait is running. A
            // paused or untracked one returns null and is left to the hint line
            // below, which is the half that matters before spring
            const left = this.world?.growth?.progressAt(cell.x, cell.y, cell.z);
            if (left !== null && left !== undefined) {
              info.push(t('hud.walia.growth', waliaTime(left)));
            }
            waliaData = {
              name: Blocks.labelOf(def.name) || def.name || 'Unknown',
              icon: def.name,
              info,
              // how far through the swing the block is, so the panel carries the
              // same progress the crack overlay and the arm swing are showing
              breaking: this.interaction?.mining ? this.interaction.breakProgress : 0,
            };
          }
        }
      }
      // Specific hints (bed, sapling) take priority over WALIA name
      if (targetDef) {
        if (targetDef.interactive === 'bed') {
          if (!this.canSleep() && !this._sleeping) specificHint = t('hud.cannotSleep');
        } else if (this.world?.growth) {
          const state = this.world.growth.stateAt(this.target.x, this.target.y, this.target.z);
          if (state) specificHint = t(`hud.sapling${state === 'growing' ? 'Growing' : 'Waiting'}`);
        }
      }
    }
    this.hud?.walia(waliaData);
    this.hud?.hint(specificHint);

    if (this.interaction?.mining && this.target) {
      this.breakOverlay.show(
        this.target.x, this.target.y, this.target.z,
        Math.min(0.999, this.interaction.breakProgress),
      );
    } else {
      this.breakOverlay.hide();
    }

    this.renderer.info.reset();
    this.renderer.render(this.scene, camera);
    this.drawCalls = this.renderer.info.render.calls;
    this.triangles = this.renderer.info.render.triangles;

    // a spectator has no hand and no body, so the view model is not drawn
    if (this.state === STATE.PLAYING && this.thirdPerson === 0 && !this.player?.spectator) {
      this.viewModel.render(this.renderer);
    }
  }
}

/* ================================================================
   helpers
   ================================================================ */

/**
 * The liquid sheets tile independently of the block atlas, so they are built
 * as their own repeating textures rather than going through the atlas packer.
 */
function makeLiquidTexture(img) {
  const tex = new THREE.Texture(img);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  // Mipmapped, unlike the frame sheets below. Water and lava repeat across a
  // whole ocean, and an ocean is nearly always seen at a shallow angle, so
  // without a mip chain the far half of it is a boiling mess of aliased
  // texels. These tile rather than sit in an atlas, so there are no
  // neighbours to bleed in and no gutter is needed.
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = Math.min(4, MAX_ANISOTROPY);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * The nether portal frame sheet.
 *
 * Clamped rather than repeating, because the shader samples one cell out of the
 * grid and a repeat would blend the first and last frames together at the seam.
 *
 * Deliberately NOT mipmapped, unlike the block atlas and the liquids. This is a
 * grid of eight animation frames packed edge to edge, so it has the opposite
 * problem: mip level 1 halves every cell to 8x8, the filter footprint starts
 * reaching past the cell edges, and a portal cross-fades into the wrong frame
 * instead of into a neighbour block. Padding the grid would fix the bleed, but
 * it also means the shader's cell maths has to change, and a portal or a
 * campfire is always something you are standing next to - there is no distance
 * for a mip chain to earn its keep on. Nearest, no mipmaps, and the swirl keeps
 * all sixteen of its pixels.
 */
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

/**
 * The purple veil that covers the screen while a portal is carrying the player
 * between dimensions. Built in code rather than added to the markup so it has
 * no effect on the title screen or on any layout.
 */
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
