// Opening a session: the file dialog, the load call, and the state it fills.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createFileSessionService } from "../src/app/services/file-session.js";

/**
 * A recording stand-in for the App context: every service method the
 * file-session collaborates with becomes an observable stub, and state
 * starts empty so the test sees exactly what the service populated.
 *
 * @param {{
 *   loadPayload?: any,
 *   loadError?: Error,
 *   dialogResult?: any,
 *   dialogError?: Error,
 *   musForGrid?: (gridIdx: number) => number[],
 * }} [opts]
 */
/**
 * @typedef {import("../src/app/context.js").App & {
 *   calls: any[],
 *   state: import("../src/app/state.js").State,
 * }} FakeApp
 */

function createFakeApp(opts = {}) {
  /** @type {any[]} */
  const calls = [];
  const app = {
    // The service populates state; it starts empty so a test sees exactly
    // what was written rather than what the fixture pre-filled.
    state: /** @type {import("../src/app/state.js").State} */ (
      /** @type {unknown} */ ({})
    ),
    calls,
    api: {
      loadPairedFromPath: async (filePath) => {
        calls.push(["load", filePath]);
        if (opts.loadError) throw opts.loadError;
        return opts.loadPayload;
      },
      openFileDialog: async () => {
        calls.push(["dialog"]);
        if (opts.dialogError) throw opts.dialogError;
        return opts.dialogResult;
      },
    },
    setEditStatus: (text) => calls.push(["editStatus", text]),
    setStatus: (text) => calls.push(["status", text]),
    initializeReplayFromLoadedData: () => calls.push(["initReplay"]),
    firstGridWithMu: () => 0,
    musForGrid: opts.musForGrid ?? (() => [0]),
    fillGridSelect: () => calls.push(["fillGrid"]),
    fillMuSelect: () => calls.push(["fillMu"]),
    stopPlay: () => calls.push(["stopPlay"]),
    updateTimelineUi: () => calls.push(["updateTimeline"]),
    applyTimelineStep: () => calls.push(["applyStep"]),
    renderAll: () => calls.push(["renderAll"]),
    rebuildReplayGroups: () => calls.push(["rebuildGroups"]),
    resetReplayForCurrentMu: () => calls.push(["resetReplay"]),
    getActiveReplayGroups: () => [],
  };
  // Partial on purpose: the service reaches only for the members above, and
  // this cast is the single place that says so. Add a call the service makes
  // but the fake lacks and the test fails on the missing stub, not here.
  return /** @type {FakeApp} */ (/** @type {unknown} */ (app));
}

/**
 * Every editStatus message pushed to the fake app, in order.
 * @param {FakeApp} app
 */
function editStatuses(app) {
  return app.calls.filter((c) => c[0] === "editStatus").map((c) => c[1]);
}

function loadPayload(overrides = {}) {
  return {
    pulse_trains: [[0, 1, 0, 1]],
    discharge_times: [[100, 300]],
    source_filename: "sub-01_edited.json",
    ...overrides,
  };
}

describe("onLoadByPath", () => {
  test("populates state from the normalized payload", async () => {
    const app = createFakeApp({
      loadPayload: loadPayload({
        bids_root: "/data",
        entity_label: "sub-01",
        bids_entity_label: "sub-01_task-rest",
      }),
    });
    const service = createFileSessionService(app);
    await service.onLoadByPath("/recordings/sub-01_edited.json");

    const { state } = app;
    assert.equal(state.editedFilename, "sub-01_edited.json");
    assert.equal(state.logFilename, "sub-01_edited.json");
    assert.equal(state.loadedFromDecomp, true);
    assert.equal(state.bidsRoot, "/data");
    assert.equal(state.entityLabel, "sub-01");
    assert.equal(state.bidsEntityLabel, "sub-01_task-rest");
    assert.equal(state.fsamp, 2048);
    assert.deepEqual(state.pulseTrains, [[0, 1, 0, 1]]);
    assert.deepEqual(state.distimes, [[100, 300]]);
    assert.deepEqual(state.gridNames, ["Grid 1"]);
    assert.deepEqual(state.muGridIndex, [0]);
    assert.deepEqual(state.muUids, ["g0_mu0"]);
    // Replay state is reset for the freshly loaded data.
    assert.deepEqual(state.editHistory, []);
    assert.deepEqual(state.history, []);
    assert.deepEqual(state.replayGroups, []);
    assert.equal(state.currentGrid, 0);
    assert.equal(state.currentMu, 0);
  });

  test("drives the replay UI through the app context", async () => {
    const app = createFakeApp({ loadPayload: loadPayload() });
    const service = createFileSessionService(app);
    await service.onLoadByPath("/recordings/sub-01_edited.json");

    const names = app.calls.map((c) => c[0]);
    assert.ok(names.includes("initReplay"));
    assert.ok(names.includes("fillGrid"));
    assert.ok(names.includes("fillMu"));
    assert.ok(names.includes("stopPlay"));
    assert.ok(names.includes("updateTimeline"));
    assert.ok(names.includes("applyStep"));
    assert.ok(names.includes("renderAll"));
    // The final status summarizes the loaded session.
    const statuses = editStatuses(app);
    assert.match(
      statuses[statuses.length - 1],
      /Loaded 1 MUs \+ 0 replay steps/,
    );
  });

  test("picks the first MU of the first grid with MUs", async () => {
    const app = createFakeApp({
      loadPayload: loadPayload(),
      musForGrid: () => [2, 5],
    });
    const service = createFileSessionService(app);
    await service.onLoadByPath("/recordings/sub-01_edited.json");
    assert.equal(app.state.currentMu, 2);
    assert.equal(app.state.currentGrid, 0);
  });

  test("falls back to the file basename", async () => {
    const app = createFakeApp({
      loadPayload: loadPayload({ source_filename: undefined }),
    });
    const service = createFileSessionService(app);
    await service.onLoadByPath("/recordings/sub-02_edited.json");
    assert.equal(app.state.editedFilename, "sub-02_edited.json");
    assert.equal(app.state.logFilename, "sub-02_edited.json");
  });

  test("takes the basename of a Windows path too", async () => {
    // The backend returns native paths, so a session opened on Windows arrives
    // with backslashes. Keeping the whole path here would send it on as the
    // BIDS entity label, which `getEntityLabel` infers from this filename.
    const app = createFakeApp({
      loadPayload: loadPayload({ source_filename: undefined }),
    });
    const service = createFileSessionService(app);
    await service.onLoadByPath("C:\\data\\sub-03_edited.json");
    assert.equal(app.state.editedFilename, "sub-03_edited.json");
    assert.equal(app.state.logFilename, "sub-03_edited.json");
  });

  test("imports an embedded edit history", async () => {
    const app = createFakeApp({
      loadPayload: loadPayload({
        edit_history: [
          { type: "add_spikes", mu_uid: "g0_mu0", spikes_added: [150] },
          "junk-entry",
        ],
      }),
    });
    const service = createFileSessionService(app);
    await service.onLoadByPath("/recordings/sub-01_edited.json");

    const { state } = app;
    assert.equal(state.history.length, 1);
    assert.equal(state.history[0].type, "add_spikes");
    assert.equal(state.history[0].muIdx, 0);
    assert.deepEqual(state.history[0].spikesAdded, [150]);
    // The raw history is preserved verbatim alongside the normalized one.
    assert.equal(state.editHistory.length, 2);
    // The replay pipeline is rebuilt for the imported history.
    const names = app.calls.map((c) => c[0]);
    assert.ok(names.includes("rebuildGroups"));
    assert.ok(names.includes("resetReplay"));
  });

  test("also accepts a history field alias", async () => {
    const app = createFakeApp({
      loadPayload: loadPayload({ history: [{ action: "delete_spikes" }] }),
    });
    const service = createFileSessionService(app);
    await service.onLoadByPath("/recordings/sub-01_edited.json");
    assert.equal(app.state.history.length, 1);
    assert.equal(app.state.history[0].type, "delete_spikes");
  });

  test("ignores blank paths without touching the API", async () => {
    const app = createFakeApp({ loadPayload: loadPayload() });
    const service = createFileSessionService(app);
    await service.onLoadByPath("   ");
    assert.equal(app.calls.length, 0);
  });

  test("reports load failures on the edit status", async () => {
    const app = createFakeApp({
      loadError: new Error("file not found"),
    });
    const service = createFileSessionService(app);
    await service.onLoadByPath("/recordings/missing.json");
    const statuses = editStatuses(app);
    assert.equal(statuses[0], "Loading...");
    assert.match(
      statuses[statuses.length - 1],
      /^Path load error: file not found$/,
    );
  });
});

describe("onOpenDialog", () => {
  test("loads the file chosen in the dialog", async () => {
    const app = createFakeApp({
      dialogResult: { path: "/recordings/sub-01_edited.json" },
      loadPayload: loadPayload(),
    });
    const service = createFileSessionService(app);
    await service.onOpenDialog();
    const loads = app.calls.filter((c) => c[0] === "load");
    assert.deepEqual(loads, [["load", "/recordings/sub-01_edited.json"]]);
  });

  test("handles dialog dismissal", async () => {
    const app = createFakeApp({ dialogResult: {} });
    const service = createFileSessionService(app);
    await service.onOpenDialog();
    const statuses = editStatuses(app);
    assert.equal(statuses[statuses.length - 1], "No file selected");
    assert.equal(
      app.calls.some((c) => c[0] === "load"),
      false,
    );
  });

  test("reports dialog failures", async () => {
    const app = createFakeApp({ dialogError: new Error("no backend") });
    const service = createFileSessionService(app);
    await service.onOpenDialog();
    const statuses = editStatuses(app);
    assert.match(statuses[statuses.length - 1], /^Dialog error: no backend$/);
  });
});
