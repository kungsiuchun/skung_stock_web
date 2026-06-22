import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVixChartData,
  getVixChartDomain,
  getVixRangeLabel,
  getVixStatus,
  getVixTone,
} from "../src/lib/vix-visualization";

test("buildVixChartData filters invalid values and labels the latest point", () => {
  const points = buildVixChartData([16.1, Number.NaN, 17.4, 18.2]);

  assert.deepEqual(points, [
    { index: 0, value: 16.1, label: "D-2" },
    { index: 1, value: 17.4, label: "D-1" },
    { index: 2, value: 18.2, label: "Now" },
  ]);
});

test("getVixChartDomain keeps the 20 VIX watch line visible", () => {
  const domain = getVixChartDomain([15.9, 16.4, 17.1, 18.2]);

  assert.ok(domain[0] < 16);
  assert.ok(domain[1] > 20);
});

test("getVixStatus and tone keep risk language stable", () => {
  assert.equal(getVixStatus(14.9), "平穩");
  assert.equal(getVixStatus(16.4), "偏緊張");
  assert.equal(getVixStatus(21.2), "恐慌");
  assert.equal(getVixStatus(26.1), "高恐慌");

  assert.equal(getVixTone(14.9), "calm");
  assert.equal(getVixTone(16.4), "watch");
  assert.equal(getVixTone(21.2), "stress");
});

test("getVixRangeLabel formats the visible chart range", () => {
  assert.equal(getVixRangeLabel([16.02, 14.91, 18.36]), "14.9-18.4");
  assert.equal(getVixRangeLabel([]), "N/A");
});
