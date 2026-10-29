/**
 * The UI service: the header's status pill, where the replay reports; the
 * page stepper (Research, Clinic); and the settings rail: its open state, its
 * project tree and the session's fields.
 */

import { markOpenedTrial, renderProjectTree } from "../../view/project-tree.js";
import { renderSessionSettings } from "../../view/settings-renderer.js";

/** @typedef {import("../context.js").UiService} UiService */
/** @typedef {import("../context.js").StageKey} StageKey */

/**
 * @param {import("../context.js").App} app
 * @returns {UiService}
 */
export function createUiService(app) {
  const { els } = app;

  /** @type {UiService["setReplayStatus"]} */
  function setReplayStatus(text, tone = "muted") {
    els.replayStatus.textContent = text;
    els.replayStatus.dataset.tone = tone;
  }

  /** @type {Record<StageKey, [HTMLButtonElement, HTMLElement]>} */
  const stages = {
    research: [els.stepResearch, els.stageResearch],
    clinic: [els.stepClinic, els.stageClinic],
  };

  /** @type {UiService["switchStage"]} */
  function switchStage(target) {
    for (const [key, [chip, stage]] of Object.entries(stages)) {
      chip.classList.toggle("active", key === target);
      stage.classList.toggle("active", key === target);
    }
    positionStepIndicator();
    // A hidden stage's canvases have no size, so they draw once it shows.
    if (target === "research") app.renderAll();
  }

  /** @type {UiService["positionStepIndicator"]} */
  function positionStepIndicator() {
    const stepper = els.stepResearch.parentElement;
    const indicator = stepper?.querySelector(".step-indicator");
    const active = stepper?.querySelector(".step-chip.active");
    if (!(indicator instanceof HTMLElement)) return;
    if (!(active instanceof HTMLElement)) {
      indicator.classList.remove("ready");
      return;
    }
    indicator.classList.add("ready");
    indicator.style.left = `${active.offsetLeft}px`;
    indicator.style.top = `${active.offsetTop}px`;
    indicator.style.width = `${active.offsetWidth}px`;
    indicator.style.height = `${active.offsetHeight}px`;
  }

  /** @type {UiService["setSettingsOpen"]} */
  function setSettingsOpen(open) {
    els.workspace.classList.toggle("settings-open", open);
    els.settingsToggleBtn.setAttribute("aria-expanded", String(open));
  }

  /** @type {UiService["showSessionSettings"]} */
  function showSessionSettings(session) {
    renderSessionSettings(els, session);
  }

  /** @type {UiService["showProjects"]} */
  function showProjects(list) {
    renderProjectTree(els, list);
  }

  /** @type {UiService["showOpenedTrial"]} */
  function showOpenedTrial(path) {
    markOpenedTrial(els, path);
  }

  return {
    setReplayStatus,
    switchStage,
    positionStepIndicator,
    setSettingsOpen,
    showSessionSettings,
    showProjects,
    showOpenedTrial,
  };
}
