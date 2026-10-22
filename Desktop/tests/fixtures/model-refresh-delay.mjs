import { ModelRuntime } from '../../runtime/step/dist/bundle/index.js';

const refresh = ModelRuntime.prototype.refresh;
const offlinePasses = new WeakMap();
ModelRuntime.prototype.refresh = async function (options = {}) {
  if (options.allowNetwork === false) {
    const pass = (offlinePasses.get(this) ?? 0) + 1;
    offlinePasses.set(this, pass);
    // Delay registration's fire-and-forget refresh, not create-time restoration.
    if (pass === 2) {
      process.stdout.write(JSON.stringify({ type: 'fixture_registration_delayed' }) + '\n');
      await new Promise(resolve => setTimeout(resolve, 40));
    }
  }
  return refresh.call(this, options);
};
