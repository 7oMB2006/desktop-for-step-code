import type { CapabilityPolicy } from './capability-policy';

export interface CapabilityGateHooks {
  assertAvailable(): void;
  acquireRuntime(): () => void;
  assertIdle(): Promise<void>;
  assertResource?(id: string): Promise<void>;
}

interface OperationOwner {
  closed: boolean;
  release?: () => void;
}

export class CapabilityGate {
  private owner?: OperationOwner;
  private completion: Promise<void> = Promise.resolve();

  get active(): boolean { return this.owner !== undefined; }
  whenIdle(): Promise<void> { return this.completion; }

  async run<T>(action: () => Promise<T>): Promise<T> {
    if (this.owner) throw new Error('capability:busy');
    const owner: OperationOwner = { closed: false };
    let finish!: () => void;
    this.completion = new Promise(resolve => { finish = resolve; });
    this.owner = owner;
    try {
      return await action();
    } finally {
      owner.closed = true;
      try { owner.release?.(); }
      finally {
        if (this.owner === owner) this.owner = undefined;
        finish();
      }
    }
  }

  // Callers await guards inside run; a release ends the lease, not the operation.
  async guard(policy: Readonly<CapabilityPolicy>, hooks: CapabilityGateHooks): Promise<() => void> {
    const owner = this.owner;
    if (!owner || owner.closed || owner.release) throw new Error('capability:busy');
    const { scope, pluginId } = policy;
    if (scope !== 'discovery' && scope !== 'theme' && scope !== 'runtime')
      throw new Error('capability:invalid-input');

    let releaseRuntime: (() => void) | undefined;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      if (this.owner !== owner || owner.release !== release) return;
      owner.release = undefined;
      releaseRuntime?.();
    };
    owner.release = release;
    const assertOwner = () => {
      if (this.owner !== owner || owner.closed || owner.release !== release)
        throw new Error('capability:busy');
    };
    try {
      hooks.assertAvailable();
      if (scope === 'runtime') {
        // Promotion must precede the first idle-check await, including RPC reads.
        releaseRuntime = hooks.acquireRuntime();
        await hooks.assertIdle();
        assertOwner();
        if (pluginId !== undefined) {
          if (!hooks.assertResource) throw new Error('capability:resource-check-required');
          await hooks.assertResource(pluginId);
          assertOwner();
          await hooks.assertIdle();
        }
      } else if (scope === 'theme' && pluginId !== undefined) {
        await hooks.assertResource?.(pluginId);
        assertOwner();
        hooks.assertAvailable();
      }
      assertOwner();
      return release;
    } catch (error) {
      release();
      throw error;
    }
  }
}
