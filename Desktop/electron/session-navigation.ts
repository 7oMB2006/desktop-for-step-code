/** Only the latest target may commit. Cold startups are bounded; resident reads do not spawn. */
export class SessionNavigation<T, R> {
  private target?: { id: string; resolve: (value: R | null) => void; reject: (error: unknown) => void };
  private preparing = new Map<string, { controller: AbortController; cold: boolean }>();
  busy = false;
  get selecting() { return Boolean(this.target); }
  pending(id: string | undefined) { return Boolean(id && (this.target?.id === id || this.preparing.has(id))); }

  constructor(
    private prepare: (id: string, signal: AbortSignal) => Promise<T>,
    private commit: (prepared: T) => R,
    private onBusy: (busy: boolean) => void = () => {},
    private hooks: { reuse?: (id: string) => Promise<T> | undefined; settled?: () => void } = {},
  ) {}

  select(id: string): Promise<R | null> {
    this.target?.resolve(null);
    const result = new Promise<R | null>((resolve, reject) => { this.target = { id, resolve, reject }; });
    for (const [key, preparation] of this.preparing) if (key !== id) preparation.controller.abort();
    if (!this.busy) {
      this.busy = true;
      this.onBusy(true);
    }
    this.pump();
    return result;
  }

  private pump() {
    const id = this.target?.id;
    if (id && !this.preparing.has(id)) {
      const resident = this.hooks.reuse?.(id);
      const coldCount = [...this.preparing.values()].filter(preparation => preparation.cold).length;
      if (resident || coldCount < 2) {
        const controller = new AbortController();
        this.preparing.set(id, { controller, cold: !resident });
        void this.run(id, controller.signal, resident);
      }
    }
    if (!this.target && !this.preparing.size && this.busy) {
      this.busy = false;
      this.onBusy(false);
    }
  }
  private async run(id: string, signal: AbortSignal, resident?: Promise<T>) {
    try {
      const prepared = await (resident ?? this.prepare(id, signal));
      if (this.target?.id === id) {
        const request = this.target;
        this.target = undefined;
        try { request.resolve(this.commit(prepared)); }
        catch (error) { request.reject(error); }
      }
    } catch (error) {
      if (this.target?.id === id && !signal.aborted) {
        const request = this.target;
        this.target = undefined;
        request.reject(error);
      }
    } finally {
      this.preparing.delete(id);
      this.pump();
      this.hooks.settled?.();
    }
  }
}
