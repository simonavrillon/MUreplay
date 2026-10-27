import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeEditedPayload,
  normalizeLogEntry,
} from "../src/api/payloads.js";

/**
 * `normalizeLogEntry` returns null for anything that is not an object, so
 * every test that goes on to read fields asserts that first and narrows.
 *
 * @param {Record<string, any>} entry
 * @param {number} [idx]
 * @param {string[]} [muUids]
 */
function normalized(entry, idx = 0, muUids = []) {
  const result = normalizeLogEntry(entry, idx, muUids);
  assert.ok(result, "expected a normalized entry");
  return result;
}

function minimalPayload() {
  return {
    pulse_trains: [[0, 1, 0, 1]],
    discharge_times: [[100, 300]],
  };
}

test("normalizeEditedPayload requires the core arrays", () => {
  assert.throws(() => normalizeEditedPayload({}), /pulse_trains/);
  assert.throws(
    () => normalizeEditedPayload({ pulse_trains: [[0]] }),
    /discharge_times/,
  );
});

test("normalizeEditedPayload applies defaults for optional fields", () => {
  const normalized = normalizeEditedPayload(minimalPayload());
  assert.equal(normalized.fsamp, 2048);
  assert.deepEqual(normalized.gridNames, ["Grid 1"]);
  assert.deepEqual(normalized.muGridIndex, [0]);
  assert.deepEqual(normalized.muUids, []);
  assert.deepEqual(normalized.artifactTimes, []);
  assert.deepEqual(normalized.artifactRegions, []);
});

test("normalizeEditedPayload accepts camelCase aliases", () => {
  const normalized = normalizeEditedPayload({
    pulseTrains: [[1, 0]],
    distimes: [[50]],
    fs: 1024,
  });
  assert.equal(normalized.fsamp, 1024);
  assert.deepEqual(normalized.pulseTrains, [[1, 0]]);
  assert.deepEqual(normalized.distimes, [[50]]);
});

test("normalizeEditedPayload normalizes numeric fields", () => {
  const normalized = normalizeEditedPayload({
    pulse_trains: [["1", "2"], "not-a-row"],
    discharge_times: [["5", null, "x"]],
    fsamp: "4096",
  });
  assert.equal(normalized.fsamp, 4096);
  assert.deepEqual(normalized.pulseTrains, [[1, 2], []]);
  assert.deepEqual(normalized.distimes, [[5, 0, 0]]);
});

test("normalizeEditedPayload keeps NaN out of the pulse trains", () => {
  // The plots scale to the pulse train's extent, and a single NaN there makes
  // the whole trace unrenderable, so junk coerces to 0 as it does for the
  // discharge times rather than propagating.
  const normalized = normalizeEditedPayload({
    pulse_trains: [[0.5, "junk", null, "0.25"]],
    discharge_times: [[100]],
  });
  assert.deepEqual(normalized.pulseTrains, [[0.5, 0, 0, 0.25]]);
});

test("normalizeEditedPayload builds mu uids when absent", () => {
  const normalized = normalizeEditedPayload(
    { ...minimalPayload(), mu_grid_index: [1] },
    (gridIndex) => gridIndex.map((g) => `g${g}_mu0`),
  );
  assert.deepEqual(normalized.muUids, ["g1_mu0"]);
});

test("normalizeEditedPayload keeps provided mu uids and grid names", () => {
  const normalized = normalizeEditedPayload({
    ...minimalPayload(),
    mu_uids: ["custom-uid"],
    mu_grid_index: [3],
    grid_names: ["Grid A"],
  });
  assert.deepEqual(normalized.muUids, ["custom-uid"]);
  assert.deepEqual(normalized.muGridIndex, [3]);
  assert.deepEqual(normalized.gridNames, ["Grid A"]);
});

test("normalizeEditedPayload falls back when grid index length mismatches", () => {
  const normalized = normalizeEditedPayload({
    ...minimalPayload(),
    mu_grid_index: [0, 1, 2],
  });
  assert.deepEqual(normalized.muGridIndex, [0]);
});

test("normalizeEditedPayload flattens artifact times", () => {
  const normalized = normalizeEditedPayload({
    ...minimalPayload(),
    artifact_times: [[1, "2"], "bad", [3]],
  });
  assert.deepEqual(normalized.artifactTimes, [[1, 2], [], [3]]);
});

test("normalizeArtifactRegions accepts pairs and start/end objects", () => {
  const normalized = normalizeEditedPayload({
    ...minimalPayload(),
    artifact_regions: [
      [10.4, 20.6],
      { start: 30, end: 40 },
      [50, 50], // empty region: dropped
      [60, 55], // inverted region: dropped
      { start: "x", end: "y" }, // non-numeric: dropped
      "junk",
    ],
  });
  assert.deepEqual(normalized.artifactRegions, [
    [10, 21],
    [30, 40],
  ]);
});

test("normalizeLogEntry returns null for non-object entries", () => {
  // Deliberately off-contract input: the log is backend JSON, so a row that
  // is not an object has to be survivable.
  const junk = /** @type {any} */ (null);
  assert.equal(normalizeLogEntry(junk, 0, []), null);
  assert.equal(normalizeLogEntry(/** @type {any} */ ("step"), 0, []), null);
});

test("normalizeLogEntry applies field defaults and aliases", () => {
  const entry = normalized({}, 2, []);
  assert.equal(entry.idx, 2);
  assert.equal(entry.timestamp, "step-3");
  assert.equal(entry.type, "unknown");
  assert.equal(entry.muUid, "");
  assert.equal(entry.muIdx, -1);
  assert.equal(entry.viewStart, null);
  assert.equal(entry.viewEnd, null);
  assert.deepEqual(entry.spikesAdded, []);
  assert.deepEqual(entry.spikesRemoved, []);
  assert.deepEqual(entry.artifactsAdded, []);
  assert.deepEqual(entry.artifactsRemoved, []);
  assert.equal(entry.usePeeloff, false);
  assert.equal(entry.lockSpikes, false);
});

test("normalizeLogEntry parses the artifact lists", () => {
  const entry = normalized(
    {
      type: "add_artifact",
      artifacts_added: [100, "200", "junk"],
      artifacts_removed: "300;400",
    },
    0,
    [],
  );
  assert.deepEqual(entry.artifactsAdded, [100, 200]);
  assert.deepEqual(entry.artifactsRemoved, [300, 400]);
});

test("normalizeLogEntry treats an empty mu_idx as absent, not as MU 0", () => {
  const muUids = ["g0_mu0", "g0_mu1", "g0_mu2"];
  // `Number()` turns each of these into a finite 0. Taking that as an index
  // would bind the edit to MU 0 and skip the uid lookup entirely, so every
  // edit in a uid-keyed log would replay onto the first motor unit.
  for (const muIdx of [null, "", false, [], "   "]) {
    const entry = normalized(
      { mu_idx: muIdx, mu_uid: "g0_mu2", type: "add_spikes" },
      0,
      muUids,
    );
    assert.equal(entry.muIdx, 2, `mu_idx: ${JSON.stringify(muIdx)}`);
  }
  // With no uid to fall back on, the entry stays unresolved.
  const orphan = normalized({ mu_idx: null }, 0, muUids);
  assert.equal(orphan.muIdx, -1);
});

test("normalizeLogEntry keeps a real mu_idx, including numeric strings", () => {
  const muUids = ["g0_mu0", "g0_mu1", "g0_mu2"];
  // An explicit index wins over the uid: they disagree here on purpose.
  assert.equal(normalized({ mu_idx: 1, mu_uid: "g0_mu2" }, 0, muUids).muIdx, 1);
  assert.equal(normalized({ mu_idx: "2" }, 0, muUids).muIdx, 2);
  assert.equal(normalized({ mu_idx: 0 }, 0, muUids).muIdx, 0);
  // A non-numeric index is no index, so the uid resolves it.
  assert.equal(
    normalized({ mu_idx: "abc", mu_uid: "g0_mu1" }, 0, muUids).muIdx,
    1,
  );
});

test("normalizeLogEntry resolves muIdx from muUid when missing", () => {
  const muUids = ["g0_mu0", "g0_mu1"];
  const entry = normalized({ mu_uid: "g0_mu1", type: "add_spikes" }, 0, muUids);
  assert.equal(entry.muIdx, 1);
  // An unknown uid leaves the index at -1.
  const unknown = normalized({ mu_uid: "nope" }, 0, muUids);
  assert.equal(unknown.muIdx, -1);
});

test("normalizeLogEntry parses spike lists from strings", () => {
  const entry = normalized(
    {
      timestamp: "2024-01-01T00:00:00Z",
      action: "delete_spikes",
      mu_idx: 1,
      spikes_added: "1;2 3 4",
      spikes_removed: "5,6",
      view_start: "10.6",
      view_end: 99,
      use_peeloff: 1,
    },
    0,
    [],
  );
  assert.equal(entry.timestamp, "2024-01-01T00:00:00Z");
  assert.equal(entry.type, "delete_spikes");
  assert.equal(entry.muIdx, 1);
  assert.deepEqual(entry.spikesAdded, [1, 2, 3, 4]);
  assert.deepEqual(entry.spikesRemoved, [5, 6]);
  assert.equal(entry.viewStart, 11);
  assert.equal(entry.viewEnd, 99);
  assert.equal(entry.usePeeloff, true);
});

test("normalizeLogEntry keeps the raw entry", () => {
  const raw = { type: "update_filter", comment: "keep" };
  const entry = normalized(raw, 0, []);
  assert.equal(entry.raw, raw);
});
