// Logged-diff application and the step predicates the replay engine relies on.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  applyLoggedDiffBackward,
  applyLoggedDiffForward,
  clamp,
  inactiveMusBefore,
  isSpikeEditStep,
  stepMuKey,
} from "../src/replay/operations.js";

describe("applyLoggedDiffForward", () => {
  test("applies removals then additions", () => {
    // A spike present in both removed and added lists survives (edit-in-place).
    const result = applyLoggedDiffForward([10, 20, 30], {
      spikesRemoved: [20],
      spikesAdded: [25, 20],
    });
    assert.deepEqual(result, [10, 20, 25, 30]);
  });

  test("returns a sorted, deduplicated array", () => {
    const result = applyLoggedDiffForward([30, 10], {
      spikesAdded: [20, 20, 5],
    });
    assert.deepEqual(result, [5, 10, 20, 30]);
  });

  test("filters negative and non-finite spikes", () => {
    const result = applyLoggedDiffForward([10], {
      spikesAdded: [-1, Number.NaN, Infinity, 40],
    });
    assert.deepEqual(result, [10, 40]);
  });

  test("tolerates missing spikes and step fields", () => {
    assert.deepEqual(applyLoggedDiffForward(null, {}), []);
    assert.deepEqual(applyLoggedDiffForward([1, 2], {}), [1, 2]);
    assert.deepEqual(
      applyLoggedDiffForward([1, 2], { spikesAdded: [] }),
      [1, 2],
    );
  });
});

describe("applyLoggedDiffBackward", () => {
  test("inverts a forward step", () => {
    const before = [10, 20, 30];
    const step = { spikesRemoved: [20], spikesAdded: [25] };
    const after = applyLoggedDiffForward(before, step);
    assert.deepEqual(applyLoggedDiffBackward(after, step), before);
  });

  test("removes added and restores removed spikes", () => {
    const result = applyLoggedDiffBackward([10, 25, 30], {
      spikesAdded: [25],
      spikesRemoved: [20],
    });
    assert.deepEqual(result, [10, 20, 30]);
  });
});

describe("isSpikeEditStep", () => {
  test("recognizes the spike-edit operation types", () => {
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

  test("rejects non-edit steps and bad input", () => {
    assert.equal(isSpikeEditStep({ type: "update_filter" }), false);
    assert.equal(isSpikeEditStep({}), false);
    assert.equal(isSpikeEditStep(null), false);
    assert.equal(isSpikeEditStep(undefined), false);
  });
});

describe("stepMuKey", () => {
  test("prefers muUid, then muIdx, then unknown", () => {
    assert.equal(stepMuKey({ muUid: "g0_mu1" }), "uid:g0_mu1");
    assert.equal(stepMuKey({ muIdx: 3 }), "idx:3");
    assert.equal(stepMuKey({}), "unknown");
    assert.equal(stepMuKey(null), "unknown");
    // Negative or non-finite indices are not valid.
    assert.equal(stepMuKey({ muIdx: -1 }), "unknown");
    assert.equal(stepMuKey({ muIdx: Number.NaN }), "unknown");
    assert.equal(stepMuKey({ muUid: "u", muIdx: 2 }), "uid:u");
  });
});

describe("inactiveMusBefore", () => {
  test("lists the MUs flagged or removed before the step", () => {
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

  test("honours an unflag and ignores unknown uids", () => {
    const history = [
      { type: "flag_mu", muUid: "g0_mu0", raw: { flagged: true } },
      { type: "flag_mu", muUid: "g0_mu0", raw: { flagged: false } },
      { type: "remove_flagged", raw: { removed_mu_uids: ["g9_mu9"] } },
    ];
    assert.deepEqual(inactiveMusBefore(history, 3, ["g0_mu0"]), []);
  });
});

describe("clamp", () => {
  test("constrains a value to the range", () => {
    assert.equal(clamp(5, 0, 10), 5);
    assert.equal(clamp(-1, 0, 10), 0);
    assert.equal(clamp(11, 0, 10), 10);
    assert.equal(clamp(0, 0, 10), 0);
    assert.equal(clamp(10, 0, 10), 10);
  });

  test("collapses to the low bound when the bounds are reversed", () => {
    // Not a supported call, but worth pinning: `max(lo, min(hi, v))` returns
    // `lo` for every input once lo > hi, so reversed bounds do not silently
    // behave like the range read the other way round.
    assert.equal(clamp(11, 10, 0), 10);
    assert.equal(clamp(-1, 10, 0), 10);
    assert.equal(clamp(5, 10, 0), 10);
  });
});
