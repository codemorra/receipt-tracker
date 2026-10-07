import assert from "node:assert/strict";
import test from "node:test";
import {
  expiringSoonThrough,
  localCalendarDay,
  warrantyStatus,
} from "../src/warranties/warranty-status.js";

// Test suite for warranty status calculations and local calendar day arithmetic.
test("stored warranty intervals respect inclusive start/end and the 30-day boundary", () => {
  for (const [start, end, expected] of [
    ["2026-10-08", "2026-10-09", "not_started"],
    ["2026-01-01", "2026-10-06", "expired"],
    ["2026-10-07", "2026-10-07", "expiring_soon"],
    ["2026-01-01", "2026-10-07", "expiring_soon"],
    ["2026-01-01", "2026-11-06", "expiring_soon"],
    ["2026-10-07", "2026-11-07", "active"],
  ]) {
    assert.equal(
      warrantyStatus(start, end, "2026-10-07"),
      expected,
      `${start}/${end}`,
    );
  }
});

// Test suite for warranty status calculations and local calendar day arithmetic.
test("calendar arithmetic crosses leap days, years and daylight-saving boundaries", () => {
  for (const [today, through] of [
    ["2024-02-01", "2024-03-02"],
    ["2026-12-15", "2027-01-14"],
    ["2026-03-15", "2026-04-14"],
    ["2026-10-15", "2026-11-14"],
  ])
    assert.equal(expiringSoonThrough(today), through);
  // Construct local calendar dates, including both ends of the day.
  for (const hour of [0, 23]) {
    assert.equal(
      localCalendarDay(new Date(2026, 9, 7, hour, 59)),
      "2026-10-07",
    );
  }
});
