// Interface for managing import-related navigation guards.
export interface ImportGuard {
  active: () => boolean;
  busy: () => boolean;
  discard: () => Promise<boolean>;
}

// Represents a location in the browser's history stack.
export interface HistoryLocation {
  url: string;
  index: number;
}

// Adapter interface for interacting with the browser's history API.
interface HistoryAdapter {
  read: () => HistoryLocation;
  push: (url: string, index: number) => void;
  go: (delta: number) => void;
  changed: () => void;
}

type Target = { url: string } | { delta: number } | { discard: true };

/** Guards the existing History API router without storing receipt drafts. */
export class NavigationGuard {
  private location: HistoryLocation;
  private target: Target | null = null;
  private restoring = false;
  private restored: Promise<void> | null = null;
  private finishRestore: (() => void) | null = null;
  private replaying = false;
  private readonly history: HistoryAdapter;
  private importGuard: ImportGuard | null = null;
  private readonly ask: () => void;

  constructor(history: HistoryAdapter, ask: () => void) {
    this.history = history;
    this.ask = ask;
    this.location = history.read();
  }

  register(guard: ImportGuard | null) {
    this.importGuard = guard;
  }

  shouldWarnBeforeUnload(): boolean {
    return this.importGuard?.active() ?? false;
  }

  navigate(url: string) {
    if (url === this.location.url || this.target || this.restoring) return;
    const guard = this.importGuard;
    if (guard?.busy()) return;
    if (guard?.active()) {
      this.target = { url };
      this.ask();
    } else this.push(url);
  }

  requestDiscard() {
    const guard = this.importGuard;
    if (!guard?.active() || guard.busy() || this.target || this.restoring)
      return;
    this.target = { discard: true };
    this.ask();
  }

  pop() {
    const next = this.history.read();
    if (this.restoring) {
      if (next.index !== this.location.index) {
        this.history.go(this.location.index - next.index);
        return;
      }
      this.restoring = false;
      this.finishRestore?.();
      this.finishRestore = null;
      this.restored = null;
      if (this.target) this.ask();
      return;
    }
    const guard = this.importGuard;
    if (!this.replaying && (guard?.active() || guard?.busy())) {
      const delta = next.index - this.location.index;
      if (!delta) return;
      if (!guard.busy() && !this.target) this.target = { delta };
      this.restoring = true;
      this.restored = new Promise((resolve) => {
        this.finishRestore = resolve;
      });
      this.history.go(-delta);
      return;
    }
    this.replaying = false;
    this.location = next;
    this.history.changed();
  }

  stay() {
    this.target = null;
  }

  // Function for confirming the discard action and proceeding with navigation if confirmed.
  async confirm(): Promise<boolean> {
    const target = this.target;
    const guard = this.importGuard;
    if (!target || this.restoring || guard?.busy()) return false;
    if (guard?.active() && !(await guard.discard())) return false;
    // Browser traversal can occur while DELETE is still pending.
    if (this.restored) await this.restored;
    this.target = null;
    if ("url" in target) this.push(target.url);
    else if ("delta" in target) {
      this.replaying = true;
      this.history.go(target.delta);
    }
    return true;
  }

  async saved(id: number) {
    this.importGuard = null;
    this.target = null;
    if (this.restored) await this.restored;
    this.navigate(`/import?receiptId=${id}`);
  }

  private push(url: string) {
    this.location = { url, index: this.location.index + 1 };
    this.history.push(url, this.location.index);
    this.history.changed();
  }
}
