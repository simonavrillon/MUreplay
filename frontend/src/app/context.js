/**
 * The application context: one object every service and feature receives.
 *
 * The container creates it with the three singletons (state, els, api) and
 * merges each service's methods into it, so a feature reaches any
 * collaborator as `app.x()` without a hand-wired dependency list.
 */

/** @typedef {import("./state.js").State} State */
/** @typedef {import("./dom.js").Els} Els */
/** @typedef {ReturnType<typeof import("../api/client.js").createApiClient>} Api */
/** @typedef {import("./state.js").EditLogEntry} EditLogEntry */
/** @typedef {import("./state.js").ReplayBackup} ReplayBackup */
/** @typedef {"muted" | "success" | "error"} Tone */
/** @typedef {{ start: number, end: number }} Span */
/** @typedef {Record<string, any>} JsonObject A decoded backend JSON object whose fields are not typed. */

/**
 * @typedef {object} Core
 * @property {State} state
 * @property {Els} els
 * @property {Api} api
 */

/**
 * @typedef {object} UiService
 * @property {(text: string, tone?: Tone) => void} setStatus
 * @property {(text: string) => void} setEditStatus
 */

/**
 * @typedef {object} FileSessionService
 * @property {() => Promise<void>} onOpenDialog
 * @property {(filePath: string) => Promise<void>} onLoadByPath
 */

/**
 * @typedef {object} ReplayService
 * @property {(fn: () => void) => void} setRenderAll
 * @property {(event: Event) => void} onGridChange
 * @property {(event: Event) => void} onMuChange
 * @property {(direction: "prev" | "next") => void} goToMu
 * @property {(action: string) => void} adjustReplayView
 * @property {(event: Event) => void} onTimelineChange
 * @property {(delta: number) => void} moveStep
 * @property {() => void} togglePlay
 * @property {() => void} stopPlay
 * @property {() => void} updateTimelineUi
 * @property {() => void} applyTimelineStep
 * @property {() => void} initializeReplayFromLoadedData
 * @property {() => void} rebuildReplayGroups
 * @property {() => void} resetReplayForCurrentMu
 * @property {() => void} fillGridSelect
 * @property {(forceMu?: number | null) => void} fillMuSelect
 * @property {() => number} firstGridWithMu
 * @property {(gridIdx: number) => number[]} musForGrid
 * @property {() => import("./state.js").ReplayGroup[]} getActiveReplayGroups
 * @property {() => EditLogEntry | null} currentStep
 * @property {() => boolean} isCurrentMuStep
 * @property {() => number[]} pulseForCurrentMu
 * @property {() => number[]} distimesForCurrentMu
 * @property {() => number[]} artifactTimesForCurrentMu
 */

/** @typedef {Core & UiService & FileSessionService & ReplayService & Renderer} App */

/**
 * @typedef {object} Renderer
 * @property {() => void} renderAll
 */

export {};
