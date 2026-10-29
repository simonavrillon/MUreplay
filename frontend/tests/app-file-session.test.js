// Opening a session: the project tree, the data folder dialog, the load call, and the state it fills.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createFileSessionService } from "../src/app/services/file-session.js";

/**
 * @typedef {import("../src/app/context.js").App & {
 *   calls: any[],
 *   state: import("../src/state/state.js").State,
 * }} FakeApp
 */

/**
 * The App context with every member the service calls recorded in `calls`.
 *
 * @param {{
 *   loadPayload?: any,
 *   loadError?: Error,
 *   dialogResult?: any,
 *   dialogError?: Error,
 *   projects?: any,
 *   projectsError?: Error,
 * }} [opts]
 */
function createFakeApp(opts = {}) {
  /** @type {any[]} */
  const calls = [];
  const app = {
    // Empty, so a test sees only what the service wrote.
    state: /** @type {import("../src/state/state.js").State} */ (
      /** @type {unknown} */ ({})
    ),
    calls,
    api: {
      replayOpen: async (filePath) => {
        calls.push(["load", filePath]);
        if (opts.loadError) throw opts.loadError;
        return opts.loadPayload;
      },
      listProjects: async () => {
        if (opts.projectsError) throw opts.projectsError;
        return opts.projects;
      },
      chooseDataFolder: async () => {
        if (opts.dialogError) throw opts.dialogError;
        return opts.dialogResult;
      },
    },
    setReplayStatus: (text) => calls.push(["replayStatus", text]),
    showSessionSettings: (session) =>
      calls.push(["settings", session.entityLabel]),
    showProjects: (list) => calls.push(["projects", list]),
    showOpenedTrial: (path) => calls.push(["openedTrial", path]),
    startReplay: () => {
      calls.push(["startReplay", app.state.editHistory.length]);
      // The real replay builds the timeline from the log.
      app.state.timelineGroups = [];
    },
  };
  // Partial: the service reaches only for the members above.
  return /** @type {FakeApp} */ (/** @type {unknown} */ (app));
}

/**
 * Every replay status message pushed to the fake app, in order.
 * @param {FakeApp} app
 */
function replayStatuses(app) {
  return app.calls.filter((c) => c[0] === "replayStatus").map((c) => c[1]);
}

/**
 * Open `filePath`, as a click on its trial does.
 * @param {FakeApp} app
 * @param {string} [filePath]
 */
function openTrial(app, filePath = "/recordings/sub-01_edited.json") {
  return createFileSessionService(app).loadSession(filePath);
}

/** An opened session's frame, decoded, as `api.replayOpen` resolves it. */
function loadPayload(overrides = {}) {
  return {
    meta: {
      token: "t1",
      fsamp: 2048,
      total_samples: 4,
      grid_names: ["Grid 1"],
      mu_grid_index: [0],
      mu_uids: ["g0_mu0"],
      versions: [1],
      artifact_regions: [],
      edit_history: [],
      source_filename: "sub-01_decomp.npz",
      bids_root: "/data",
      entity_label: "sub-01_task-rest",
      ...overrides,
    },
    spikeTimes: [Int32Array.from([100, 300])],
  };
}

describe("loading a session", () => {
  test("fills the state, starts the replay and says what loaded", async () => {
    const app = createFakeApp({ loadPayload: loadPayload() });
    await openTrial(app);

    assert.equal(app.state.token, "t1");
    assert.deepEqual([...app.state.spikeTimes[0]], [100, 300]);
    assert.deepEqual(
      app.calls.find((c) => c[0] === "settings"),
      ["settings", "sub-01_task-rest"],
    );
    assert.ok(app.calls.some((c) => c[0] === "startReplay"));
    const statuses = replayStatuses(app);
    assert.equal(
      statuses[statuses.length - 1],
      "Loaded 1 MU and 0 replay steps.",
    );
  });

  test("imports an embedded edit history", async () => {
    const app = createFakeApp({
      loadPayload: loadPayload({
        edit_history: [
          { type: "add_spikes", mu_uid: "g0_mu0", spikes_added: [150] },
        ],
      }),
    });
    await openTrial(app);

    const { state } = app;
    assert.equal(state.editHistory.length, 1);
    assert.equal(state.editHistory[0].type, "add_spikes");
    assert.equal(state.editHistory[0].mu, 0);
    assert.deepEqual(state.editHistory[0].spikesAdded, [150]);
    assert.deepEqual(
      app.calls.find((c) => c[0] === "startReplay"),
      ["startReplay", 1],
    );
  });

  test("reports load failures on the replay status", async () => {
    const app = createFakeApp({
      loadError: new Error("file not found"),
    });
    await openTrial(app, "/recordings/missing.json");
    const statuses = replayStatuses(app);
    assert.equal(statuses[statuses.length - 2], "Loading the session…");
    assert.equal(
      statuses[statuses.length - 1],
      "Could not load the session: file not found",
    );
  });
});

describe("onChooseDataFolder", () => {
  test("redraws the tree from the folder picked", async () => {
    const projects = { projects: [], data_root: "/lab" };
    const app = createFakeApp({
      dialogResult: { data_root: "/lab" },
      projects,
    });
    await createFileSessionService(app).onChooseDataFolder();
    assert.ok(replayStatuses(app).includes("The data folder is now /lab."));
    assert.deepEqual(
      app.calls.find((c) => c[0] === "projects"),
      ["projects", { projects: [], dataRoot: "/lab" }],
    );
  });

  test("a dismissed dialog keeps the tree and says so", async () => {
    const app = createFakeApp({ dialogResult: { data_root: null } });
    await createFileSessionService(app).onChooseDataFolder();
    const statuses = replayStatuses(app);
    assert.equal(
      statuses[statuses.length - 1],
      "The data folder is unchanged.",
    );
    assert.equal(
      app.calls.some((c) => c[0] === "projects"),
      false,
    );
  });

  test("a failing dialog says why", async () => {
    const app = createFakeApp({ dialogError: new Error("no backend") });
    await createFileSessionService(app).onChooseDataFolder();
    const statuses = replayStatuses(app);
    assert.equal(
      statuses[statuses.length - 1],
      "Could not change the data folder: no backend",
    );
  });
});

describe("loadProjects", () => {
  test("draws the data folder's projects in the tree", async () => {
    const projects = [{ name: "Test", subjects: [] }];
    const app = createFakeApp({ projects: { projects, data_root: "/data" } });
    await createFileSessionService(app).loadProjects();
    assert.deepEqual(
      app.calls.find((c) => c[0] === "projects"),
      ["projects", { projects, dataRoot: "/data" }],
    );
  });

  test("a failing listing says why", async () => {
    const app = createFakeApp({ projectsError: new Error("no backend") });
    await createFileSessionService(app).loadProjects();
    assert.deepEqual(replayStatuses(app), [
      "Could not list the projects: no backend",
    ]);
  });
});

describe("loadSession", () => {
  test("opens a trial's edit log and marks the trial as opened", async () => {
    const path = "/data/Test/sub-1/decomp/sub-1_task-a_edited.json";
    const app = createFakeApp({ loadPayload: loadPayload() });
    await createFileSessionService(app).loadSession(path);
    assert.deepEqual(
      app.calls.find((c) => c[0] === "load"),
      ["load", path],
    );
    assert.ok(app.calls.some((c) => c[0] === "openedTrial" && c[1] === path));
  });

  test("a trial that fails to load stays unmarked", async () => {
    const app = createFakeApp({ loadError: new Error("file not found") });
    await createFileSessionService(app).loadSession("/data/x_edited.json");
    assert.equal(
      app.calls.some((c) => c[0] === "openedTrial"),
      false,
    );
  });
});
