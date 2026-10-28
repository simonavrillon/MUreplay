/**
 * Reports caught errors: logs them, and shows them on a status line.
 */

/**
 * @param {unknown} err
 * @param {(text: string, tone?: import("../context.js").Tone) => void} setReplayStatus
 * @param {string} label  What failed, as a sentence: "Could not load the session"
 */
export function handleError(err, setReplayStatus, label) {
  console.error(err);
  setReplayStatus(`${label}: ${errorMessage(err)}`, "error");
}

/**
 * The message of a caught value, which need not be an Error.
 *
 * @param {unknown} err
 */
export function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}
