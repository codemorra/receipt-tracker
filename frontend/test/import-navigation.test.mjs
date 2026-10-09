import assert from "node:assert/strict";
import test from "node:test";
import { NavigationGuard } from "../src/routes/navigation-guard.ts";
import { ImportRequestScope } from "../src/scans/import-lifecycle.ts";

function setup() {
  const entries = [
    { url: "/", index: 0 },
    { url: "/import", index: 1 },
  ];
  let position = 1;
  let active = true;
  let busy = false;
  let succeeds = true;
  let prompts = 0;
  let changes = 0;
  let deletes = 0;
  const moves = [];
  const guard = {
    active: () => active,
    busy: () => busy,
    discard: async () => {
      deletes++;
      if (!succeeds) return false;
      active = false;
      return true;
    },
  };
  const navigation = new NavigationGuard(
    {
      read: () => entries[position],
      push: (url, index) => {
        entries.splice(position + 1, Infinity, { url, index });
        position++;
      },
      go: (delta) => moves.push(delta),
      changed: () => changes++,
    },
    () => prompts++,
  );
  navigation.register(guard);
  function pop(delta) {
    position += delta;
    navigation.pop();
  }
  function settle() {
    const delta = moves.shift();
    assert.notEqual(delta, undefined);
    pop(delta);
  }
  return {
    navigation,
    entries,
    moves,
    pop,
    settle,
    active: (value) => (active = value),
    busy: (value) => (busy = value),
    succeeds: (value) => (succeeds = value),
    get state() {
      return { position, prompts, changes, deletes };
    },
  };
}

// Test suite for verifying the behavior of the import navigation guard.
test("leaving an import confirms once and staying keeps the mounted import and URL", async () => {
  const app = setup();
  assert.equal(app.navigation.shouldWarnBeforeUnload(), true);
  app.navigation.navigate("/import");
  assert.equal(app.state.prompts, 0);
  app.navigation.navigate("/analytics");
  app.navigation.navigate("/settings");
  assert.equal(app.state.prompts, 1);
  assert.equal(app.state.changes, 0);
  app.navigation.stay();
  assert.equal(app.state.deletes, 0);
  app.navigation.navigate("/settings");
  assert.equal(await app.navigation.confirm(), true);
  assert.deepEqual(app.entries.at(-1), { url: "/settings", index: 2 });
  assert.equal(app.state.deletes, 1);
});

// Test case for handling cleanup failure during navigation away from an import.
test("cleanup failure does not navigate or discard the draft; retry is possible", async () => {
  const app = setup();
  app.succeeds(false);
  app.navigation.navigate("/receipts");
  assert.equal(await app.navigation.confirm(), false);
  assert.equal(app.state.position, 1);
  assert.equal(app.state.changes, 0);
  app.succeeds(true);
  assert.equal(await app.navigation.confirm(), true);
  assert.equal(app.state.position, 2);
});

// Test case for explicitly discarding an import without affecting the browser history.
test("explicit discard resets the import without changing history", async () => {
  const app = setup();
  app.navigation.requestDiscard();
  assert.equal(await app.navigation.confirm(), true);
  assert.equal(app.state.deletes, 1);
  assert.equal(app.state.position, 1);
  assert.equal(app.entries.length, 2);
});

// Test case for handling empty and saved imports, ensuring navigation occurs without warnings and saving blocks navigation.
test("empty and saved imports navigate without warning; saving blocks navigation", () => {
  const app = setup();
  app.busy(true);
  app.navigation.navigate("/");
  app.navigation.requestDiscard();
  assert.equal(app.state.prompts, 0);
  assert.equal(app.state.changes, 0);
  app.busy(false);
  app.active(false);
  assert.equal(app.navigation.shouldWarnBeforeUnload(), false);
  app.navigation.navigate("/import?receiptId=123");
  app.navigation.navigate("/receipts");
  assert.equal(app.state.prompts, 0);
  assert.equal(app.state.changes, 2);
});

// Test case for handling browser back navigation, ensuring the entry is restored before prompting and staying does not duplicate history.
test("Back restores the entry before asking; staying adds no duplicate history", () => {
  const app = setup();
  app.pop(-1);
  assert.equal(app.state.prompts, 0);
  assert.equal(app.state.changes, 0);
  app.settle();
  assert.equal(app.state.prompts, 1);
  app.navigation.stay();
  assert.equal(app.state.position, 1);
  assert.equal(app.entries.length, 2);
});

// Test case for confirming back and forward navigation, ensuring the original traversal is replayed without adding new history entries.
test("confirmed Back and Forward replay the original traversal without pushing entries", async () => {
  const app = setup();
  app.pop(-1);
  app.settle();
  assert.equal(await app.navigation.confirm(), true);
  app.settle();
  assert.equal(app.state.position, 0);
  assert.equal(app.entries.length, 2);
  app.active(true);
  app.pop(1);
  app.settle();
  assert.equal(await app.navigation.confirm(), true);
  app.settle();
  assert.equal(app.state.position, 1);
  assert.equal(app.state.deletes, 2);
  assert.equal(app.entries.length, 2);
});

// Test case for handling back navigation during an ongoing save, ensuring the entry is restored without prompting.
test("Back during save restores the entry without prompting", () => {
  const app = setup();
  app.busy(true);
  app.pop(-1);
  app.settle();
  assert.equal(app.state.position, 1);
  assert.equal(app.state.prompts, 0);
  assert.equal(app.state.changes, 0);
});

// Test case for ensuring that aborted request completions do not overwrite or settle a newer import.
test("aborted request completions cannot overwrite or settle a newer import", () => {
  const scope = new ImportRequestScope();
  const upload = scope.begin();
  assert.ok(upload);
  assert.equal(scope.begin(), null);
  scope.abort();
  assert.equal(upload.signal.aborted, true);
  const next = scope.begin();
  assert.ok(next);
  assert.equal(scope.current(upload), false);
  assert.equal(scope.finish(upload), false);
  assert.equal(scope.current(next), true);
  assert.equal(scope.finish(next), true);
  assert.ok(scope.begin());
});

// Test case for discarding an import, ensuring the request is aborted and known sessions are cleaned, with retry allowed after cleanup errors.
test("discard aborts the request and cleans known sessions; cleanup errors permit retry", async () => {
  const scope = new ImportRequestScope();
  const processing = scope.begin();
  const removed = [];
  const failure = new Error("DELETE failed");
  await assert.rejects(
    scope.discard("scan-1", async (id) => {
      removed.push(id);
      throw failure;
    }),
    failure,
  );
  assert.equal(processing.signal.aborted, true);
  assert.equal(scope.current(processing), false);
  await scope.discard("scan-1", async (id) => {
    removed.push(id);
  });
  assert.deepEqual(removed, ["scan-1", "scan-1"]);
  const upload = scope.begin();
  await scope.discard(null, async () =>
    assert.fail("no known session to delete"),
  );
  assert.equal(upload.signal.aborted, true);
  assert.ok(scope.begin());
});

// Test case for handling a save finishing during back restoration, ensuring the saved receipt is opened without a warning.
test("a save finishing during Back restoration still opens the saved receipt without a warning", async () => {
  const app = setup();
  app.busy(true);
  app.pop(-1);
  const saved = app.navigation.saved(123);
  assert.equal(app.state.changes, 0);
  app.settle();
  await saved;
  assert.equal(app.entries.at(-1).url, "/import?receiptId=123");
  assert.equal(app.state.prompts, 0);
  assert.equal(app.navigation.shouldWarnBeforeUnload(), false);
});

// Test case for ensuring that cleanup completion waits for any overlapping back restoration before navigating.
test("cleanup completion waits for any overlapping Back restoration before navigating", async () => {
  const app = setup();
  let release;
  const deleting = new Promise((resolve) => {
    release = resolve;
  });
  app.navigation.register({
    active: () => true,
    busy: () => false,
    discard: async () => {
      await deleting;
      return true;
    },
  });
  app.navigation.navigate("/settings");
  const confirmed = app.navigation.confirm();
  app.pop(-1);
  release();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(app.state.changes, 0);
  app.settle();
  await confirmed;
  assert.equal(app.entries.at(-1).url, "/settings");
  assert.equal(app.state.position, 2);
});
