/**
 * The app state: its shape (typedefs) and the single `state` object.
 */
/** @typedef {import("../app/context.js").JsonObject} JsonObject */
/** @typedef {import("../app/context.js").Span} Span */
/** @typedef {JsonObject} EditHistoryEntry Raw edit-log entry from the backend or sidecar. */

/**
 * @typedef {object} EditLogEntry
 * @property {number} idx
 * @property {string} timestamp
 * @property {string} type
 * @property {string} muUid
 * @property {number} muIdx
 * @property {number | null} viewStart
 * @property {number | null} viewEnd
 * @property {number[]} spikesAdded
 * @property {number[]} spikesRemoved
 * @property {number[]} artifactsAdded
 * @property {number[]} artifactsRemoved
 * @property {boolean} usePeeloff
 * @property {boolean} lockSpikes
 * @property {number} [groupedCount]
 * @property {JsonObject} raw
 */

/**
 * @typedef {object} ReplayBackup
 * @property {number} stepIdx
 * @property {number} muIdx
 * @property {number[]} distimes
 * @property {number[]} pulseTrain
 * @property {number[]} artifactTimes
 */

/**
 * @typedef {object} ReplayGroup
 * @property {number[]} indices
 * @property {string} type
 * @property {EditLogEntry | null} displayStep
 */

/**
 * How the decomposition was run, which a filter refit repeats.
 *
 * @typedef {object} RefitSettings
 * @property {number} nbextchan
 * @property {number} peelOffWin Seconds.
 * @property {"float32" | "float64"} computeDtype
 */

/**
 * @typedef {object} State
 * @property {string} editedFilename
 * @property {string} logFilename
 * @property {number} fsamp
 * @property {number[][]} pulseTrains
 * @property {number[][]} distimes
 * @property {string[]} gridNames
 * @property {number[]} muGridIndex
 * @property {string[]} muUids
 * @property {number} currentGrid
 * @property {number} currentMu
 * @property {EditLogEntry[]} history
 * @property {ReplayGroup[]} replayGroups
 * @property {ReplayGroup[]} filteredReplayGroups
 * @property {boolean} isPlaying
 * @property {number | null} playTimer
 * @property {EditHistoryEntry[]} editHistory
 * @property {number[][]} replayBaseDistimes
 * @property {number[][]} replayBasePulseTrains
 * @property {number} replayPosition
 * @property {ReplayBackup[]} replayBackups
 * @property {Span | null} replayView
 * @property {boolean} loadedFromDecomp Whether the decomposition is the one the edits started from (`_decomp.npz`).
 * @property {RefitSettings} refitSettings
 * @property {Record<string, string>} muMarks
 * @property {string[]} muGhostUids Uids the log marks but the loaded file no longer has.
 * @property {string} bidsRoot The session's BIDS dataset, from the file's location.
 * @property {string} dataRoot The server's data root, used when the file names no dataset.
 * @property {string} entityLabel
 * @property {string} bidsEntityLabel
 * @property {number[][]} artifactTimes
 * @property {number[][]} replayBaseArtifactTimes
 * @property {number[][]} artifactRegions
 */

/** @type {State} */
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
  refitSettings: {
    nbextchan: 1000,
    peelOffWin: 0.025,
    computeDtype: "float32",
  },
  muMarks: {},
  muGhostUids: [],
  bidsRoot: "",
  dataRoot: "",
  entityLabel: "",
  bidsEntityLabel: "",
  artifactTimes: [],
  replayBaseArtifactTimes: [],
  artifactRegions: [],
};
