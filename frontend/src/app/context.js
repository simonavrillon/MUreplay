/**
 * The application context: one object every service and feature receives.
 *
 * The container creates it with the three singletons (state, els, api) and
 * merges each service's methods into it, so a feature reaches any
 * collaborator as `app.x()` without a hand-wired dependency list.
 */

/** @typedef {import("../state/state.js").State} State */
/** @typedef {import("./dom.js").Els} Els */
/** @typedef {ReturnType<typeof import("../api/client.js").createApiClient>} Api */
/** @typedef {"muted" | "error"} Tone */
/** @typedef {{ start: number, end: number }} Span */
/** @typedef {Record<string, any>} JsonObject A decoded backend JSON object whose fields are not typed. */

/** @typedef {{ name: string, path: string }} ProjectTrial A recording with an edit log; `path` is the log's. */

/**
 * @typedef {object} ProjectList The BIDS projects in the data folder, down to their trials.
 * @property {string} dataRoot
 * @property {{ name: string, subjects: { name: string, sessions: { name: string, trials: ProjectTrial[] }[] }[] }[]} projects
 *   A session's name is "" when its subject was recorded without sessions.
 */

/**
 * @typedef {object} Core
 * @property {State} state
 * @property {Els} els
 * @property {Api} api
 */

/** @typedef {"audit" | "monitor"} StageKey The pages the header's stepper switches between. */

/**
 * @typedef {object} UiService
 * @property {(text: string, tone?: Tone) => void} setReplayStatus
 * @property {(target: StageKey) => void} switchStage
 * @property {() => void} positionStepIndicator Slide the stepper's highlight under the active page.
 * @property {(open: boolean) => void} setSettingsOpen
 * @property {(session: import("../state/transitions.js").SessionPayload) => void} showSessionSettings Fill the settings rail with a loaded session's fields.
 * @property {(list: ProjectList) => void} showProjects Draw the rail's project tree.
 * @property {(path: string) => void} showOpenedTrial Mark the tree's trial whose edit log is at `path` as opened.
 */

/**
 * @typedef {object} FileSessionService
 * @property {() => Promise<void>} loadProjects Refresh the project tree from the data folder.
 * @property {(filePath: string) => Promise<void>} loadSession Open the session paired with `filePath`.
 * @property {() => Promise<void>} onOpenDialog
 */

/**
 * @typedef {object} ReplayService
 * @property {(event: Event) => void} onGridChange
 * @property {(event: Event) => void} onMuChange
 * @property {(direction: "prev" | "next") => void} goToMu
 * @property {(action: "zoom_in" | "zoom_out" | "scroll_left" | "scroll_right") => void} adjustReplayView
 * @property {(event: Event) => void} onTimelineChange
 * @property {(delta: number) => void} moveStep
 * @property {() => void} togglePlay
 * @property {() => void} startReplay Open the loaded session's timeline at step 0 of its first MU.
 * @property {() => void} updateTimelineUi
 */

/**
 * @typedef {object} Renderer
 * @property {() => void} renderAll
 */

/** @typedef {Core & UiService & FileSessionService & ReplayService & Renderer} App */

export {};
