/**
 * Settings renderer: fills the settings rail's read-only fields with the
 * loaded session's, the fields MUedit2's settings panel shows: the BIDS
 * entities and sidecars, and the run settings the decomposition saved. A
 * field the session does not record is left blank.
 */

/** @typedef {import("../app/dom.js").Els} Els */
/** @typedef {import("../state/transitions.js").SessionPayload} SessionPayload */

/**
 * MUedit2's post-processing modes, with the hint its panel shows for each.
 * Its run sets `use_adaptive` or `full_trace`, never both.
 */
const POSTPROCESS_HINTS = {
  windowed:
    "Filters applied inside each analysis window only. Pulse trains are zero outside the ROI.",
  "full-trace":
    "Filters applied batch by batch across the whole recording, without adaptation. Units extend beyond the ROI.",
  adaptive:
    "Filters and whitening are adapted batch by batch across the whole recording.",
};

/**
 * A field's text: blank for a value the file leaves out or marks `n/a`.
 *
 * @param {unknown} value
 */
function text(value) {
  if (value == null) return "";
  const s = String(value).trim();
  return s.toLowerCase() === "n/a" ? "" : s;
}

/**
 * The `key-value` entities of a BIDS label, such as `sub-1_ses-1_task-x`.
 *
 * @param {string} label
 * @returns {Record<string, string>}
 */
function entityPairs(label) {
  /** @type {Record<string, string>} */
  const pairs = {};
  for (const part of label.split("_")) {
    const dash = part.indexOf("-");
    if (dash > 0) pairs[part.slice(0, dash)] = part.slice(dash + 1);
  }
  return pairs;
}

/**
 * The post-processing mode a run's flags name, or "" without them.
 *
 * @param {SessionPayload["parameters"]} parameters
 * @returns {keyof typeof POSTPROCESS_HINTS | ""}
 */
function postprocessMode({ useAdaptive, fullTrace }) {
  if (useAdaptive == null && fullTrace == null) return "";
  if (useAdaptive) return "adaptive";
  return fullTrace ? "full-trace" : "windowed";
}

/**
 * Show an On/Off toggle as the run left it, and the row of settings it reveals.
 *
 * @param {HTMLButtonElement} toggle
 * @param {HTMLElement} settings
 * @param {string} name
 * @param {unknown} on
 */
function showToggle(toggle, settings, name, on) {
  toggle.textContent = `${name}: ${on ? "On" : "Off"}`;
  toggle.setAttribute("aria-pressed", on ? "true" : "false");
  toggle.classList.toggle("on", !!on);
  settings.hidden = !on;
}

/**
 * One Muscle row per grid, as MUedit2 labels them.
 *
 * @param {Els} els
 * @param {unknown[]} muscleNames
 * @param {number} gridCount
 */
function renderMuscleRows(els, muscleNames, gridCount) {
  const rows = Array.from({ length: gridCount }, (_, i) => {
    const row = document.createElement("div");
    row.className = "form-row";
    const label = document.createElement("label");
    label.textContent = `Muscle Grid ${i + 1}`;
    label.htmlFor = `bidsMuscle_${i}`;
    const input = document.createElement("input");
    input.type = "text";
    input.id = `bidsMuscle_${i}`;
    input.readOnly = true;
    input.value = text(muscleNames[i]);
    row.append(label, input);
    return row;
  });
  els.bidsMuscleContainer.replaceChildren(...rows);
}

/**
 * @param {Els} els
 * @param {SessionPayload} session
 */
export function renderSessionSettings(els, session) {
  const entities = entityPairs(session.entityLabel);
  els.fileName.textContent = session.sourceFilename || "None";
  els.bidsProject.value =
    session.bidsRoot.split(/[\\/]/).filter(Boolean).pop() ?? "";
  els.bidsSubject.value = entities.sub ?? "";
  els.bidsSession.value = entities.ses ?? "";
  els.bidsAcquisition.value = entities.acq ?? "";
  els.bidsRun.value = entities.run ?? "";
  els.bidsTask.value = entities.task ?? "";

  const meta = session.sidecarMeta;
  els.bidsParticipantAge.value = text(meta.participantMeta.age);
  els.bidsParticipantSex.value = text(meta.participantMeta.sex);
  els.bidsParticipantHandedness.value = text(meta.participantMeta.handedness);
  renderMuscleRows(
    els,
    meta.muscleNames,
    Math.max(session.gridNames.length, meta.muscleNames.length),
  );
  els.bidsPlacementScheme.value = text(meta.placementScheme) || "Other";
  // The description belongs to the Other scheme, which requires it.
  els.bidsPlacementDescRow.hidden = els.bidsPlacementScheme.value !== "Other";
  els.bidsPlacementDescription.value = text(meta.placementSchemeDescription);
  els.bidsReferenceLocation.value = text(meta.referenceLocation);
  els.bidsGroundLocation.value = text(meta.groundLocation);
  els.bidsManufacturer.value = text(meta.manufacturer);
  els.bidsDeviceModel.value = text(meta.manufacturersModelName);
  els.fsamp.value = session.fsamp > 0 ? String(Math.round(session.fsamp)) : "";
  const powerline = Number(meta.powerlineFreq);
  els.bidsPowerlineFreq.value = powerline > 0 ? String(powerline) : "";

  const params = session.parameters;
  els.niter.value = text(params.niter);
  els.nwindows.value = text(params.nwindows);
  els.duplicatesthresh.value = text(params.duplicatesthresh);
  showToggle(
    els.peelOffToggle,
    els.peelOffSettings,
    "Peeloff",
    params.peelOffEnabled,
  );
  els.peelOffWindow.value =
    params.peelOffWin != null
      ? String(Math.round(params.peelOffWin * 1000))
      : "";
  const mode = postprocessMode(params);
  els.postprocessMode.value = mode;
  els.postprocessModeHint.textContent = mode ? POSTPROCESS_HINTS[mode] : "";
  els.silValue.value = text(params.silThr);
  showToggle(els.covToggle, els.covSettings, "COV tool", params.covFilter);
  els.covValue.value = text(params.covThr);
}
