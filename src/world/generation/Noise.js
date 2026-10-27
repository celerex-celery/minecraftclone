/**
 * Deterministic noise used by the world generator.
 * Improved Perlin noise (Ken Perlin, 2002) plus fBm / ridged helpers
 * and a fast integer hash.
 */

/* ---------- mulberry32: small seeded PRNG ---------- */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- 32-bit integer hash (xorshift finalizer) ---------- */
export function hash3(x, y, z, seed) {
  let h = seed ^ 0x9e3779b9;
  h = Math.imul(h ^ x, 0x85ebca6b);
  h = Math.imul(h ^ y ^ (h >>> 13), 0xc2b2ae35);
  h = Math.imul(h ^ z ^ (h >>> 16), 0x27d4eb2f);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export function hash2(x, z, seed) {
  return hash3(x, 0, z, seed);
}

/* ---------- Improved Perlin noise ---------- */

const GRAD3 = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
];

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(t, a, b) {
  return a + t * (b - a);
}

function grad(hash, x, y, z) {
  const g = GRAD3[hash & 15];
  return g[0] * x + g[1] * y + g[2] * z;
}

export class PerlinNoise {
  constructor(seed = 0) {
    const rand = mulberry32(seed || 1);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = (rand() * (i + 1)) | 0;
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  noise3D(xin, yin, zin) {
    const p = this.perm;

    const X = Math.floor(xin) & 255;
    const Y = Math.floor(yin) & 255;
    const Z = Math.floor(zin) & 255;

    const x = xin - Math.floor(xin);
    const y = yin - Math.floor(yin);
    const z = zin - Math.floor(zin);

    const u = fade(x);
    const v = fade(y);
    const w = fade(z);

    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
    const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;

    return lerp(w, lerp(v, lerp(u, grad(p[AA], x, y, z),
                                     grad(p[BA], x - 1, y, z)),
                             lerp(u, grad(p[AB], x, y - 1, z),
                                     grad(p[BB], x - 1, y - 1, z))),
                     lerp(v, lerp(u, grad(p[AA + 1], x, y, z - 1),
                                     grad(p[BA + 1], x - 1, y, z - 1)),
                             lerp(u, grad(p[AB + 1], x, y - 1, z - 1),
                                     grad(p[BB + 1], x - 1, y - 1, z - 1))));
  }

  noise2D(xin, yin) {
    return this.noise3D(xin, yin, 0);
  }

  /** Fractal Brownian motion, returns roughly -1..1 */
  fbm2(x, y, octaves = 4, lacunarity = 2, gain = 0.5, freq = 1) {
    let amp = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise2D(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  fbm3(x, y, z, octaves = 4, lacunarity = 2, gain = 0.5, freq = 1) {
    let amp = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise3D(x * freq, y * freq, z * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /** Ridged multifractal - good for mountain ranges and cave tunnels. */
  ridged3(x, y, z, octaves = 3, freq = 1) {
    let amp = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      const n = 1 - Math.abs(this.noise3D(x * freq, y * freq, z * freq));
      sum += amp * n * n;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }
}

/* ---------- seed helpers ---------- */

/**
 * A random seed, the way the real game hands one out: a plain number, roughly
 * half of them negative.
 *
 * The sign is kept in the text the player sees rather than folded away, so a
 * seed that is written down and typed back in resolves to the same world -
 * `seedFromString` reads a leading minus, and `World` coerces with `>>> 0`,
 * which maps every signed value onto a distinct 32-bit pattern.
 *
 * @returns {string} the seed as text, ready to drop into the seed field
 */
export function randomSeed() {
  // 10 digits either side of the decimal point: large enough that a random
  // world is very unlikely to repeat, small enough to stay readable
  const magnitude = Math.floor(Math.random() * 9_999_999_999);
  return Math.random() < 0.5 ? String(-magnitude) : String(magnitude);
}

/** Turn an arbitrary string into a 32-bit seed. */
export function seedFromString(str) {
  if (!str) return (Math.random() * 4294967295) >>> 0;
  const t = String(str).trim();
  if (/^-?\d+$/.test(t)) return (parseInt(t, 10) >>> 0) || 1;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
