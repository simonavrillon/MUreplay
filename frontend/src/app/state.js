/** @typedef {import("./context.js").JsonObject} JsonObject */
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
 * @property {{ start: number, end: number } | null} replayView
 * @property {boolean} loadedFromDecomp
 * @property {Record<string, string>} muMarks
 * @property {string[]} [muGhostUids]
 * @property {string} bidsRoot
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
  muMarks: {},
  bidsRoot: "",
  entityLabel: "",
  bidsEntityLabel: "",
  artifactTimes: [],
  replayBaseArtifactTimes: [],
  artifactRegions: [],
};
