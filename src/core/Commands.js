import { CONFIG } from './Config.js';
import { t } from '../ui/Lang.js';
import { Items, creativeEntries } from '../world/blocks/Items.js';
import { Blocks } from '../world/blocks/Blocks.js';
import { resolveVariant, listVariants } from '../world/mobs/Variants.js';
import { xpForLevel } from '../survival/Survival.js';

export const CHAT_COLORS = {
  chat: '#ffffff',
  system: '#aaaaaa',
  error: '#ff5555',
};

const MODES = { survival: 'Survival', creative: 'Creative', spectator: 'Spectator' };

const TIME_PRESETS = CONFIG.TIME_PRESETS;
const DAY_TICKS = CONFIG.DAY_TICKS;

const MAX_GIVE = (9 + 27) * 64;

const MAX_XP = 9999;

const TP_LIMIT = 32_000_000;

function degToYaw(deg) {
  return (180 - deg) * (Math.PI / 180);
}

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

export function runCommand(game, line, chat) {

  if (game.hardcore) {
    chat.print(t('cmd.hardcoreCheatsDisabled'), CHAT_COLORS.error);
    return true;
  }
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

export function tokenize(text) {
  return text.match(/"[^"]*"|\S+/g)?.map((s) => s.replace(/^"|"$/g, '')) ?? [];
}

function parseCount(text) {
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : null;
}

function parseXpAmount(text) {
  if (!/^-?\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : null;
}

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

function stripNamespace(name) {
  const i = name.indexOf(':');
  return i === -1 ? name : name.slice(i + 1);
}

export function resolveItemId(name) {
  const id = stripNamespace(name.toLowerCase());
  if (Blocks.has(id) && Blocks.get(Blocks.id(id)).placeable) return id;
  if (Items.has(id)) return id;
  return null;
}

function itemLabel(name) {
  return Blocks.has(name) ? Blocks.label(Blocks.id(name)) : Items.label(name);
}

function resolveTarget(game, name) {
  const who = game.playerName;
  if (name === '@s' || name === '@p' || name.toLowerCase() === who.toLowerCase()) return who;
  return null;
}

const MOB_TYPES = listVariants();

function isCoord(v) {
  return typeof v === 'string'
    && (/^-?\d+(\.\d+)?$/.test(v) || /^~(-?\d+(\.\d+)?)?$/.test(v));
}

function resolveCoord(arg, base) {

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

const COMMANDS = {

  help(game, args, chat) {
    chat.print(t('cmd.help.header'), CHAT_COLORS.system);
    for (const [name, usage] of helpEntries()) {
      chat.print(`/${name} - ${usage}`, CHAT_COLORS.system);
    }
  },

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

      game.world.addTime(value);
      ok(chat, 'cmd.time.added', value);
    } else {

      game.world.setTime(value);
      ok(chat, 'cmd.time.set', game.world.time);
    }
  },

  say(game, args, chat) {
    if (!args.length) {
      fail(chat, 'cmd.usage', 'say <message>');
      return;
    }
    chat.print(t('cmd.say.format', game.playerName, args.join(' ')), CHAT_COLORS.chat);
  },

  kill(game, args, chat) {
    game.killPlayer('generic');
  },

  list(game, args, chat) {
    ok(chat, 'cmd.list.players', game.playerName);
  },

  seed(game, args, chat) {
    ok(chat, 'cmd.seed', game.world.seed);
  },

  teleport(game, args, chat) {
    const p = game.player;
    if (!p) return;

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

    game.dismountBoat();

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

      for (const a of adv.tree) {
        if (grant) adv.grant(a.id);
        else adv.revoke(a.id);
      }
      ok(chat, grant ? 'cmd.advancement.grant.everything' : 'cmd.advancement.revoke.everything');
      return;
    }

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

COMMANDS.tp = COMMANDS.teleport;
COMMANDS.xp = COMMANDS.experience;

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

export function isCommand(line) {
  return line.startsWith('/');
}

export const COMMAND_NAMES = [
  'help', 'give', 'gamemode', 'clear', 'time', 'say', 'kill', 'list', 'seed', 'difficulty',
  'teleport', 'tp', 'summon', 'experience', 'xp', 'advancement',
];

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

export function suggest(line, caret = line.length) {
  if (!line.startsWith('/')) return null;
  const upToCaret = line.slice(0, caret);

  const firstSpace = upToCaret.slice(1).search(/\s/);
  const isCommandName = firstSpace === -1;

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

    const done = tokenize(upToCaret.slice(nameEnd, start));
    pool = provider(done, word);
  }

  const candidates = pool.filter((c) => c.startsWith(word));
  return { start, candidates };
}

export function applyCompletion(line, start, candidate) {
  return line.slice(0, start) + candidate + ' ';
}
