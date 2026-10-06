import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { queueFixture } from './queue-demo-fixture.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const executable = process.argv[2] ?? resolve(scriptDir, '../../Desktop for Step Code.exe');
const profile = await mkdtemp(join(tmpdir(), 'step-queue-demo-'));
const fixture = await queueFixture(profile);
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.DESKTOP_TEST_NO_FOCUS;
// Hide the background helper, not the user-facing Electron window.
const child = spawn(executable, [], { env, windowsHide: false, stdio: 'ignore' });
child.once('error', async error => { console.error(error.message); await fixture.close(); process.exitCode = 1; });
child.once('exit', async () => { await fixture.close(); });
