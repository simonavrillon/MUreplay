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
  replayStatus: element("replayStatus"),
  stepAudit: button("stepAudit"),
  stepMonitor: button("stepMonitor"),
  stageAudit: element("stageAudit"),
  stageMonitor: element("stageMonitor"),
  workspace: element("workspace"),
  settingsOverlay: element("settingsOverlay"),
  settingsPanel: element("settingsPanel"),
  settingsToggleBtn: button("settingsToggleBtn"),
  projectsHeader: element("projectsHeader"),
  projectTree: element("projectTree"),
  projectTreeHint: element("projectTreeHint"),
  dataFolderBtn: button("dataFolderBtn"),
  fileName: element("fileName"),
  bidsProject: input("bidsProject"),
  bidsSubject: input("bidsSubject"),
  bidsSession: input("bidsSession"),
  bidsAcquisition: input("bidsAcquisition"),
  bidsRun: input("bidsRun"),
  bidsTask: input("bidsTask"),
  bidsParticipantAge: input("bidsParticipantAge"),
  bidsParticipantSex: select("bidsParticipantSex"),
  bidsParticipantHandedness: select("bidsParticipantHandedness"),
  bidsMuscleContainer: element("bidsMuscleContainer"),
  bidsPlacementScheme: select("bidsPlacementScheme"),
  bidsPlacementDescRow: element("bidsPlacementDescRow"),
  bidsPlacementDescription: input("bidsPlacementDescription"),
  bidsReferenceLocation: input("bidsReferenceLocation"),
  bidsGroundLocation: input("bidsGroundLocation"),
  bidsManufacturer: input("bidsManufacturer"),
  bidsDeviceModel: input("bidsDeviceModel"),
  fsamp: input("fsamp"),
  bidsPowerlineFreq: select("bidsPowerlineFreq"),
  niter: input("niter"),
  nwindows: input("nwindows"),
  duplicatesthresh: input("duplicatesthresh"),
  peelOffToggle: button("peelOffToggle"),
  peelOffSettings: element("peelOffSettings"),
  peelOffWindow: input("peelOffWindow"),
  postprocessMode: select("postprocessMode"),
  postprocessModeHint: element("postprocessModeHint"),
  silValue: input("silValue"),
  covToggle: button("covToggle"),
  covSettings: element("covSettings"),
  covValue: input("covValue"),
  gridSelect: select("gridSelect"),
  muSelect: select("muSelect"),
  prevStepBtn: button("prevStepBtn"),
  playPauseBtn: button("playPauseBtn"),
  nextStepBtn: button("nextStepBtn"),
  timelineSlider: input("timelineSlider"),
  timelineSteps: element("timelineSteps"),
  timelineCounter: element("timelineCounter"),
  diffAdded: element("diffAdded"),
  diffRemoved: element("diffRemoved"),
  diffSquares: element("diffSquares"),
  editDrCanvas: canvas("editDrCanvas"),
  editPulseCanvas: canvas("editPulseCanvas"),
  editTimelineCanvas: canvas("editTimelineCanvas"),
};

/** @typedef {typeof els} Els */
