// Colliders bucketed by location.
//
// There are about 138,000 of them — every building wall, tree, hedge and parked
// car — and both walking and driving used to test against all of them every
// frame. That cost 3.7ms a frame each. Each collider is registered in every
// cell its box covers, so a point test only has to look at the cell the point
// falls in.
//
// The grid is cached on the collider array itself so the player and the car
// share one build rather than paying for it twice: without that, getting into a
// car cost a visible 100ms hitch while a second copy was assembled.

const CELL = 16;                       // metres

export function colliderGrid(colliders) {
  const cached = colliders.__grid;
  if (cached && cached.n === colliders.length) return cached;

  const cells = new Map();
  for (const c of colliders) {
    const r = c.hx + c.hz;             // >= the half-diagonal, so never too small
    for (let gx = Math.floor((c.x - r) / CELL); gx <= Math.floor((c.x + r) / CELL); gx++) {
      for (let gz = Math.floor((c.z - r) / CELL); gz <= Math.floor((c.z + r) / CELL); gz++) {
        const k = gx + ',' + gz;
        const a = cells.get(k);
        if (a) a.push(c); else cells.set(k, [c]);
      }
    }
  }
  // `n` is how the cache spots a stale grid — the list changes when you take a
  // parked car out of it to drive away.
  const grid = { G: CELL, cells, n: colliders.length };
  Object.defineProperty(colliders, '__grid', { value: grid, configurable: true, enumerable: false });
  return grid;
}
