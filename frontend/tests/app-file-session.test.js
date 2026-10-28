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
 * }} [opts]
 */
/**
 * @typedef {import("../src/app/context.js").App & {
 *   calls: any[],
 *   state: import("../src/state/state.js").State,
 * }} FakeApp
 */

function createFakeApp(opts = {}) {
  /** @type {any[]} */
  const calls = [];
  const app = {
    // The service populates state; it starts empty so a test sees exactly
    // what was written rather than what the fixture pre-filled.
    state: /** @type {import("../src/state/state.js").State} */ (
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
    startReplay: () => calls.push(["startReplay", app.state.history.length]),
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
    spike_times: [[100, 300]],
    fsamp: 2048,
    grid_names: ["Grid 1"],
    mu_grid_index: [0],
    source_filename: "sub-01_edited.json",
    ...overrides,
  };
}

describe("onLoadByPath", () => {
  test("populates state from the normalized payload", async () => {
    const app = createFakeApp({
      loadPayload: loadPayload({
        bids_root: "/data",
        entity_label: "sub-01_task-rest",
      }),
    });
    const service = createFileSessionService(app);
    await service.onLoadByPath("/recordings/sub-01_edited.json");

    const { state } = app;
    assert.equal(state.loadedFromDecomp, false);
    assert.equal(state.bidsRoot, "/data");
    assert.equal(state.entityLabel, "sub-01_task-rest");
    assert.equal(state.fsamp, 2048);
    assert.deepEqual(state.pulseTrains, [[0, 1, 0, 1]]);
    assert.deepEqual(state.spikeTimes, [[100, 300]]);
    assert.deepEqual(state.gridNames, ["Grid 1"]);
    assert.deepEqual(state.muGridIndex, [0]);
    assert.deepEqual(state.muUids, ["g0_mu0"]);
    assert.deepEqual(state.refitSettings, {
      nbextchan: 1000,
      peelOffWin: 0.025,
      computeDtype: "float32",
    });
    // Nothing of a previous session's log or timeline survives the load.
    assert.deepEqual(state.history, []);
    assert.deepEqual(state.replayGroups, []);
    assert.deepEqual(state.muMarks, {});
  });

  test("starts the replay through the app context", async () => {
    const app = createFakeApp({ loadPayload: loadPayload() });
    const service = createFileSessionService(app);
    await service.onLoadByPath("/recordings/sub-01_edited.json");

    assert.ok(app.calls.some((c) => c[0] === "startReplay"));
    // The final status summarizes the loaded session.
    const statuses = editStatuses(app);
    assert.match(
      statuses[statuses.length - 1],
      /Loaded 1 MUs \+ 0 replay steps/,
    );
  });

  test("starts from the decomposition only when the edits started from it", async () => {
    /** @type {[string, boolean][]} */
    const cases = [
      ["sub-01_decomp.npz", true],
      ["sub-01_run-1_x_decomp.npz", true],
      // No _decomp.npz beside the log: the edited file stands in, and holds the edits.
      ["sub-01_edited.npz", false],
    ];
    for (const [source, fromDecomp] of cases) {
      const app = createFakeApp({
        loadPayload: loadPayload({ source_filename: source }),
      });
      await createFileSessionService(app).onLoadByPath("/r/sub-01_edited.npz");
      assert.equal(app.state.loadedFromDecomp, fromDecomp, source);
    }
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
    // The replay starts once the log is in place.
    assert.deepEqual(
      app.calls.find((c) => c[0] === "startReplay"),
      ["startReplay", 1],
    );
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
