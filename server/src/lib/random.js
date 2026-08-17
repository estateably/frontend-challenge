/**
 * The seed data is generated with a fixed-seed PRNG so every candidate — and
 * every restart — sees the same ledger. Anchoring is by day: the dataset slides
 * forward as the calendar moves, but two runs on the same day are identical.
 */
export function createRandom(seed = 0x9e3779b9) {
  let state = seed >>> 0;

  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    /** Integer in [min, max]. */
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    /** True with probability `p`. */
    chance: (p) => next() < p,
    /** Rounds to the nearest 25 minor units so amounts look plausible, never 0. */
    amount: (min, max) => Math.max(25, Math.round((min + next() * (max - min)) / 25) * 25),
  };
}
