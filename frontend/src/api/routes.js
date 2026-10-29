/**
 * The API's paths. The server serves the page and the API on one origin, so
 * `API_BASE` is relative to the page.
 */
export const API_BASE = "/api/v1";

export const routes = {
  replaySessionOpen: "/replay/session/open",
  replaySeek: "/replay/seek",
  replayPrepareGrid: "/replay/session/prepare-grid",
  seriesPulse: "/series/pulse",
  sessionClose: "/session/close",
  dialogDataFolder: "/dialog/data-folder",
  projects: "/projects",
};
