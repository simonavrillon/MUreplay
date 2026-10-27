import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyLoggedDiffBackward,
  applyLoggedDiffForward,
  inactiveMusBefore,
  isSpikeEditStep,
  stepMuKey,
} from "../src/replay/operations.js";

test("applyLoggedDiffForward applies removals then additions", () => {
  // A spike present in both removed and added lists survives (edit-in-place).
  const result = applyLoggedDiffForward([10, 20, 30], {
    spikesRemoved: [20],
    spikesAdded: [25, 20],
  });
  assert.deepEqual(result, [10, 20, 25, 30]);
});

test("applyLoggedDiffForward returns a sorted, deduplicated array", () => {
  const result = applyLoggedDiffForward([30, 10], {
    spikesAdded: [20, 20, 5],
  });
  assert.deepEqual(result, [5, 10, 20, 30]);
});

test("applyLoggedDiffForward filters negative and non-finite spikes", () => {
  const result = applyLoggedDiffForward([10], {
    spikesAdded: [-1, Number.NaN, Infinity, 40],
  });
  assert.deepEqual(result, [10, 40]);
});

test("applyLoggedDiffForward tolerates missing distimes and step fields", () => {
  assert.deepEqual(applyLoggedDiffForward(null, {}), []);
  assert.deepEqual(applyLoggedDiffForward([1, 2], {}), [1, 2]);
  assert.deepEqual(applyLoggedDiffForward([1, 2], { spikesAdded: [] }), [1, 2]);
});

test("applyLoggedDiffBackward inverts a forward step", () => {
  const before = [10, 20, 30];
  const step = { spikesRemoved: [20], spikesAdded: [25] };
  const after = applyLoggedDiffForward(before, step);
  assert.deepEqual(applyLoggedDiffBackward(after, step), before);
});

test("applyLoggedDiffBackward removes added and restores removed spikes", () => {
  const result = applyLoggedDiffBackward([10, 25, 30], {
    spikesAdded: [25],
    spikesRemoved: [20],
  });
  assert.deepEqual(result, [10, 20, 30]);
});

test("isSpikeEditStep recognizes the spike-edit operation types", () => {
  for (const type of [
    "add_spikes",
    "delete_spikes",
    "delete_dr",
    "remove_outliers",
  ]) {
    assert.equal(isSpikeEditStep({ type }), true, type);
  }
  // Type matching is case-insensitive.
  assert.equal(isSpikeEditStep({ type: "Add_Spikes" }), true);
});

test("isSpikeEditStep rejects non-edit steps and bad input", () => {
  assert.equal(isSpikeEditStep({ type: "update_filter" }), false);
  assert.equal(isSpikeEditStep({}), false);
  assert.equal(isSpikeEditStep(null), false);
  assert.equal(isSpikeEditStep(undefined), false);
});

test("stepMuKey prefers muUid, then muIdx, then unknown", () => {
  assert.equal(stepMuKey({ muUid: "g0_mu1" }), "uid:g0_mu1");
  assert.equal(stepMuKey({ muIdx: 3 }), "idx:3");
  assert.equal(stepMuKey({}), "unknown");
  assert.equal(stepMuKey(null), "unknown");
  // Negative or non-finite indices are not valid.
  assert.equal(stepMuKey({ muIdx: -1 }), "unknown");
  assert.equal(stepMuKey({ muIdx: Number.NaN }), "unknown");
  assert.equal(stepMuKey({ muUid: "u", muIdx: 2 }), "uid:u");
});

test("inactiveMusBefore lists the MUs flagged or removed before the step", () => {
  const uids = ["g0_mu0", "g0_mu1", "g0_mu2", "g1_mu0"];
  const history = [
    { type: "flag_mu", muUid: "g0_mu0", raw: { flagged: true } },
    { type: "flag_mu", muUid: "g0_mu1", raw: { flagged: true } },
    { type: "add_spikes", muUid: "g0_mu1" },
    { type: "remove_duplicates", raw: { removed_mu_uids: ["g1_mu0"] } },
    { type: "update_filter", muUid: "g0_mu2" },
  ];
  // An edit clears g0_mu1's flag, as MUedit2's session does.
  assert.deepEqual(inactiveMusBefore(history, 4, uids), [0, 3]);
  // Only steps before the one being replayed count.
  assert.deepEqual(inactiveMusBefore(history, 1, uids), [0]);
});

test("inactiveMusBefore honours an unflag and ignores unknown uids", () => {
  const history = [
    { type: "flag_mu", muUid: "g0_mu0", raw: { flagged: true } },
    { type: "flag_mu", muUid: "g0_mu0", raw: { flagged: false } },
    { type: "remove_flagged", raw: { removed_mu_uids: ["g9_mu9"] } },
  ];
  assert.deepEqual(inactiveMusBefore(history, 3, ["g0_mu0"]), []);
});
