import { pathToFileURL } from 'node:url';

// Keep the irreversible global descriptor inside a disposable child process.
const { CrashLog } = await import(pathToFileURL(process.argv[2]).href);
let calls = 0;
Object.defineProperty(Error, 'prepareStackTrace', { configurable: false, writable: false,
  value: () => { calls++; return 'fixture-immutable-stack'; } });
await new CrashLog(process.argv[3]).record('failure', new Error('safe immutable formatter'));
console.log(`hook calls: ${calls}`);
