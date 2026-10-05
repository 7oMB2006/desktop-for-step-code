import type { RuntimeEvent, Snapshot } from './contracts';

// Snapshots and pushed events travel over separate IPC paths.
export class MessageRevision {
  private runtimeId?: string;
  private revision = -1;

  acceptSnapshot(snapshot: Pick<Snapshot, 'runtimeId' | 'runtimeRevision'>): boolean {
    if (snapshot.runtimeId !== this.runtimeId) {
      this.runtimeId = snapshot.runtimeId;
      this.revision = -1;
    }
    const revision = snapshot.runtimeRevision;
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) return true;
    if (revision < this.revision) return false;
    this.revision = revision;
    return true;
  }

  acceptEvent(event: RuntimeEvent): boolean {
    if (event.runtimeId && event.runtimeId !== this.runtimeId) return false;
    const revision = event.runtimeRevision;
    if (!Number.isSafeInteger(revision) || revision < 0) return true;
    if (revision <= this.revision) return false;
    this.revision = revision;
    return true;
  }
}
