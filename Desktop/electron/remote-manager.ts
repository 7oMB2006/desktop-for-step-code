import { randomInt, randomUUID } from 'node:crypto';
import { basename, resolve } from 'node:path';
import type { RuntimeEvent } from '../src/contracts';
import type { RemoteSnapshot } from '../src/remote';
import { RemoteManager as RemoteCore, type RemoteChannel, type RemoteHost } from './remote-manager-core';
import type { RemotePersistence } from './remote-schema';

export { parseRemoteAction, remoteDecision, type RemoteChannel, type RemoteHost } from './remote-manager-core';
export class RemoteManager extends RemoteCore {
  constructor(host: RemoteHost, create: (receive: (event: RuntimeEvent) => void) => RemoteChannel,
    changed: (state: RemoteSnapshot) => void, now = Date.now, persistence?: RemotePersistence) {
    super(host, create, changed, now, persistence, {
      uuid: randomUUID, bindingCode: () => String(randomInt(10000000, 100000000)),
      basename: path => basename(resolve(path)),
    });
  }
}
