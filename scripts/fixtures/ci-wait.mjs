import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

if (process.env.CI_FIXTURE_PID_FILE) {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore', windowsHide: true,
  });
  writeFileSync(process.env.CI_FIXTURE_PID_FILE, JSON.stringify({ parent: process.pid, child: child.pid }));
}
setInterval(() => {}, 1000);
