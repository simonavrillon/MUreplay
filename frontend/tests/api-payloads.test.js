// Payload normalisation at the API boundary: loaded sessions, log entries, refit results.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildMuUids,
  normalizeLogEntry,
  normalizeRefitResult,
  normalizeSessionPayload,
} from "../src/api/payloads.js";

/**
 * `normalizeLogEntry`, asserted non-null.
 * @param {Record<string, any>} entry
 * @param {string[]} [muUids]
 */
function normalized(entry, muUids = []) {
  const result = normalizeLogEntry(entry, muUids);
  assert.ok(result, "expected a normalized entry");
  return result;
}

function minimalPayload() {
  return {
    pulse_trains: [[0, 1, 0, 1]],
    spike_times: [[100, 300]],
    fsamp: 2048,
    grid_names: ["Grid 1"],
    mu_grid_index: [0],
    parameters: {},
    edit_history: [],
    source_filename: "sub-01_decomp.npz",
    bids_root: "/data",
    entity_label: "sub-01",
  };
}

describe("normalizeSessionPayload", () => {
  test("reads the run's refit settings, with MUedit2's defaults", () => {
    const run = normalizeSessionPayload({
      ...minimalPayload(),
      parameters: {
        nbextchan: 640,
        peel_off_win: 0.02,
        compute_dtype: "float64",
      },
    });
    assert.deepEqual(run.refitSettings, {
      nbextchan: 640,
      peelOffWin: 0.02,
      computeDtype: "float64",
    });
    const odd = normalizeSessionPayload({
      ...minimalPayload(),
      parameters: { nbextchan: -3, peel_off_win: "x", compute_dtype: "int8" },
    });
    assert.deepEqual(odd.refitSettings, {
      nbextchan: 1000,
      peelOffWin: 0.025,
      computeDtype: "float32",
    });
  });

  test("fills the uids and artifact rows a file leaves out", () => {
    const normalized = normalizeSessionPayload(minimalPayload());
    assert.deepEqual(normalized.muUids, ["g0_mu0"]);
    assert.deepEqual(normalized.artifactTimes, [[]]);
    assert.deepEqual(normalized.artifactRegions, []);
  });

  test("keeps the log's mu uids only when it has one per MU", () => {
    const kept = normalizeSessionPayload({
      ...minimalPayload(),
      mu_uids: ["custom-uid"],
    });
    assert.deepEqual(kept.muUids, ["custom-uid"]);
    const built = normalizeSessionPayload({
      ...minimalPayload(),
      mu_grid_index: [1],
      mu_uids: ["a", "b"],
    });
    assert.deepEqual(built.muUids, ["g1_mu0"]);
  });

  test("reads artifact times as one row per MU", () => {
    const normalized = normalizeSessionPayload({
      ...minimalPayload(),
      spike_times: [[1], [2], [3], [4]],
      mu_grid_index: [0, 0, 0, 0],
      artifact_times: [[1, "2"], "bad", [3]],
    });
    assert.deepEqual(normalized.artifactTimes, [[1, 2], [], [3], []]);
  });

  test("reads the file fields and normalises the log against the session's uids", () => {
    const session = normalizeSessionPayload({
      ...minimalPayload(),
      mu_uids: ["g0_mu7"],
      artifact_regions: [[10, 20]],
      edit_history: [{ type: "add_spikes", mu_uid: "g0_mu7" }, "junk"],
    });
    assert.equal(session.sourceFilename, "sub-01_decomp.npz");
    assert.equal(session.bidsRoot, "/data");
    assert.equal(session.entityLabel, "sub-01");
    assert.deepEqual(session.artifactRegions, [[10, 20]]);
    assert.equal(session.editHistory.length, 1);
    assert.equal(session.editHistory[0].mu, 0);
  });
});

describe("normalizeLogEntry", () => {
  test("drops rows that are not objects and fills missing fields", () => {
    // The backend passes the user's log through unchecked.
    assert.equal(normalizeLogEntry(/** @type {any} */ (null), []), null);
    assert.equal(normalizeLogEntry(/** @type {any} */ ("step"), []), null);
    const entry = normalized({}, []);
    assert.equal(entry.type, "unknown");
    assert.equal(entry.muUid, "");
    assert.equal(entry.mu, -1);
    assert.equal(entry.viewStart, null);
    assert.equal(entry.viewEnd, null);
    assert.deepEqual(entry.spikesAdded, []);
    assert.deepEqual(entry.spikesRemoved, []);
    assert.deepEqual(entry.artifactsAdded, []);
    assert.deepEqual(entry.artifactsRemoved, []);
    assert.equal(entry.usePeeloff, false);
    assert.equal(entry.lockSpikes, false);
  });

  test("parses the artifact lists", () => {
    const entry = normalized(
      {
        type: "add_artifact",
        artifacts_added: [100, "200", "junk"],
        artifacts_removed: [300, 400],
      },
      [],
    );
    assert.deepEqual(entry.artifactsAdded, [100, 200]);
    assert.deepEqual(entry.artifactsRemoved, [300, 400]);
  });

  test("resolves mu from muUid", () => {
    const muUids = ["g0_mu0", "g0_mu1"];
    const entry = normalized({ mu_uid: "g0_mu1", type: "add_spikes" }, muUids);
    assert.equal(entry.mu, 1);
    // An unknown uid, or none, leaves the index at -1.
    assert.equal(normalized({ mu_uid: "nope" }, muUids).mu, -1);
    assert.equal(normalized({ type: "remove_flagged" }, muUids).mu, -1);
  });

  test("reads MUedit2's fields, lowercasing the type", () => {
    const entry = normalized(
      {
        timestamp: "2024-01-01T00:00:00Z",
        type: "Delete_Spikes",
        mu_uid: "g0_mu1",
        spikes_added: [1, 2, "3", 4],
        spikes_removed: [5, 6],
        view_start: "10.6",
        view_end: 99,
        use_peeloff: 1,
      },
      ["g0_mu0", "g0_mu1"],
    );
    assert.equal(entry.type, "delete_spikes");
    assert.equal(entry.mu, 1);
    assert.deepEqual(entry.spikesAdded, [1, 2, 3, 4]);
    assert.deepEqual(entry.spikesRemoved, [5, 6]);
    assert.equal(entry.viewStart, 11);
    assert.equal(entry.viewEnd, 99);
    assert.equal(entry.usePeeloff, true);
  });

  test("reads the fields of MU flag, duplicate and removal steps", () => {
    assert.equal(normalized({ type: "flag_mu" }).flagged, true);
    assert.equal(
      normalized({ type: "flag_mu", flagged: false }).flagged,
      false,
    );
    const duplicate = normalized({
      type: "duplicate_mu",
      source_mu_uid: "g0_mu1",
    });
    assert.equal(duplicate.sourceMuUid, "g0_mu1");
    const removal = normalized({
      type: "remove_flagged",
      removed_mu_uids: ["g0_mu0", 3],
    });
    assert.deepEqual(removal.removedMuUids, ["g0_mu0", "3"]);
    assert.deepEqual(normalized({ type: "remove_flagged" }).removedMuUids, []);
  });
});

describe("normalizeRefitResult", () => {
  test("renames the refit's discharges and pulse train", () => {
    assert.deepEqual(
      normalizeRefitResult({ spikes: [5], pulse_train: [0.5] }),
      {
        spikes: [5],
        pulseTrain: [0.5],
      },
    );
  });
});

describe("buildMuUids", () => {
  test("numbers MUs per grid, in file order", () => {
    const uids = buildMuUids([2, 0, 2, 2, 0]);
    assert.deepEqual(uids, ["g2_mu0", "g0_mu0", "g2_mu1", "g2_mu2", "g0_mu1"]);
  });
});
