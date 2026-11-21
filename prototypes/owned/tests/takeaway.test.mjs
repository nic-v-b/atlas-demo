import test from "node:test";
import assert from "node:assert/strict";
import { getScenario } from "../backend/fixtures.mjs";
import { buildTakeaway, publicSummary } from "../backend/takeaway.mjs";
const expected = { stable: "stable", monitor: "watch", risk: "risk", opportunity: "research", stale: "stale" };

for (const [id, state] of Object.entries(expected)) {
  test(id + " selects the expected key takeaway", () => {
    const x = buildTakeaway(getScenario(id));
    assert.equal(x.state, state);
    assert.equal(x.metrics.length, 2);
    assert.ok(x.text.length > 50);
  });
}
test("risk takes precedence over a research candidate", () => {
  const s = getScenario("risk"); s.candidate = getScenario("opportunity").candidate;
  assert.equal(buildTakeaway(s).state, "risk");
});
test("stale data takes precedence over risk", () => {
  const s = getScenario("risk"); s.priceDataAgeDays = 18;
  assert.equal(buildTakeaway(s).state, "stale");
});
test("rejects non synthetic inputs", () => {
  assert.throws(() => buildTakeaway({ techPct: 12 }), /synthetic/i);
});
test("invalid values cannot produce trade signals", () => {
  const s = getScenario("stable"); s.techPct = Number.NaN;
  assert.equal(buildTakeaway(s).state, "unavailable");
});
test("response only contains explicitly allowed synthetic fields", () => {
  const s = getScenario("stable");
  s.accountBalance = "PRIVATE_CANARY";
  s.costBasis = "PRIVATE_CANARY";
  s.accountId = "PRIVATE_CANARY";
  const payload = JSON.stringify(publicSummary(s));
  assert.equal(payload.includes("PRIVATE_CANARY"), false);
  assert.deepEqual(Object.keys(publicSummary(s)).sort(),
    ["synthetic", "scenario", "name", "takeaway", "allocation", "trend", "privacy"].sort());
});
