/**
 * Slash commands.
 *
 * The wording, colours and error cases follow the real game: `/give @s stone`
 * answers "Gave 1 Stone to Player", a bad item name is rejected, and an
 * unknown command points at /help. Everything runs on the local player, so
 * selectors are limited to @s and @p.
 */

import { CONFIG } from './Config.js';
import { t } from '../ui/Lang.js';
import { Items, creativeEntries } from '../world/Items.js';
import { Blocks } from '../world/Blocks.js';
import { DIFFICULTIES } from '../ui/WorldScreens.js';
import { resolveVariant, listVariants } from '../world/Mobs.js';
import { xpForLevel } from '../survival/Survival.js';

/** Vanilla chat colours. */
export const CHAT_COLORS = {
  chat: '#ffffff',
  system: '#aaaaaa',
  error: '#ff5555',
};

/* The game modes this build actually implements. Spectator is deliberately not
   in the Create World list - the real game hides it from the menu too, and it is
   only reachable with /gamemode spectator. */
const MODES = { survival: 'Survival', creative: 'Creative', spectator: 'Spectator' };

/** The time presets /time set understands, in Minecraft ticks. */
const TIME_PRESETS = CONFIG.TIME_PRESETS;
const DAY_TICKS = CONFIG.DAY_TICKS;

/** Everything the inventory can hold, so /give can refuse impossible counts. */
const MAX_GIVE = (9 + 27) * 64;

/** The hard experience cap, matching vanilla's level/XP practical ceiling. */
const MAX_XP = 9999;

/**
 * The real game's coordinate limit, which is what a vanilla command will accept
 * and refuse beyond. Not decoration: it is the same number, so a coordinate
 * pasted out of a real command is accepted here and a nonsense one is not.
 */
const TP_LIMIT = 32_000_000;

/**
 * Minecraft yaw to this game's.
 *
 * The two are measured from opposite ends. Minecraft's yaw puts 0 facing south
 * (+Z) and runs clockwise as seen from above; this game's look direction is
 * `(-sin y, 0, -cos y)`, so its 0 faces north (-Z) and it runs the other way.
 * Setting the two direction vectors equal gives y = 180 - m, and no constant
 * offset works, because the handedness differs as well as the origin.
 */
function degToYaw(deg) {
  return (180 - deg) * (Math.PI / 180);
}

/**
 * The first free cell at or above (x, y, z), so a destination inside a wall does
 * not put the player inside the wall.
 *
 * The real command nudges you clear rather than refusing, and the search is short
 * because a destination buried deep in a mountain is not a case worth refusing
 * over - up to two blocks, which covers the usual "one block too low".
 */
function findFreeY(world, x, y, z) {
  const MIN = world.constants.MIN_Y;
  const MAX = world.constants.MAX_Y;
  let at = Math.max(MIN + 1, Math.min(MAX - 2, Math.floor(y)));
  for (let i = 0; i <= 2; i++) {
    const yy = at + i;
    if (yy >= MAX - 1) break;
    if (!world.isSolid(x, yy, z) && !world.isSolid(x, yy + 1, z)) return yy;
  }
  return at;
}

/**
 * Run one chat line.
 *
 * @param {import('./Game.js').Game} game
 * @param {string} line the whole message, command slash included
 * @param {{print:(text:string,color?:string)=>void}} chat
 * @returns {boolean} true when the line was a command that ran
 */
export function runCommand(game, line, chat) {
  const body = line.slice(1).trim();
  if (!body) {
    chat.print(t('cmd.usage', 'help'), CHAT_COLORS.error);
    return true;
  }
  const [name, ...rest] = body.split(/\s+/);
  const handler = COMMANDS[name.toLowerCase()];
  if (!handler) {
    chat.print(t('cmd.unknown'), CHAT_COLORS.error);
    return true;
  }
  handler(game, rest, chat);
  return true;
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/** Split a command line into a raw argument list, honouring "quoted text". */
export function tokenize(text) {
  return text.match(/"[^"]*"|\S+/g)?.map((s) => s.replace(/^"|"$/g, '')) ?? [];
}

/** Parse an integer the way a command does: no floats, no leftovers. */
function parseCount(text) {
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : null;
}

/** Parse a signed integer for experience amounts. */
function parseXpAmount(text) {
  if (!/^-?\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : null;
}

/** Convert a total XP amount into (level, remaining XP) using the same
 *  per-level requirements Survival uses. */
function xpToLevel(xp) {
  let level = 0;
  let remaining = Math.max(0, xp);
  while (remaining >= 0) {
    const need = xpForLevel(level);
    if (remaining < need) break;
    remaining -= need;
    level++;
  }
  return { level, xp: remaining };
}

/** Accepts `stone`, `minecraft:stone` and `@s` style targets. */
function stripNamespace(name) {
  const i = name.indexOf(':');
  return i === -1 ? name : name.slice(i + 1);
}

/** Resolve an item or block name to an inventory name, or null. */
export function resolveItemId(name) {
  const id = stripNamespace(name.toLowerCase());
  if (Blocks.has(id) && Blocks.get(Blocks.id(id)).placeable) return id;
  if (Items.has(id)) return id;
  return null;
}

/** The display name vanilla would use for what was given. */
function itemLabel(name) {
  return Blocks.has(name) ? Blocks.label(Blocks.id(name)) : Items.label(name);
}

/** The local player, addressed by name, @s or @p. */
function resolveTarget(game, name) {
  const who = game.playerName;
  if (name === '@s' || name === '@p' || name.toLowerCase() === who.toLowerCase()) return who;
  return null;
}

/**
 * The mobs `/summon` knows how to make.
 *
 * The list comes from `Mobs.listVariants`, which derives it from the same
 * `VARIANTS` table `Mobs.resolveVariant` reads, so the two cannot drift apart:
 * adding a bird to the game and teaching the command about it are the same edit.
 * The label is what the chat confirmation calls it.
 *
 * This used to be a local `MOB_TYPES` object that had been deleted, leaving its
 * own doc comment orphaned above the cap below. Nothing caught it because the
 * only thing that read it was tab completion, and a throw inside the completion
 * pass is swallowed by the catch around it - so `/summon <TAB>` simply returned
 * nothing, and the completion pass gave up on every other command after it.
 */
const MOB_TYPES = listVariants();

/**
 * A coordinate: a plain number, or a tilde for an absolute one.
 *
 * A bare `~` is legal and means "this axis unchanged", which is what makes
 * `/summon chicken ~ ~ ~` the way to name the spot you are standing in. It is
 * also the form people reach for first, so rejecting it would be the wrong call.
 */
function isCoord(v) {
  return typeof v === 'string'
    && (/^-?\d+(\.\d+)?$/.test(v) || /^~(-?\d+(\.\d+)?)?$/.test(v));
}

/** Resolve one coordinate argument against the player's value on that axis. */
function resolveCoord(arg, base) {
  // no tilde means relative to the player, a tilde means absolute
  if (!String(arg).startsWith('~')) return base + Number(arg);
  const rest = String(arg).slice(1);
  return base + (rest === '' ? 0 : Number(rest));
}

function fail(chat, key, ...args) {
  chat.print(t(key, ...args), CHAT_COLORS.error);
}

function ok(chat, key, ...args) {
  chat.print(t(key, ...args), CHAT_COLORS.system);
}

/* ------------------------------------------------------------------ */
/* the commands                                                        */
/* ------------------------------------------------------------------ */

const COMMANDS = {
  /** /help */
  help(game, args, chat) {
    chat.print(t('cmd.help.header'), CHAT_COLORS.system);
    for (const [name, usage] of helpEntries()) {
      chat.print(`/${name} - ${usage}`, CHAT_COLORS.system);
    }
  },

  /**
   * /give <targets> <item> [count]
   *
   * Blocks and items share one namespace, the way they do in the real game, so
   * `stone` gives the block and `diamond_pickaxe` gives the tool.
   */
  give(game, args, chat) {
    const [targetArg, itemArg, countArg, ...extra] = args;
    if (!targetArg || !itemArg || extra.length) {
      fail(chat, 'cmd.give.usage');
      return;
    }
    if (!resolveTarget(game, targetArg)) {
      fail(chat, 'cmd.noPlayer');
      return;
    }
    const item = resolveItemId(itemArg);
    if (!item) {
      fail(chat, 'cmd.unknownItem', itemArg);
      return;
    }
    let count = 1;
    if (countArg !== undefined) {
      const parsed = parseCount(countArg);
      if (parsed === null) {
        fail(chat, 'cmd.invalidNumber', countArg);
        return;
      }
      count = Math.min(parsed, MAX_GIVE);
    }
    if (count === 0) {
      ok(chat, 'cmd.give.given', 0, itemLabel(item), game.playerName);
      return;
    }
    const left = game.inventory.add(item, count);
    ok(chat, 'cmd.give.given', count - left, itemLabel(item), game.playerName);
    if (left > 0) fail(chat, 'cmd.inventoryFull');
  },

  /** /gamemode <mode> [target] */
  gamemode(game, args, chat) {
    const [mode, targetArg, ...extra] = args;
    if (!mode || extra.length || (targetArg && !resolveTarget(game, targetArg))) {
      fail(chat, 'cmd.gamemode.usage');
      return;
    }
    const label = MODES[mode.toLowerCase()];
    if (!label) {
      fail(chat, 'cmd.unknownMode', mode);
      return;
    }
    game.setGameMode(mode.toLowerCase());
    ok(chat, 'cmd.gamemode.set', label);
  },

  /** /clear [target] */
  clear(game, args, chat) {
    const [targetArg, ...extra] = args;
    if (extra.length || (targetArg && !resolveTarget(game, targetArg))) {
      fail(chat, 'cmd.clear.usage');
      return;
    }
    game.inventory.slots.fill(null);
    game.inventory.armour.fill(null);
    game.inventory.touch();
    ok(chat, 'cmd.clear.done', game.playerName);
  },

  /** /time set|add|query <value> */
  time(game, args, chat) {
    const [action, valueArg, ...extra] = args;
    if (action === 'query') {
      ok(chat, 'cmd.time.set', Math.floor(game.world.time));
      return;
    }
    if (!valueArg || extra.length || (action !== 'set' && action !== 'add')) {
      fail(chat, 'cmd.time.usage');
      return;
    }
    const key = valueArg.toLowerCase();
    let value = TIME_PRESETS[key] ?? parseCount(valueArg);
    if (value === null || value === undefined) {
      fail(chat, 'cmd.invalidNumber', valueArg);
      return;
    }
    if (action === 'add') {
      // addTime, not `time = (time + value) % DAY_TICKS`: a delta of a whole
      // day wrapped the clock back to where it started and left the calendar
      // where it was, so the date and the clock quietly stopped agreeing.
      game.world.addTime(value);
      ok(chat, 'cmd.time.added', value);
    } else {
      // setTime, not a bare assignment: setting the clock to an earlier time
      // means the next dawn, so the date has to roll with it.
      game.world.setTime(value);
      ok(chat, 'cmd.time.set', game.world.time);
    }
  },

  /** /say <message> */
  say(game, args, chat) {
    if (!args.length) {
      fail(chat, 'cmd.usage', 'say <message>');
      return;
    }
    chat.print(t('cmd.say.format', game.playerName, args.join(' ')), CHAT_COLORS.chat);
  },

  /** /kill */
  kill(game, args, chat) {
    game.killPlayer('generic');
  },

  /** /list */
  list(game, args, chat) {
    ok(chat, 'cmd.list.players', game.playerName);
  },

  /** /seed */
  seed(game, args, chat) {
    ok(chat, 'cmd.seed', game.world.seed);
  },

  /**
   * /teleport <x> <y> <z> [yaw] [pitch]  -  and /tp, which is the same thing
   *
   * Minecraft's semantics, which two details of are worth being right about
   * because they are the ones people get wrong:
   *
   *   - the coordinates are *block* coordinates. `/tp 0 100 0` puts you in the
   *     middle of the block at 0, 100, 0, so at 0.5, 100, 0.5. Not on its
   *     corner, and not the block below.
   *   - yaw is Minecraft's convention, where 0 faces south (+Z), 90 west (-X),
   *     180 north (-Z) and 270 east (+X). This game's yaw is measured the
   *     other way round - its look direction is (-sin y, -cos y) against
   *     Minecraft's (-sin m, cos m) - so the two are related by y = 180 - m, and
   *     a raw number pasted in from a vanilla command would otherwise face the
   *     player 90 degrees out.
   *
   * Pitch is **negated**, because this game's pitch is measured the other way
   * round as well: its look direction is `(-sin y, sin p, -cos y)`, so a positive
   * pitch is looking *up* here, while Minecraft's -90 is up and +90 is down.
   * Passing the number through would point every vertical face the wrong way.
   * Yaw and pitch are both optional and the player keeps their current facing
   * when they are left off.
   *
   * A destination inside solid rock is moved to the first free cell above it,
   * which is what the real command does rather than suffocating the player.
   */
  teleport(game, args, chat) {
    const p = game.player;
    if (!p) return;

    // an optional leading target, exactly as the real command allows
    let rest = args;
    let targeted = false;
    if (rest.length >= 4 && resolveTarget(game, rest[0])) {
      if (!resolveTarget(game, rest[0])) {
        fail(chat, 'cmd.noPlayer');
        return;
      }
      rest = rest.slice(1);
      targeted = true;
    } else if (rest.length && !/^[+-]?\d*\.?\d+$/.test(rest[0])) {
      // a first word that is neither a number nor a target is a bad player name
      fail(chat, 'cmd.noPlayer');
      return;
    }

    const [xArg, yArg, zArg, yawArg, pitchArg, ...extra] = rest;
    if (rest.length < 3 || rest.length > 5 || extra.length) {
      fail(chat, 'cmd.teleport.usage');
      return;
    }
    const x = Number(xArg);
    const y = Number(yArg);
    const z = Number(zArg);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      fail(chat, 'cmd.invalidNumber', [xArg, yArg, zArg].find((v) => !Number.isFinite(Number(v))));
      return;
    }
    if (Math.abs(x) > TP_LIMIT || Math.abs(y) > TP_LIMIT || Math.abs(z) > TP_LIMIT) {
      fail(chat, 'cmd.teleport.tooFar', TP_LIMIT.toLocaleString('en-US'));
      return;
    }

    let yaw = p.yaw;
    let pitch = p.pitch;
    if (yawArg !== undefined) {
      const deg = Number(yawArg);
      if (!Number.isFinite(deg)) {
        fail(chat, 'cmd.invalidNumber', yawArg);
        return;
      }
      yaw = degToYaw(deg);
    }
    if (pitchArg !== undefined) {
      const deg = Number(pitchArg);
      if (!Number.isFinite(deg)) {
        fail(chat, 'cmd.invalidNumber', pitchArg);
        return;
      }
      pitch = -deg * (Math.PI / 180);
    }

    // a player in a boat owns no position of their own, so they have to be off
    // it first or the boat puts them straight back where they were
    game.dismountBoat();

    // block centre, not the corner
    const tx = Math.floor(x) + 0.5;
    const tz = Math.floor(z) + 0.5;
    const ty = findFreeY(game.world, Math.floor(x), Math.floor(y), Math.floor(z));

    p.position.set(tx, ty, tz);
    p.velocity.set(0, 0, 0);
    p.fallDistance = 0;
    p.yaw = yaw;
    p.pitch = pitch;
    game.world.settleSpawn(p.position);
    ok(chat, 'cmd.teleport.done',
      Math.floor(tx), Math.floor(ty), Math.floor(tz),
      (targeted ? game.playerName : game.playerName));
  },

  /**
   * /summon <entity> [<x> <y> <z>]
   *
   * The position follows the real command's rule, which is the one that catches
   * people out: **a bare number is relative to the player, and a tilde makes it
   * absolute.** So `/summon chicken` drops one where you stand, `/summon chicken 0
   * 5 0` is five blocks up and nowhere else, and `/summon chicken ~ ~ ~` is
   * exactly where you are - which is the only way to ask for a specific
   * coordinate without working out the offset from wherever you happen to be
   * standing.
   *
   * The chicken is dropped onto the ground under the spot rather than left in the
   * air, because a chicken hovering a block above the grass looks broken and
   * falls over a moment later anyway.
   */
  summon(game, args, chat) {
    const [name, xArg, yArg, zArg, ...extra] = args;
    if (!name) {
      fail(chat, 'cmd.summon.usage');
      return;
    }
    const mob = resolveVariant(stripNamespace(name));
    if (!mob) {
      fail(chat, 'cmd.unknownMob', name);
      return;
    }

    const hasPos = xArg !== undefined;
    if (extra.length || (hasPos && (yArg === undefined || zArg === undefined))) {
      fail(chat, 'cmd.summon.usage');
      return;
    }
    if (hasPos && ![xArg, yArg, zArg].every((v) => isCoord(v))) {
      fail(chat, 'cmd.invalidNumber', [xArg, yArg, zArg].find((v) => !isCoord(v)));
      return;
    }

    const p = game.player.position;
    const x = hasPos ? resolveCoord(xArg, p.x) : p.x;
    const y = hasPos ? resolveCoord(yArg, p.y) : p.y;
    const z = hasPos ? resolveCoord(zArg, p.z) : p.z;

    if (Math.abs(x) > TP_LIMIT || Math.abs(y) > TP_LIMIT || Math.abs(z) > TP_LIMIT) {
      fail(chat, 'cmd.teleport.tooFar', TP_LIMIT.toLocaleString('en-US'));
      return;
    }

    const made = game.mobs?.spawnAt(x, y, z, mob);
    if (!made) {
      fail(chat, 'cmd.summon.capped', game.mobs?.cap ?? 0);
      return;
    }
    ok(chat, 'cmd.summon.done', mob.label, Math.floor(x), Math.floor(made.y), Math.floor(z));
  },

  /** /difficulty <peaceful|easy|normal|hard> */
  difficulty(game, args, chat) {
    const [mode, ...extra] = args;
    const found = mode && DIFFICULTIES.find((d) => d.id === mode.toLowerCase());
    if (!found || extra.length) {
      fail(chat, 'cmd.difficulty.usage');
      return;
    }
    game.survival.difficulty = found.id;
    ok(chat, 'cmd.difficulty.set', t(`create.${found.id}`));
  },

  /**
   * /experience <add|set|query> <targets> <amount> [levels|points]
   *
   * Aliased as /xp. Only @s / @p targets are resolved, and all mutations apply
   * to the local player's survival stats.
   */
  experience(game, args, chat) {
    const [op, targetArg, amountArg, unit, ...extra] = args;
    if (op === 'query') {
      if (!targetArg) { fail(chat, 'cmd.experience.usage'); return; }
      if (!resolveTarget(game, targetArg)) { fail(chat, 'cmd.noPlayer'); return; }
      const unitLower = (unit || 'levels').toLowerCase();
      if (unitLower !== 'levels' && unitLower !== 'points') {
        fail(chat, 'cmd.experience.usage'); return;
      }
      const s = game.survival;
      if (unitLower === 'levels') {
        ok(chat, 'cmd.experience.query.levels', Math.min(9999, s.level));
      } else {
        ok(chat, 'cmd.experience.query.points', Math.min(9999, s.xp));
      }
      return;
    }
    if (!op || !targetArg || !amountArg || extra.length) {
      fail(chat, 'cmd.experience.usage');
      return;
    }
    if (!resolveTarget(game, targetArg)) {
      fail(chat, 'cmd.noPlayer');
      return;
    }
    const amount = parseXpAmount(amountArg);
    if (amount === null) {
      fail(chat, 'cmd.invalidNumber', amountArg);
      return;
    }
    const unitLower = (unit || 'levels').toLowerCase();
    if (unitLower !== 'levels' && unitLower !== 'points') {
      fail(chat, 'cmd.experience.usage');
      return;
    }
    const s = game.survival;
    let doneKey, doneValue, doneType;
    if (op === 'add') {
      if (unitLower === 'levels') {
        s.level = Math.min(MAX_XP, Math.max(0, s.level + amount));
        doneKey = 'cmd.experience.add.levels';
        doneValue = s.level;
        doneType = 'levels';
      } else {
        s.addXp(amount);
        if (s.xp < 0) s.xp = 0;
        if (s.level > MAX_XP) { s.level = MAX_XP; s.xp = 0; }
        doneKey = 'cmd.experience.add.points';
        doneValue = s.xp;
        doneType = 'points';
      }
    } else if (op === 'set') {
      if (unitLower === 'levels') {
        s.level = Math.min(MAX_XP, Math.max(0, amount));
        s.xp = 0;
        doneKey = 'cmd.experience.set.levels';
        doneValue = s.level;
        doneType = 'levels';
      } else {
        const resolved = xpToLevel(Math.min(MAX_XP, Math.max(0, amount)));
        s.level = resolved.level;
        s.xp = resolved.xp;
        doneKey = 'cmd.experience.set.points';
        doneValue = Math.min(MAX_XP, Math.max(0, amount));
        doneType = 'points';
      }
    } else {
      fail(chat, 'cmd.experience.usage');
      return;
    }
    ok(chat, doneKey, doneValue, doneType);
  },

  /**
   * /advancement grant|revoke <targets> <everything|only|from|until|through|advancement>
   *
   * Mirrors vanilla's advancement command. Only @s/@p targets are supported.
   * grant: unlock advancement(s)
   * revoke: lock advancement(s)
   */
  advancement(game, args, chat) {
    const [action, targetArg, spec, ...extra] = args;
    if (!action || !targetArg || !spec || extra.length) {
      fail(chat, 'cmd.advancement.usage');
      return;
    }
    if (!resolveTarget(game, targetArg)) {
      fail(chat, 'cmd.noPlayer');
      return;
    }
    const adv = game.advancements;
    if (!adv) {
      fail(chat, 'cmd.advancement.noAdvancements');
      return;
    }

    const grant = action === 'grant';
    const revoke = action === 'revoke';
    if (!grant && !revoke) {
      fail(chat, 'cmd.advancement.usage');
      return;
    }

    if (spec === 'everything') {
      // Grant/revoke all advancements
      for (const a of adv.tree) {
        if (grant) adv.grant(a.id);
        else adv.revoke(a.id);
      }
      ok(chat, grant ? 'cmd.advancement.grant.everything' : 'cmd.advancement.revoke.everything');
      return;
    }

    // Find specific advancement
    const advancement = adv.tree.find((a) => a.id === spec);
    if (!advancement) {
      fail(chat, 'cmd.advancement.unknown', spec);
      return;
    }

    if (grant) {
      adv.grant(spec);
      ok(chat, 'cmd.advancement.grant.one', spec);
    } else {
      adv.revoke(spec);
      ok(chat, 'cmd.advancement.revoke.one', spec);
    }
  },
};

/**
 * /tp is /teleport.
 *
 * Both names, because the real game accepts both and a player coming from a
 * vanilla command will type either. Pointing one at the other rather than
 * duplicating it means the two can never disagree.
 */
COMMANDS.tp = COMMANDS.teleport;
COMMANDS.xp = COMMANDS.experience;

/** The /help listing, built on demand so the strings are already translated. */
function helpEntries() {
  return [
    ['help', t('cmd.help.help')],
    ['give <targets> <item> [count]', t('cmd.help.give')],
    ['gamemode <mode> [target]', t('cmd.help.gamemode')],
    ['clear [target]', t('cmd.help.clear')],
    ['time set|add <value>', t('cmd.help.time')],
    ['say <message>', t('cmd.help.say')],
    ['kill', t('cmd.help.kill')],
    ['list', t('cmd.help.list')],
    ['seed', t('cmd.help.seed')],
    ['difficulty <mode>', t('cmd.help.difficulty')],
    ['experience <add|set|query> <targets> <amount> [levels|points]', t('cmd.help.experience')],
    ['teleport <x> <y> <z> [yaw] [pitch]', t('cmd.help.teleport')],
    ['summon <entity> [<x> <y> <z>]', t('cmd.help.summon')],
    ['advancement grant|revoke <targets> <everything|advancement>', t('cmd.help.advancement')],
  ];
}

/** True when a line is a command rather than chat. */
export function isCommand(line) {
  return line.startsWith('/');
}

/* ================================================================
   Tab completion

   The real game completes the command name first, then each argument, and
   shows every candidate above the prompt when there is more than one. Each
   command says what its arguments can be, so /give completes block and item
   names while /gamemode completes game modes.
   ================================================================ */

/** Every command name, in the order /help lists them. */
export const COMMAND_NAMES = [
  'help', 'give', 'gamemode', 'clear', 'time', 'say', 'kill', 'list', 'seed', 'difficulty',
  'teleport', 'tp', 'summon', 'experience', 'xp', 'advancement',
];

/** What each argument position accepts. Index 0 is the first argument. */
const SUGGESTIONS = {
  give(args, token) {
    if (args.length === 0) return ['@s', '@p'];
    if (args.length === 1) return creativeEntries().map((e) => e.name);
    return [];
  },
  gamemode(args) {
    if (args.length === 0) return Object.keys(MODES);
    if (args.length === 1) return ['@s', '@p'];
    return [];
  },
  clear(args) {
    return args.length === 0 ? ['@s', '@p'] : [];
  },
  summon(args) {
    // the mob name, then nothing - the coordinates are typed by hand
    if (args.length === 0) return MOB_TYPES.map((m) => m.name);
    return [];
  },
  time(args) {
    if (args.length === 0) return ['set', 'add', 'query'];
    if (args.length === 1) {
      const sub = args[0].toLowerCase();
      if (sub === 'set' || sub === 'add' || sub === 'query') {
        return sub === 'query' ? [] : Object.keys(TIME_PRESETS);
      }
    }
    return [];
  },
  difficulty(args) {
    return args.length === 0 ? DIFFICULTIES.map((d) => d.id) : [];
  },
  experience(args) {
    if (args.length === 0) return ['add', 'set', 'query'];
    if (args.length === 1) return ['@s', '@p'];
    if (args.length === 2) return ['levels', 'points'];
    return [];
  },
  advancement(args) {
    if (args.length === 0) return ['grant', 'revoke'];
    if (args.length === 1) return ['@s', '@p'];
    if (args.length === 2) {
      const action = args[0].toLowerCase();
      if (action === 'grant' || action === 'revoke') {
        return ['everything', ...advList()];
      }
    }
    return [];
  },
};

/**
 * Known advancement IDs for tab completion.
 * These match the IDs in Advancements.js
 */
const ADVANCEMENT_IDS = [
  'root',
  'a_complete_catalogue',
  'getting_wood',
  'bake_bread',
  'a_balanced_diet',
  'sticky_situation',
  'getting_an_upgrade',
  'isnt_it_iron_pick',
  'acquire_hardware',
  'diamonds',
  'suit_up',
  'cover_me_with_diamonds',
  'survive_the_night',
  'a_three_day_hunt',
  'stone_age',
  'bench_crafting',
  'build_a_home',
  'time_to_mine',
  'a_seedy_place',
  'hot_stuff',
  'bucketful_of_cold',
  'we_need_to_go_deeper',
  'country_lode',
  'smelt_it',
  'adventuring_time',
  'adrenaline',
  'a_close_call',
  'living_on_a_breadline',
  'monster_hunter',
  'how_could_you',
];

function advList() {
  return ADVANCEMENT_IDS;
}

/**
 * What could complete the word the caret sits in.
 *
 * @param {string} line the whole chat line
 * @param {number} caret where the caret is, defaults to the end
 * @returns {{start:number, candidates:string[]}|null} null when nothing fits
 */
export function suggest(line, caret = line.length) {
  if (!line.startsWith('/')) return null;
  const upToCaret = line.slice(0, caret);
  // the command name is the only word before the first space after the slash
  const firstSpace = upToCaret.slice(1).search(/\s/);
  const isCommandName = firstSpace === -1;
  // the leading slash belongs to the command, never to the word being typed
  const word = /[^\s]*$/.exec(isCommandName ? upToCaret.slice(1) : upToCaret)?.[0] ?? '';
  const start = caret - word.length;

  let pool;
  if (isCommandName) {
    pool = COMMAND_NAMES;
  } else {
    const nameEnd = 1 + firstSpace;
    const name = upToCaret.slice(1, nameEnd).toLowerCase();
    const provider = SUGGESTIONS[name];
    if (!provider) return null;
    // the arguments already finished before the caret
    const done = tokenize(upToCaret.slice(nameEnd, start));
    pool = provider(done, word);
  }

  const candidates = pool.filter((c) => c.startsWith(word));
  return { start, candidates };
}

/**
 * The line with `candidate` filled in, ready to be typed over.
 *
 * @param {string} line
 * @param {number} start where the word being completed begins
 * @param {string} candidate
 */
export function applyCompletion(line, start, candidate) {
  return line.slice(0, start) + candidate + ' ';
}
