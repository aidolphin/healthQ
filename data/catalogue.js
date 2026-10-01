// data/catalogue.js - runtime view over the generated index.
//
// Loads data/search.js (compact, eager) and defers data/detail.js (the full
// nutrient maps) until a food detail panel is actually opened. That split is
// what keeps the first paint off the critical path.
//
// Ids stay stable. A day-log entry stores {foodId}, so lookups follow the
// generated remap when an id was folded away by the name merge.

import { rows, remap, meta } from './search.js';

const F = 1093; // sodium, FDC id

function hydrate(r) {
  const f = {
    id: r.i,
    name: r.n,
    category: r.c,
    energy: r.e,
    protein: r.p ?? null,
    carbs: r.cb ?? null,
    fat: r.f ?? null,
    fiber: r.fi ?? null,
    sugar: r.sg ?? null,
    water: r.w ?? null,
    sodium: r.na ?? null,
    fdcId: r.src ?? null,
    nepali: r.np ?? null,
    extra: r.x ?? '',
    aliases: r.a ?? [],
    // Populated lazily by loadNutrients().
    nutrients: null,
  };
  return f;
}

export const displayFoods = rows.map(hydrate);

const byId = new Map();
for (const f of displayFoods) byId.set(f.id, f);

// Resolve any id, following the remap when that row was merged away.
export function foodById(id) {
  if (byId.has(id)) return byId.get(id);
  const to = remap[id];
  if (to != null && byId.has(to)) return byId.get(to);
  return null;
}

// array-like shim so existing foods[e.foodId] call sites keep working
export const foods = new Proxy([], {
  get(_, prop) {
    if (typeof prop !== 'string') return undefined;
    const n = Number(prop);
    if (!Number.isInteger(n)) return undefined;
    return foodById(n) ?? undefined;
  },
  has(_, prop) {
    return byId.has(Number(prop)) || (remap[Number(prop)] != null && byId.has(remap[Number(prop)]));
  },
});

export const catalogue = {
  total: meta.indexed,
  unique: meta.total,
  groups: meta.groups,
  sources: meta.sources,
  years: meta.years || [],
};

export const categories = meta.groups;

// ── Lazy nutrient detail ────────────────────────────────────────────────────
let detailPromise = null;
let detailMap = null;

export function loadNutrients() {
  if (detailPromise) return detailPromise;
  detailPromise = import('./detail.js')
    .then(m => {
      detailMap = m.detail;
      for (const f of displayFoods) {
        if (f.nutrients == null) f.nutrients = detailMap[f.id] ?? {};
      }
      return detailMap;
    })
    .catch(() => {
      // A failed lazy load must not break the app; the panel just stays empty.
      detailPromise = null;
      for (const f of displayFoods) if (f.nutrients == null) f.nutrients = {};
      return {};
    });
  return detailPromise;
}

export const nutrientsLoaded = () => detailMap != null;

// Search haystack, precomputed once per row instead of on every keystroke.
const haystack = new Map();
for (const f of displayFoods) {
  haystack.set(f.id, `${f.name} ${f.nepali || ''} ${f.category} ${f.aliases.join(' ')} ${f.extra}`.toLowerCase());
}

export function searchFoods(q, cat) {
  const list = [];
  for (const f of displayFoods) {
    if (cat && cat !== 'All' && f.category !== cat) continue;
    if (q && !haystack.get(f.id).includes(q)) continue;
    list.push(f);
  }
  list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}
