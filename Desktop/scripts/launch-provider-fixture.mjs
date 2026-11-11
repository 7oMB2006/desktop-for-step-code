import { setTimeout as delay } from 'node:timers/promises';

export async function waitForLaunchProviderRequest(requests, index, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (requests.length <= index) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`Goal provider request ${index + 1} did not arrive within ${timeout}ms`);
    await delay(Math.min(20, remaining));
  }
  return requests[index];
}
