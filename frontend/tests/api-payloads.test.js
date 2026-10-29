// Payload normalisation at the API boundary: opened sessions, log entries, seek changes,
// the picked data folder.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDataFolder,
  normalizeLogEntry,
  normalizeReplayChange,
  normalizeSessionPayload,
} from "../src/api/payloads.js";

/**
 * @param {Record<string, any>} entry
 * @param {string[]} [muUids]
 */
const normalized = (entry, muUids = []) => normalizeLogEntry(entry, muUids);

/** The meta of an opened session's frame, as the server sends it. */
function minimalMeta() {
  return {
    token: "t",
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
    entity_label: "sub-01",
  };
}

describe("normalizeSessionPayload", () => {
  test("reads the file fields and normalises the log against the session's uids", () => {
    const spikeTimes = [Int32Array.from([100, 300])];
    const session = normalizeSessionPayload({
      meta: {
        ...minimalMeta(),
        mu_uids: ["g0_mu7"],
        artifact_regions: [[10, 20]],
        edit_history: [{ type: "add_spikes", mu_uid: "g0_mu7" }],
      },
      spikeTimes,
    });
    assert.equal(session.token, "t");
    assert.equal(session.totalSamples, 4);
    assert.equal(session.spikeTimes, spikeTimes);
    assert.equal(session.sourceFilename, "sub-01_decomp.npz");
    assert.equal(session.bidsRoot, "/data");
    assert.equal(session.entityLabel, "sub-01");
    assert.deepEqual(session.artifactRegions, [[10, 20]]);
    assert.equal(session.editHistory.length, 1);
    assert.equal(session.editHistory[0].mu, 0);
  });
});

describe("normalizeReplayChange", () => {
  test("renames what a seek changed", () => {
    const spikeTimes = [Int32Array.from([5])];
    assert.deepEqual(
      normalizeReplayChange({
        meta: {
          changed: [2],
          versions: [1, 1, 4],
          refit_errors: [{ step: 3, message: "No EMG recording." }],
        },
        spikeTimes,
      }),
      {
        changed: [2],
        spikeTimes,
        versions: [1, 1, 4],
        refitErrors: [{ step: 3, message: "No EMG recording." }],
      },
    );
  });
});

describe("normalizeLogEntry", () => {
  test("fills missing fields", () => {
    // The backend passes the user's log entries through unchecked.
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

describe("normalizeDataFolder", () => {
  test("renames the picked folder, null when cancelled", () => {
    assert.deepEqual(normalizeDataFolder({ data_root: "/lab" }), {
      dataRoot: "/lab",
    });
    assert.deepEqual(normalizeDataFolder({ data_root: null }), {
      dataRoot: null,
    });
  });
});
