/**
 * Builds the app context: the core singletons with every service's members
 * merged in; see `context.js` for how it is shared.
 */
import { createFileSessionService } from "./services/file-session.js";
import { createReplayService } from "./services/replay-service.js";
import { createUiService } from "./services/ui.js";

/** @typedef {import("./context.js").App} App */

/**
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
