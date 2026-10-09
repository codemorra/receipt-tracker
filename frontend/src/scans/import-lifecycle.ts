/** Keeps late request completions from affecting a discarded or newer import. */
export class ImportRequestScope {
  private pending: AbortController | null = null;

  begin(): AbortController | null {
    if (this.pending) return null;
    this.pending = new AbortController();
    return this.pending;
  }

  current(controller: AbortController): boolean {
    return this.pending === controller && !controller.signal.aborted;
  }

  finish(controller: AbortController): boolean {
    if (!this.current(controller)) return false;
    this.pending = null;
    return true;
  }

  abort() {
    this.pending?.abort();
    this.pending = null;
  }

  async discard(scanId: string | null, remove: (id: string) => Promise<void>) {
    this.abort();
    if (scanId) await remove(scanId);
  }
}
