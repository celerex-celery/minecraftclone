/**
 * Adds or updates translation keys in the language files without hand editing
 * JSON. Run it after adding a new group of strings:
 *
 *   node tools/add-lang-keys.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'assets', 'lang');

const KEYS = {
  'debug.fps': { en: '%s fps', es: '%s fps' },
  'debug.chunks': { en: 'C: %s/%s (%s pending)', es: 'C: %s/%s (%s pendientes)' },
  'debug.drawCalls': { en: 'T: %s draw calls', es: 'L: %s llamadas de dibujo' },
  'debug.tris': { en: 'Tris: %sk', es: 'Tri: %sk' },
  'debug.drops': { en: 'Drops: %s', es: 'Objetos caidos: %s' },
  'debug.mem': { en: 'Mem: %s MB', es: 'Mem: %s MB' },
  'debug.xyz': { en: 'XYZ: %s / %s / %s', es: 'XYZ: %s / %s / %s' },
  'debug.block': { en: 'Block: %s %s %s', es: 'Bloque: %s %s %s' },
  'debug.chunkPos': { en: 'Chunk: %s %s', es: 'Chunk: %s %s' },
  'debug.facing': { en: 'Facing: %s', es: 'Mirando: %s' },
  'debug.biome': { en: 'Biome: %s', es: 'Bioma: %s' },
  'debug.light': { en: 'Sky/Block light: %s / %s', es: 'Luz cielo/bloque: %s / %s' },
  'debug.time': { en: 'Time: %s (%s)', es: 'Hora: %s (%s)' },
  'debug.seed': { en: 'Seed: %s', es: 'Semilla: %s' },
  'debug.target': { en: 'Target: %s @ %s %s %s', es: 'Objetivo: %s @ %s %s %s' },
  'debug.noTarget': { en: 'none', es: 'ninguno' },
  'debug.day': { en: 'day', es: 'dia' },
  'debug.night': { en: 'night', es: 'noche' },
  'debug.dir.south': { en: 'south', es: 'sur' },
  'debug.dir.west': { en: 'west', es: 'oeste' },
  'debug.dir.north': { en: 'north', es: 'norte' },
  'debug.dir.east': { en: 'east', es: 'este' },
  'debug.biome.ocean': { en: 'ocean', es: 'oceano' },
  'debug.biome.beach': { en: 'beach', es: 'playa' },
  'debug.biome.plains': { en: 'plains', es: 'llanura' },
  'debug.biome.forest': { en: 'forest', es: 'bosque' },
  'debug.biome.taiga': { en: 'taiga', es: 'taiga' },
  'debug.biome.snowy_plains': { en: 'snowy plains', es: 'llanura nevada' },
  'debug.biome.desert': { en: 'desert', es: 'desierto' },
  'debug.biome.savanna': { en: 'savanna', es: 'sabana' },
  'debug.biome.swamp': { en: 'swamp', es: 'pantano' },
  'debug.biome.mountains': { en: 'mountains', es: 'montanas' },
  'debug.biome.jungle': { en: 'jungle', es: 'selva' },

  'menu.worldList': { en: 'Select World', es: 'Elegir mundo' },
  'menu.noWorlds': { en: 'You have no worlds yet', es: 'Todavia no tienes mundos' },
  'menu.createNew': { en: 'Create New World', es: 'Crear mundo nuevo' },
  'menu.createWorld': { en: 'Create New World', es: 'Crear mundo nuevo' },
  'menu.editWorld': { en: 'Edit World', es: 'Editar mundo' },
  'menu.newWorld': { en: 'New World', es: 'Mundo nuevo' },
  'menu.play': { en: 'Play', es: 'Jugar' },
  'menu.edit': { en: 'Edit', es: 'Editar' },
  'menu.delete': { en: 'Delete', es: 'Borrar' },
  'menu.save': { en: 'Save', es: 'Guardar' },
  'menu.cancel': { en: 'Cancel', es: 'Cancelar' },
  'menu.back': { en: 'Back', es: 'Atras' },
  'menu.worldMissing': { en: 'That world could not be loaded', es: 'No se pudo cargar ese mundo' },
  'menu.worldDeleted': { en: 'World deleted', es: 'Mundo borrado' },
  'menu.worldMeta': {
    en: '%s / %s / %s     played %s     seed %s',
    es: '%s / %s / %s     jugado %s     semilla %s',
  },

  'create.name': { en: 'World Name', es: 'Nombre del mundo' },
  'create.seed': { en: 'Seed for the World Generator', es: 'Semilla del generador' },
  'create.seedPlaceholder': { en: 'leave blank for random', es: 'vacio para aleatoria' },
  'create.randomSeed': { en: 'Random', es: 'Aleatoria' },
  'create.create': { en: 'Create New World', es: 'Crear mundo nuevo' },
  'create.gameMode': { en: 'Game Mode', es: 'Modo de juego' },
  'create.worldType': { en: 'World Type', es: 'Tipo de mundo' },
  'create.difficulty': { en: 'Difficulty', es: 'Dificultad' },

  'create.survival': { en: 'Survival', es: 'Supervivencia' },
  'create.creative': { en: 'Creative', es: 'Creativo' },
  'create.default': { en: 'Default', es: 'Normal' },
  'create.flat': { en: 'Flat', es: 'Plano' },
  'create.amplified': { en: 'Amplified', es: 'Amplificado' },
  'create.peaceful': { en: 'Peaceful', es: 'Pacifico' },
  'create.easy': { en: 'Easy', es: 'Facil' },
  'create.normal': { en: 'Normal', es: 'Normal' },
  'create.hard': { en: 'Hard', es: 'Dificil' },

  'hud.modeLine': { en: '%s  /  %s', es: '%s  /  %s' },
  'hud.saved': { en: 'Game saved', es: 'Partida guardada' },
  'hud.saveFailed': { en: 'Save failed', es: 'No se pudo guardar' },
};

const fileFor = (code) => (code === 'es_es' ? 'es' : 'en');

for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
  const full = path.join(DIR, file);
  const table = JSON.parse(fs.readFileSync(full, 'utf8'));
  const lang = fileFor(table._meta?.code ?? 'en_us');

  for (const [key, variants] of Object.entries(KEYS)) {
    table[key] = variants[lang] ?? variants.en;
  }

  // keep a stable, readable order: _meta, languages, everything else, splash
  const ordered = {};
  if (table._meta) ordered._meta = table._meta;
  if (table.languages) ordered.languages = table.languages;
  for (const [k, v] of Object.entries(table)) {
    if (k === '_meta' || k === 'languages' || k === 'splash') continue;
    ordered[k] = v;
  }
  if (table.splash) ordered.splash = table.splash;

  fs.writeFileSync(full, `${JSON.stringify(ordered, null, 2)}\n`, 'utf8');
  console.log(`${file}: ${Object.keys(ordered).length} keys`);
}
