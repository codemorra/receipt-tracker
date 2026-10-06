import assert from "node:assert/strict";
import test from "node:test";
import {
  parseAnalyticsSearch,
  analyticsUrl,
  spendingFilters,
} from "../src/analytics/analytics-state.ts";

const state = parseAnalyticsSearch("").state;

// Tests for the analytics state parsing and URL generation logic.
test("analytics presets use local calendar dates, inclusive 30 days and clamped calendar months", () => {
  for (const [now, period, from, to] of [
    [new Date(2026, 9, 6, 23, 30), "last-30-days", "2026-09-07", "2026-10-06"],
    [new Date(2026, 0, 5), "last-30-days", "2025-12-07", "2026-01-05"],
    [new Date(2024, 2, 15), "last-30-days", "2024-02-15", "2024-03-15"],
    [new Date(2026, 4, 31), "last-3-months", "2026-02-28", "2026-05-31"],
    [new Date(2024, 4, 31), "last-3-months", "2024-02-29", "2024-05-31"],
    [new Date(2026, 0, 31), "last-3-months", "2025-10-31", "2026-01-31"],
    [new Date(2026, 9, 6), "this-year", "2026-01-01", "2026-10-06"],
  ])
    assert.deepEqual(spendingFilters({ ...state, period }, now), { from, to });
  assert.deepEqual(
    spendingFilters({ ...state, period: "all-time", merchantId: 7 }),
    { merchantId: 7 },
  );
});

// Tests for the analytics URL generation and preset behavior.
test("preset URLs contain no fixed dates and move with the date on a later reload", () => {
  for (const period of [
    "last-30-days",
    "last-3-months",
    "this-year",
    "all-time",
  ]) {
    const url = new URL(
      analyticsUrl({
        ...state,
        period,
        from: "2020-01-01",
        to: "2020-02-01",
        merchantId: 8,
        productId: 9,
        tab: "price-history",
      }),
      "http://localhost",
    );
    assert.equal(url.searchParams.has("from"), false);
    assert.equal(url.searchParams.has("to"), false);
    const parsed = parseAnalyticsSearch(url.search);
    assert.equal(parsed.invalid, false);
    assert.deepEqual(parsed.state, {
      ...state,
      period,
      merchantId: 8,
      productId: 9,
      tab: "price-history",
    });
  }
  const preset = parseAnalyticsSearch(
    "?period=last-30-days&from=2020-01-01&to=2020-02-01",
  ).state;
  assert.equal(spendingFilters(preset, new Date(2026, 9, 6)).to, "2026-10-06");
  assert.equal(spendingFilters(preset, new Date(2026, 10, 6)).to, "2026-11-06");
});

// Tests for the analytics custom URL handling and browser history behavior.
test("custom URLs round-trip and browser history snapshots restore independent filters", () => {
  const history = [
    state,
    {
      ...state,
      period: "custom",
      from: "2024-02-29",
      to: "2024-03-01",
      merchantId: 42,
    },
    { ...state, tab: "price-history", productId: 17 },
  ];
  for (const entry of [...history, ...history.toReversed()]) {
    const parsed = parseAnalyticsSearch(
      new URL(analyticsUrl(entry), "http://localhost").search,
    );
    assert.deepEqual(parsed, { state: entry, invalid: false });
  }
  assert.deepEqual(spendingFilters(history[1]), {
    from: "2024-02-29",
    to: "2024-03-01",
    merchantId: 42,
  });
});

// Tests for the analytics invalid URL handling and request prevention.
test("invalid URL filters cannot start an analytics request", () => {
  for (const search of [
    "?tab=other",
    "?period=bad",
    "?period=custom",
    "?period=custom&from=2026-02-30&to=2026-03-01",
    "?period=custom&from=2026-03-01&to=2026-02-01",
    "?period=custom&from=2026-1-01&to=2026-02-01",
    "?merchantId=0",
    "?productId=-1",
    "?merchantId=1e2",
    "?merchantId=9007199254740992",
    "?period=all-time&period=this-year",
    "?merchantId=1&merchantId=2",
  ])
    assert.equal(parseAnalyticsSearch(search).invalid, true, search);
});
