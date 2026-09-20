// Typed handles for every element the app scripts. A missing id yields null,
// so callers keep their optional chaining.
/** @param {string} id */
const element = (id) => document.getElementById(id);
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
  editStatus: element("editStatus"),
  loadMenuBtn: button("loadMenuBtn"),
  editMuGridSelect: select("editMuGridSelect"),
  editMuSelect: select("editMuSelect"),
  prevStepBtn: button("prevStepBtn"),
  playPauseBtn: button("playPauseBtn"),
  nextStepBtn: button("nextStepBtn"),
  timelineSlider: input("timelineSlider"),
  timelineCounter: element("timelineCounter"),
  editDrCanvas: canvas("editDrCanvas"),
  editPulseCanvas: canvas("editPulseCanvas"),
  editTimelineCanvas: canvas("editTimelineCanvas"),
};

/** @typedef {typeof els} Els */
