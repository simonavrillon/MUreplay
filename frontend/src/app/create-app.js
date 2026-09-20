import { createUiService } from "./services/ui.js";
import { createFileSessionService } from "./services/file-session.js";
import { createReplayService } from "./services/replay-service.js";

/** @typedef {import("./context.js").App} App */

/**
 * Build the application context; see `context.js` for how it is shared.
 *
 * @param {import("./context.js").Core} core
 * @returns {App}
 */
export function createApp(core) {
  const app = /** @type {App} */ (/** @type {unknown} */ ({ ...core }));
  const services = [
    createUiService(app),
    createFileSessionService(app),
    createReplayService(app),
  ];
  for (const service of services) {
    const clash = Object.keys(service).find((key) => key in app);
    if (clash) throw new Error(`Duplicate app member: ${clash}`);
    Object.assign(app, service);
  }
  return app;
}
