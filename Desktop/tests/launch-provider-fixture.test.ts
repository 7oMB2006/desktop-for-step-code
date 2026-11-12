import assert from 'node:assert/strict';
import test from 'node:test';

const { waitForLaunchProviderRequest } = await import(
  new URL('../scripts/launch-provider-fixture.mjs', import.meta.url).href);

test('Goal UI readiness does not substitute for a provider request arriving', async () => {
  const requests: object[] = [];
  let resolved = false;
  const pending = waitForLaunchProviderRequest(requests, 0).then((request: object) => {
    resolved = true;
    return request;
  });
  await Promise.resolve();
  assert.equal(resolved, false, 'The provider has not received a request yet');
  const request = { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'fixture' } }] }] };
  requests.push(request);
  assert.equal(await pending, request);
});

test('an existing earlier request cannot satisfy a new Goal request', async () => {
  const earlier = { messages: [] };
  await assert.rejects(waitForLaunchProviderRequest([earlier], 1, 0), /Goal provider request 2 did not arrive/);
  const next = { messages: [] };
  assert.equal(await waitForLaunchProviderRequest([earlier, next], 1, 0), next);
});

test('an arrived request without images is returned, not hidden behind an attachment timeout', async () => {
  const request = { messages: [{ role: 'user', content: 'No image' }] };
  const arrived = await waitForLaunchProviderRequest([request], 0, 0);
  assert.equal(arrived, request);
  assert.throws(() => assert.ok(JSON.stringify(arrived.messages).includes('image_url')), assert.AssertionError);
});

test('a missing provider request fails at its bounded arrival deadline', async () => {
  await assert.rejects(waitForLaunchProviderRequest([], 0, 0), /did not arrive within 0ms/);
});

test('a missing provider request fails after polling until a positive deadline', { timeout: 1000 }, async () => {
  await assert.rejects(waitForLaunchProviderRequest([], 0, 25), /did not arrive within 25ms/);
});
