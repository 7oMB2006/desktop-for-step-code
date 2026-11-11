import type { FollowLaunch } from './protocol.mjs';
export function mockHost(): Promise<{
  counts: { context: number; invoke: number; cancel: number; provider: number };
  launch(overrides?: Partial<FollowLaunch>): FollowLaunch;
  grant(launch: FollowLaunch): void;
  revoke(launch: FollowLaunch): void;
  changeRevision(launch: FollowLaunch): void;
  close(): Promise<void>;
}>;
