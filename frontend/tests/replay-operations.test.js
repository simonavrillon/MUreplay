// Logged-diff application and the helpers the replay engine relies on.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  applyDiff,
  clamp,
  inactiveMusBefore,
  shiftViewInside,
} from "../src/replay/operations.js";

describe("applyDiff", () => {
  test("applies removals then additions", () => {
    // A spike present in both removed and added lists survives (edit-in-place).
    assert.deepEqual(applyDiff([10, 20, 30], [25, 20], [20]), [10, 20, 25, 30]);
  });

  test("returns a sorted, deduplicated array", () => {
    assert.deepEqual(applyDiff([30, 10], [20, 20, 5], []), [5, 10, 20, 30]);
  });

  test("filters negative spikes", () => {
    assert.deepEqual(applyDiff([10], [-1, 40], []), [10, 40]);
  });

  test("swapping the lists undoes a step", () => {
    const before = [10, 20, 30];
    const after = applyDiff(before, [25], [20]);
    assert.deepEqual(applyDiff(after, [20], [25]), before);
  });
});

describe("inactiveMusBefore", () => {
  /**
   * The log-entry fields `inactiveMusBefore` reads, as `normalizeLogEntry` fills them.
   *
   * @param {{ type: string, muUid?: string, flagged?: boolean, removedMuUids?: string[] }} fields
   */
  const entry = (fields) => ({
    muUid: "",
    flagged: true,
    removedMuUids: [],
    ...fields,
  });

  test("lists the MUs flagged or removed before the step", () => {
    const uids = ["g0_mu0", "g0_mu1", "g0_mu2", "g1_mu0"];
    const editHistory = [
      entry({ type: "flag_mu", muUid: "g0_mu0" }),
      entry({ type: "flag_mu", muUid: "g0_mu1" }),
      entry({ type: "add_spikes", muUid: "g0_mu1" }),
      entry({ type: "remove_duplicates", removedMuUids: ["g1_mu0"] }),
      entry({ type: "update_filter", muUid: "g0_mu2" }),
    ];
    // An edit clears g0_mu1's flag, as MUedit2's session does.
    assert.deepEqual(inactiveMusBefore(editHistory, 4, uids), [0, 3]);
    // Only steps before the one being replayed count.
    assert.deepEqual(inactiveMusBefore(editHistory, 1, uids), [0]);
  });

  test("honours an unflag and ignores unknown uids", () => {
    const editHistory = [
      entry({ type: "flag_mu", muUid: "g0_mu0" }),
      entry({ type: "flag_mu", muUid: "g0_mu0", flagged: false }),
      entry({ type: "remove_flagged", removedMuUids: ["g9_mu9"] }),
    ];
    assert.deepEqual(inactiveMusBefore(editHistory, 3, ["g0_mu0"]), []);
  });
});

describe("clamp", () => {
  test("constrains a value to the range", () => {
    assert.equal(clamp(-1, 0, 10), 0);
    assert.equal(clamp(11, 0, 10), 10);
  });
});

describe("shiftViewInside", () => {
  test("shifts a view back inside the recording, keeping its width", () => {
    assert.deepEqual(shiftViewInside(-20, 80, 1000), { start: 0, end: 100 });
    assert.deepEqual(shiftViewInside(950, 1050, 1000), {
      start: 900,
      end: 1000,
    });
  });

  test("trims a view wider than the recording to the whole of it", () => {
    assert.deepEqual(shiftViewInside(-50, 1500, 1000), { start: 0, end: 1000 });
  });
});
