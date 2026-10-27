// A minimal DOM and page environment, enough to run the frontend modules in Node.
// Not a test file itself: `npm test` only runs tests/*.test.js.
import { readFileSync } from "node:fs";

/** The custom properties of css/tokens.css, with `var()` references resolved. */
function readTokens() {
  const css = readFileSync(
    new URL("../css/tokens.css", import.meta.url),
    "utf8",
  );
  /** @type {Map<string, string>} */
  const raw = new Map();
  for (const [, name, value] of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    raw.set(name, value.trim());
  }
  /** @param {string} value @returns {string} */
  const resolve = (value) =>
    value.replace(/var\((--[\w-]+)\)/g, (_, ref) =>
      resolve(raw.get(ref) ?? ""),
    );
  return new Map([...raw].map(([name, value]) => [name, resolve(value)]));
}

export const tokens = readTokens();

/** An element stand-in tracking its text, classes and inline custom properties. */
export function fakeElement() {
  /** @type {Set<string>} */
  const classes = new Set();
  return {
    textContent: "",
    value: "",
    disabled: false,
    classes,
    classList: {
      /** @param {...string} names */
      add: (...names) => names.forEach((n) => classes.add(n)),
      /** @param {...string} names */
      remove: (...names) => names.forEach((n) => classes.delete(n)),
      /** @param {string} name @param {boolean} [force] */
      toggle: (name, force) => {
        if (force) classes.add(name);
        else classes.delete(name);
      },
      /** @param {string} name */
      has: (name) => classes.has(name),
    },
    style: {
      /** @type {Record<string, string>} */
      props: {},
      /** @param {string} name @param {string} value */
      setProperty(name, value) {
        this.props[name] = value;
      },
    },
  };
}

/** A <select> stand-in: `innerHTML = ""` clears it, `appendChild` fills it. */
export function fakeSelect() {
  /** @type {any[]} */
  const children = [];
  return {
    children,
    value: "",
    set innerHTML(html) {
      if (!html) children.length = 0;
    },
    get innerHTML() {
      return "";
    },
    /** @param {any} child */
    appendChild(child) {
      children.push(child);
      return child;
    },
  };
}

/** Install `window`, `document` and `getComputedStyle` as the page has them. */
export function installDom() {
  globalThis.window = /** @type {any} */ ({
    location: { origin: "http://127.0.0.1:8000" },
    setInterval: () => 0,
    clearInterval: () => {},
  });
  globalThis.getComputedStyle = /** @type {any} */ (
    () => ({
      getPropertyValue: (/** @type {string} */ name) => tokens.get(name) ?? "",
    })
  );
  globalThis.document = /** @type {any} */ ({
    documentElement: fakeElement(),
    createElement: () => fakeElement(),
  });
}
