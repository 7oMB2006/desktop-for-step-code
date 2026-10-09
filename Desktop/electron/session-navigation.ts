/** Only the latest target may commit; preparation never changes the active session. */
export class SessionNavigation<T, R> {
  private pending?: { id: string; resolve: (value: R | null) => void; reject: (error: unknown) => void };
  private generation = 0;
  busy = false;

  constructor(
    private prepare: (id: string) => Promise<T>,
    private commit: (prepared: T) => R,
    private onBusy: (busy: boolean) => void = () => {},
  ) {}

  select(id: string): Promise<R | null> {
    this.generation++;
    this.pending?.resolve(null);
    const result = new Promise<R | null>((resolve, reject) => { this.pending = { id, resolve, reject }; });
    if (!this.busy) {
      this.busy = true;
      this.onBusy(true);
      void this.drain();
    }
    return result;
  }

  private async drain() {
    try {
      while (this.pending) {
        const request = this.pending;
        const generation = this.generation;
        this.pending = undefined;
        try {
          const prepared = await this.prepare(request.id);
          request.resolve(generation === this.generation ? this.commit(prepared) : null);
        } catch (error) {
          if (generation === this.generation) request.reject(error);
          else request.resolve(null);
        }
      }
    } finally {
      this.busy = false;
      this.onBusy(false);
    }
  }
}
