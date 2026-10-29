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
 * What a seek changed on the server.
 *
 * @typedef {object} ReplayChange
 * @property {number[]} changed The MUs whose rows moved.
 * @property {Int32Array[]} spikeTimes The discharges of each changed MU, in `changed`'s order.
 * @property {number[]} versions Every MU's version: a new one means its pulse train must be fetched again.
 * @property {{ step: number, message: string }[]} refitErrors Refits replayed from the log instead, and why.
 */

/**
 * @typedef {object} ReplayGroup
 * @property {number[]} indices
 * @property {string} type
 * @property {EditLogEntry} displayStep
 */

/** @typedef {"flagged" | "duplicate" | "removed"} MuMark */

/**
 * The replay as the page holds it: the server holds the pulse trains, and
 * `pulseView` the window of the current MU on screen.
 *
 * @typedef {object} State
 * @property {string} token The server's replay session; empty before one is open.
 * @property {number} fsamp
 * @property {number} totalSamples
 * @property {Int32Array[]} spikeTimes The discharges at the replay's position, one row per MU.
 * @property {number[]} versions Per MU; changes whenever a step moves it.
 * @property {import("../api/binary-payloads.js").PulseView | null} pulseView
 * @property {string[]} gridNames
 * @property {number[]} muGridIndex
 * @property {string[]} muUids
 * @property {number} currentGrid
 * @property {number} currentMu
 * @property {EditLogEntry[]} editHistory
 * @property {ReplayGroup[]} replayGroups
 * @property {ReplayGroup[]} timelineGroups The replay groups that touch the current MU.
 * @property {number | null} playTimer
 * @property {number} replayPosition
 * @property {Span | null} replayView
 * @property {Record<string, MuMark>} muMarks
 * @property {string[]} muGhostUids Uids the log marks but the loaded file no longer has.
 * @property {number[][]} artifactRegions
 */

/** @type {State} */
export const state = {
  token: "",
  fsamp: 2048,
  totalSamples: 0,
  spikeTimes: [],
  versions: [],
  pulseView: null,
  gridNames: [],
  muGridIndex: [],
  muUids: [],
  currentGrid: 0,
  currentMu: 0,
  editHistory: [],
  replayGroups: [],
  timelineGroups: [],
  playTimer: null,
  replayPosition: 0,
  replayView: null,
  muMarks: {},
  muGhostUids: [],
  artifactRegions: [],
};
