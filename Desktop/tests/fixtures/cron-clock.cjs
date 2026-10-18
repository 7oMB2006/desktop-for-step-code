const { readFileSync } = require('node:fs');
const originalNow = Date.now;
Date.now = () => {
  const value = Number(readFileSync(process.env.DESKTOP_CRON_TEST_CLOCK, 'utf8'));
  return Number.isFinite(value) ? value : originalNow();
};
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  if (url.origin !== process.env.DESKTOP_CRON_TEST_ORIGIN)
    return Promise.reject(new Error('Cron acceptance permits only its local model fixture'));
  return originalFetch(input, init);
};
