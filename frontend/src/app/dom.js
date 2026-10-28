// Typed handles for every element the app scripts; each id is in index.html.
/** @param {string} id */
const element = (id) =>
  /** @type {HTMLElement} */ (document.getElementById(id));
/** @param {string} id */
const button = (id) => /** @type {HTMLButtonElement} */ (element(id));
/** @param {string} id */
const input = (id) => /** @type {HTMLInputElement} */ (element(id));
/** @param {string} id */
const select = (id) => /** @type {HTMLSelectElement} */ (element(id));
/** @param {string} id */
const canvas = (id) => /** @type {HTMLCanvasElement} */ (element(id));

export const els = {
  status: element("status"),
  replayStatus: element("replayStatus"),
  loadMenuBtn: button("loadMenuBtn"),
  gridSelect: select("gridSelect"),
  muSelect: select("muSelect"),
  prevStepBtn: button("prevStepBtn"),
  playPauseBtn: button("playPauseBtn"),
  nextStepBtn: button("nextStepBtn"),
  timelineSlider: input("timelineSlider"),
  timelineCounter: element("timelineCounter"),
  dischargeRateCanvas: canvas("dischargeRateCanvas"),
  pulseTrainCanvas: canvas("pulseTrainCanvas"),
  timelineCanvas: canvas("timelineCanvas"),
};

/** @typedef {typeof els} Els */
