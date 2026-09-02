/**
 * Minimal browser stand-ins so the pure logic modules can be exercised in
 * JavaScriptCore. Must be imported before any module under test — ES module
 * evaluation follows import order, so this file runs first.
 */

const store = new Map();

globalThis.window = {
  localStorage: {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: k => { store.delete(k); },
    clear: () => store.clear(),
  },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
};
globalThis.localStorage = globalThis.window.localStorage;
globalThis.navigator = { userAgent: 'jsc-test', geolocation: undefined };
globalThis.location = { href: 'http://localhost/', search: '' };
globalThis.requestAnimationFrame = fn => fn();
globalThis.setTimeout = globalThis.setTimeout || (fn => fn());

/** Serve local files to `loadPlaques()` the way fetch would. */
globalThis.fetch = async (url) => {
  const path = url.startsWith('data/') ? `../${url}` : url;
  const text = readFile(path);
  return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
};

/** Direct handle to the fake storage, for assertions about persistence. */
export const rawStorage = store;
