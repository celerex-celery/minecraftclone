import { CONFIG } from '../../core/Config.js';
import { Blocks } from './Blocks.js';
import { buildTree, treeHeight } from './TreeShapes.js';

const SAP = CONFIG.SAPLING;

const SAPLINGS = new Map();
for (const kind of Object.keys(SAP.TREES)) SAPLINGS.set(Blocks.id(`${kind}_sapling`), kind);

const SNOW = new Set(['snow_block']);
for (let i = 1; i <= 8; i++) SNOW.add(Blocks.id(`snow_${i}`));

class ChunkPicker {
  constructor(world) {
    this.world = world;
    this.list = [];
    this._size = -1;
  }

  all() {
    if (this.world.chunks.size !== this._size) {
      this._size = this.world.chunks.size;
      this.list = [...this.world.chunks.values()];
    }
    return this.list;
  }

  pick() {
    const list = this.all();
    if (!list.length) return null;
    return list[(Math.random() * list.length) | 0];
  }
}

export class SaplingSim {

  constructor(world) {
    this.world = world;
    this.picker = new ChunkPicker(world);
    this._scan = 0;

    this.pending = new Map();
  }

  kindOf(id) {
    return SAPLINGS.get(id) ?? null;
  }

  _needFor(kind, groundId) {
    const spec = SAP.TREES[kind];
    const f = spec.snowFactor;
    return f && SNOW.has(groundId) ? spec.grow * f : spec.grow;
  }

  update(dt) {

    if (this.world.dimension && this.world.dimension !== 'overworld') return;

    this._scan += SAP.SCAN_RATE * this.world.chunks.size * dt;
    let budget = Math.floor(this._scan);
    if (budget > SAP.MAX_PER_FRAME) budget = SAP.MAX_PER_FRAME;
    this._scan -= Math.floor(this._scan);
    for (let i = 0; i < budget; i++) this._scanColumn();

    this._advance(dt);
  }

  _scanColumn() {
    const c = this.picker.pick();
    if (!c) return;
    const x = c.ox + ((Math.random() * CONFIG.CHUNK_SIZE) | 0);
    const z = c.oz + ((Math.random() * CONFIG.CHUNK_SIZE) | 0);

    const w = this.world;
    for (let y = w.constants.MAX_Y; y >= w.constants.MIN_Y; y--) {
      const kind = this.kindOf(w.getBlock(x, y, z));
      if (!kind) continue;
      const key = `${x},${y},${z}`;

      if (this.pending.has(key)) return;
      if (!this._canGrow(x, y, z, kind)) return;
      this._remember(x, y, z, kind);
      return;
    }
  }

  _remember(x, y, z, kind) {
    const w = this.world;
    if (this.pending.size >= SAP.MAX_TRACKED) {
      const oldest = this.pending.keys().next().value;
      this.pending.delete(oldest);
    }
    this.pending.set(`${x},${y},${z}`, {
      kind,
      need: this._needFor(kind, w.getBlock(x, y - 1, z)),
      done: 0,
    });
  }

  _canGrow(x, y, z, kind) {
    const w = this.world;

    const soil = Blocks.get(w.getBlock(x, y - 1, z));
    if (!SAP.SOIL.includes(soil.name)) return false;

    if (w.lightLevel(x, y, z) < SAP.LIGHT) return false;

    for (let dy = 1; dy <= 5; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const above = Blocks.get(w.getBlock(x + dx, y + dy, z + dz));

          if (above.name !== 'air' && !above.replaceable && !above.cutout) return false;
        }
      }
    }
    return true;
  }

  _advance(dt) {
    if (this.pending.size === 0) return;

    for (const [key, s] of this.pending) {
      const [x, y, z] = key.split(',').map(Number);

      if (this.kindOf(this.world.getBlock(x, y, z)) !== s.kind) {
        this.pending.delete(key);
        continue;
      }

      s.done += dt;
      if (s.done < s.need) continue;
      this.pending.delete(key);
      this._grow(x, y, z, s.kind);
    }
  }

  _grow(x, y, z, kind) {
    const w = this.world;
    const height = treeHeight(Math.random());
    buildTree(kind, height, (dx, dy, dz, name, overwrite) => {
      const id = Blocks.id(name);
      if (!overwrite) {
        const there = Blocks.get(w.getBlock(x + dx, y + dy, z + dz));
        if (there.name !== 'air' && !there.replaceable) return;
      }
      w.setBlock(x + dx, y + dy, z + dz, id);
    });
  }

  stateAt(x, y, z) {
    const kind = this.kindOf(this.world.getBlock(x, y, z));
    if (!kind) return null;
    const tracked = this.pending.get(`${x},${y},${z}`);
    if (!tracked || !this._canGrow(x, y, z, kind)) return 'waiting';
    return 'growing';
  }

  progressAt(x, y, z) {
    const tracked = this.pending.get(`${x},${y},${z}`);
    if (!tracked) return null;

    if (this.kindOf(this.world.getBlock(x, y, z)) !== tracked.kind) return null;

    if (!this._canGrow(x, y, z, tracked.kind)) return null;
    return Math.max(0, tracked.need - tracked.done);
  }

  clear() {
    this.pending.clear();
  }
}