// Every figure in this fixture is invented and is NOT a user portfolio record.
const baseline = Object.freeze({
  synthetic: true,
  name: "Illustrative CAD portfolio",
  asOf: "Synthetic market snapshot",
  limits: { technology: 35, singleIssuer: 18 },
  allocation: [
    { name: "Diversified ETFs", pct: 53 },
    { name: "Mutual funds", pct: 25 },
    { name: "Individual stocks", pct: 17 },
    { name: "Cash", pct: 5 }
  ],
  trend: [0, 1.4, 0.8, 2.6, 2.1, 3.8, 3.4, 4.7, 4.2, 5.2],
  techPct: 27,
  largestIssuerPct: 12,
  priceDataAgeDays: 0,
  candidate: null,
  lastEvent: "Portfolio monitoring complete"
});

export const scenarios = Object.freeze({
  stable: { ...baseline, id: "stable" },
  monitor: { ...baseline, id: "monitor", techPct: 32 },
  risk: { ...baseline, id: "risk", techPct: 43, largestIssuerPct: 21, lastEvent: "Risk threshold exceeded" },
  opportunity: {
    ...baseline,
    id: "opportunity",
    candidate: { label: "Fictional Company A", qualityScreenPassed: true, valuationScreenPassed: true, fundamentalDataVerified: true },
    lastEvent: "New screened research candidate"
  },
  stale: { ...baseline, id: "stale", priceDataAgeDays: 18, lastEvent: "Price feed requires validation" }
});

export function getScenario(id = "stable") {
  if (!Object.hasOwn(scenarios, id)) return null;
  return structuredClone(scenarios[id]);
}
