/**
 * The app state: its shape (typedefs) and the single `state` object.
 */
/** @typedef {import("../app/context.js").Span} Span */

/**
 * @typedef {object} EditLogEntry
 * @property {string} type
 * @property {string} muUid
 * @property {number} mu
 * @property {number | null} viewStart
 * @property {number | null} viewEnd
 * @property {number[]} spikesAdded
 * @property {number[]} spikesRemoved
 * @property {number[]} artifactsAdded
 * @property {number[]} artifactsRemoved
 * @property {boolean} usePeeloff
 * @property {boolean} lockSpikes
 * @property {boolean} flagged Whether a `flag_mu` step flags its MU (false unflags it).
 * @property {string} sourceMuUid The MU a `duplicate_mu` step's MU duplicates.
 * @property {string[]} removedMuUids The MUs a `remove_flagged` or `remove_duplicates` step removed.
 */

/**
 * @typedef {object} ReplayBackup
 * @property {number} mu
 * @property {number[]} spikes
 * @property {number[]} pulseTrain
 * @property {number[]} artifacts
 */

/**
 * @typedef {object} ReplayGroup
 * @property {number[]} indices
 * @property {string} type
 * @property {EditLogEntry} displayStep
 */

/**
 * The decomposition a replay starts from, one row per MU.
 *
 * @typedef {object} ReplayBase
 * @property {number[][]} spikeTimes
 * @property {number[][]} pulseTrains
 * @property {number[][]} artifactTimes
 */

/** @typedef {"flagged" | "duplicate" | "removed"} MuMark */

/**
 * How the decomposition was run, which a filter refit repeats; the backend
 * fills MUedit2's defaults where the file has none.
 *
 * @typedef {object} RefitSettings
 * @property {number} nbextchan
 * @property {number} peelOffWin Seconds.
 * @property {"float32" | "float64"} computeDtype
 */

/**
 * @typedef {object} State
 * @property {number} fsamp
 * @property {number[][]} pulseTrains
 * @property {number[][]} spikeTimes
 * @property {string[]} gridNames
 * @property {number[]} muGridIndex
 * @property {string[]} muUids
 * @property {number} currentGrid
 * @property {number} currentMu
 * @property {EditLogEntry[]} editHistory
 * @property {ReplayGroup[]} replayGroups
 * @property {ReplayGroup[]} timelineGroups The replay groups that touch the current MU.
 * @property {number | null} playTimer
 * @property {number[][]} replayBaseSpikeTimes
 * @property {number[][]} replayBasePulseTrains
 * @property {number} replayPosition
 * @property {ReplayBackup[]} replayBackups
 * @property {Span | null} replayView
 * @property {boolean} loadedFromDecomp Whether the decomposition is the one the edits started from (`_decomp.npz`).
 * @property {RefitSettings} refitSettings
 * @property {Record<string, MuMark>} muMarks
 * @property {string[]} muGhostUids Uids the log marks but the loaded file no longer has.
 * @property {string} bidsRoot The session's BIDS dataset: the file's location, else the server's data root.
 * @property {string} entityLabel The BIDS entity label of the session's recording.
 * @property {number[][]} artifactTimes One row per MU, like `spikeTimes`.
 * @property {number[][]} replayBaseArtifactTimes
 * @property {number[][]} artifactRegions
 */

/** @type {State} */
export const state = {
  fsamp: 2048,
  pulseTrains: [],
  spikeTimes: [],
  gridNames: [],
  muGridIndex: [],
  muUids: [],
  currentGrid: 0,
  currentMu: 0,
  editHistory: [],
  replayGroups: [],
  timelineGroups: [],
  playTimer: null,
  replayBaseSpikeTimes: [],
  replayBasePulseTrains: [],
  replayPosition: 0,
  replayBackups: [],
  replayView: null,
  loadedFromDecomp: false,
  refitSettings: { nbextchan: 0, peelOffWin: 0, computeDtype: "float32" },
  muMarks: {},
  muGhostUids: [],
  bidsRoot: "",
  entityLabel: "",
  artifactTimes: [],
  replayBaseArtifactTimes: [],
  artifactRegions: [],
};
