export const els = {
  status: document.getElementById("status"),
  editStatus: document.getElementById("editStatus"),
  loadMenuBtn: document.getElementById("loadMenuBtn"),
  editMuGridSelect: document.getElementById("editMuGridSelect"),
  editMuSelect: document.getElementById("editMuSelect"),
  prevStepBtn: document.getElementById("prevStepBtn"),
  playPauseBtn: document.getElementById("playPauseBtn"),
  nextStepBtn: document.getElementById("nextStepBtn"),
  timelineSlider: document.getElementById("timelineSlider"),
  timelineCounter: document.getElementById("timelineCounter"),
  editDrCanvas: document.getElementById("editDrCanvas"),
  editPulseCanvas: document.getElementById("editPulseCanvas"),
};

export const state = {
  editedFilename: "",
  logFilename: "",
  fsamp: 2048,
  pulseTrains: [],
  distimes: [],
  gridNames: [],
  muGridIndex: [],
  muUids: [],
  currentGrid: 0,
  currentMu: 0,
  history: [],
  replayGroups: [],
  filteredReplayGroups: [],
  isPlaying: false,
  playTimer: null,
  editHistory: [],
  replayBaseDistimes: [],
  replayBasePulseTrains: [],
  replayPosition: 0,
  replayBackups: [],
  replayView: null,
  loadedFromDecomp: false,
  muMarks: {},
  bidsRoot: "",
  entityLabel: "",
  bidsEntityLabel: "",
};

export const COLORS = {
  primary: "#ffffff",
  warning: "#ffd43b",
  muted: "#b7b7b7",
};

export const UNIFORM_PULSE_COLOR = "#f5f5f5";
