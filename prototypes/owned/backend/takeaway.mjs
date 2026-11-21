// Pure deterministic demonstration only. NOT an investment strategy or trade signal.
// Priorities: stale/invalid > risk breach > verified research candidate > near-limit > routine.
// The optional later on-device LLM may only rewrite, never alter the rule decision.
const round1 = (x) => Number(x).toFixed(1);

function percentMetric(label, value, detail) {
  return { label, value: round1(value) + "%", detail };
}

export function buildTakeaway(input) {
  if (!input || input.synthetic !== true) throw new Error("Prototype accepts synthetic fixtures only.");
  const t = Number(input.techPct);
  const issuer = Number(input.largestIssuerPct);
  const techLimit = Number(input.limits?.technology);
  const issuerLimit = Number(input.limits?.singleIssuer);
  const age = Number(input.priceDataAgeDays);
  const values = [t, issuer, techLimit, issuerLimit, age];
  if (values.some(x => !Number.isFinite(x)) || t < 0 || t > 100 || issuer < 0 || issuer > 100 ||
    techLimit <= 0 || issuerLimit <= 0 || age < 0) {
    return { state: "unavailable", priority: 100, title: "Data needs verification",
      text: "Required metrics are missing or invalid. No investment interpretation is available until the inputs are corrected.",
      action: "Verify data", metrics: [], evidence: ["Invalid synthetic input"], asOf: input.asOf };
  }
  const metrics = [
    percentMetric("Technology exposure", t, "Illustrative limit " + round1(techLimit) + "%"),
    percentMetric("Largest issuer", issuer, "Illustrative limit " + round1(issuerLimit) + "%")
  ];
  if (age > 5) return {
    state: "stale", priority: 95, title: "Data verification required",
    text: "The latest market data are too old for a reliable portfolio assessment. Validate or refresh the sources before considering new research signals.",
    action: "Review data freshness", metrics, evidence: ["Synthetic price data age: " + age + " days", "Freshness requirement: 5 days"], asOf: input.asOf
  };
  if (t > techLimit || issuer > issuerLimit) {
    const breached = [];
    if (t > techLimit) breached.push("technology exposure");
    if (issuer > issuerLimit) breached.push("single-issuer exposure");
    return { state: "risk", priority: 90, title: "Concentration limit exceeded",
      text: "This illustrative portfolio exceeds its configured " + breached.join(" and ") + " threshold" + (breached.length > 1 ? "s" : "") +
        ". Review the underlying exposure and investment policy before taking any action.",
      action: "Review concentration", metrics, evidence: ["User-configurable limits", "Synthetic scenario only"], asOf: input.asOf };
  }
  const c = input.candidate;
  if (c && c.qualityScreenPassed === true && c.valuationScreenPassed === true && c.fundamentalDataVerified === true) {
    return { state: "research", priority: 70, title: "New research candidate",
      text: c.label + " passed preliminary illustrative quality and valuation screens. It merits further investigation, not an automatic purchase.",
      action: "Review research", metrics, evidence: ["Preliminary screens only", "No backtest or purchase recommendation"], asOf: input.asOf };
  }
  if (t >= techLimit - 5 || issuer >= issuerLimit - 3) {
    return { state: "watch", priority: 50, title: "Approaching a concentration limit",
      text: "The portfolio remains within its configured limits, but exposure is approaching a threshold. Monitor the trend; no transaction is currently indicated.",
      action: "Monitor", metrics, evidence: ["Synthetic configured limits", "No trade signal"], asOf: input.asOf };
  }
  return {
    state: "stable", priority: 10, title: "No action required",
    text: "The illustrative portfolio remains within its concentration limits, with no newly validated research exceptions. Continue routine monitoring rather than trading without a reason.",
    action: "Continue monitoring", metrics, evidence: ["No threshold breach", "No research exception"], asOf: input.asOf
  };
}

export function publicSummary(input) {
  // Explicit allowlist; may not accidentally serialize future private ledger fields.
  const x = buildTakeaway(input);
  return {
    synthetic: true, scenario: input.id, name: input.name,
    takeaway: x,
    allocation: input.allocation.map(a => ({ name: String(a.name), pct: Number(a.pct) })),
    trend: input.trend.map(Number),
    privacy: "SYNTHETIC FIXTURE ONLY · NO REAL PORTFOLIO DATA"
  };
}
