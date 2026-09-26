import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';

/**
 * Install / uninstall residue verification.
 *
 * The README lists "installation, upgrade, and uninstall on a clean Windows
 * environment" as unverified. This script makes that check repeatable: snapshot
 * the machine, run the cycle, snapshot again, and report what survived.
 *
 * Notes that came out of running this against a real installer:
 *
 * 1. The NSIS uninstaller is named `Uninstall <productName>.exe`, not
 *    `Uninstall.exe`. Resolve it by pattern from the install directory.
 *
 * 2. The uninstaller returns immediately and deletes asynchronously. Waiting a
 *    fixed interval catches it mid-flight and reports files that are about to
 *    disappear. Poll until the install directory is empty instead.
 *
 * 3. node's child_process cannot start this NSIS installer at all: it dies
 *    with 3221225477 (0xC0000005 access violation) whatever stdio mode or
 *    windowsVerbatimArguments you use. The identical launch through PowerShell
 *    Start-Process exits 0 and installs all files, so the install and
 *    uninstall steps go through startProcess() and the app through
 *    launchAndObserve().
 *
 * 4. The uninstaller's /S was observed once to still pop its confirmation
 *    dialog and wait for a click, but four later runs completed silently in
 *    2-6s. The loop therefore cannot be assumed fully unattended; keep the
 *    printed warning when running it in CI. The app is stopped before the
 *    uninstaller runs so a live process cannot hold files open and fake a
 *    residue FAIL.
 *
 * 5. Launching the packaged app needs ELECTRON_RUN_AS_NODE stripped from the
 *    environment first. Some CI/harness setups export it, and with it set the
 *    electron.exe degrades to a bare node REPL: no args means "read stdin to
 *    EOF" and the process exits 0 in milliseconds, so "launched once" can never
 *    fail. launchAndObserve() removes it and reports the measured process
 *    lifetime and exit code instead of a sleep that merely elapsed.
 *
 * 6. `upgrade` asks the opposite question of `verify`. install/uninstall cares
 *    whether residue was cleaned; upgrade cares whether what should have
 *    survived did (v1 userData) and what should not have been duplicated was
 *    not (install-dir file count versus a *measured* fresh-v2 baseline, and
 *    exactly one registry uninstall entry). The baseline comes from a real
 *    fresh install of v2 and is passed in with --baseline-files; it is never
 *    hard-coded, because a guessed number makes the row meaningless.
 *
 * Design notes beyond those:
 * - `~/.stepcode` is compared file-by-file rather than by a single tree hash,
 *   so drift can be attributed instead of merely detected.
 * - The install directory is judged on its contents, because an empty root
 *   directory left behind is known NSIS behaviour rather than a leak.
 * - Registry uninstall entries are matched on DisplayName *values*, obtained
 *   with `reg query /s /v DisplayName`. A plain `reg query <Uninstall>` lists
 *   only GUID subkey names, so an app-name filter over those lines can never
 *   match and the check stays green even while the app is installed.
 * - Two checks were deleted rather than tuned to pass, because a check on a
 *   path the program never writes is worse than no check:
 *     · `HKCU\Software\<app>` — the NSIS template (installer.nsh) only writes
 *       the `Uninstall\<guid>` key (plus optional `Software\Classes\*` file
 *       associations, which this app does not configure); the key does not
 *       exist even while the app is installed, so the row was always PASS.
 *     · `%LOCALAPPDATA%\<app>` cache — this app keeps its Electron caches
 *       (Code Cache, GPUCache, ShaderCache, Network, …) under userData, which
 *       is intentionally preserved (deleteAppDataOnUninstall=false). The
 *       LocalAppData path never appears, not even after a real 10s app run.
 *
 * Usage (run from Desktop/):
 *   node scripts/verify-residue.mjs snapshot --label before
 *   node scripts/verify-residue.mjs diff test-results/residue-before.json test-results/residue-after.json
 *   node scripts/verify-residue.mjs env [target-dir]
 *   node scripts/verify-residue.mjs verify --installer "release/Desktop for Step Code Setup 0.1.0.exe"
 *   node scripts/verify-residue.mjs upgrade --from <v1.exe> --to <v2.exe> --baseline-files N
 *   node scripts/verify-residue.mjs upgrade-diff before.json after-v1.json after-upgrade.json after-upgrade-launch.json after-uninstall.json --baseline-files N
 *
 * No third-party dependencies: this has to run on a bare Node install, because
 * the point is to verify what a user experiences, not what CI has cached.
 */

const APP_NAME = 'Desktop for Step Code';
const RESULTS_DIR = 'test-results';
const PROFILE_DIR = join(homedir(), '.stepcode');
const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 120000;
const LAUNCH_OBSERVE_MS = 10000;
const LAUNCH_MIN_ALIVE_MS = 3000;

const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');

const PATHS = {
  installDir: join(localAppData, 'Programs', APP_NAME),
  userData: join(appData, APP_NAME),
  startMenuShortcut: join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${APP_NAME}.lnk`),
  desktopShortcut: join(homedir(), 'Desktop', `${APP_NAME}.lnk`),
  profile: PROFILE_DIR,
};

/** 文件计数与字节数；路径不存在时 exists=false。 */
function measure(target) {
  if (!existsSync(target)) return { exists: false };
  const stat = statSync(target);
  if (!stat.isDirectory()) return { exists: true, files: 0, bytes: stat.size };
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(target, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    files += 1;
    try {
      bytes += statSync(join(entry.parentPath ?? entry.path, entry.name)).size;
    } catch {
      // 并发删除中的文件：计入文件数但跳过体积，别让测量本身崩掉
    }
  }
  return { exists: true, files, bytes };
}

/** 整棵目录树逐文件记录：相对路径 → { size, mtimeMs, md5 }。 */
function treeFiles(root) {
  const files = {};
  if (!existsSync(root)) return files;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      try {
        const body = readFileSync(full);
        files[relative(root, full).split('\\').join('/')] = {
          size: body.length,
          mtimeMs: statSync(full).mtimeMs,
          md5: createHash('md5').update(body).digest('hex'),
        };
      } catch {
        // 读取失败的文件记不下来内容，但别让一次权限问题毁掉整轮
      }
    }
  };
  walk(root);
  return files;
}

/**
 * 本应用的卸载注册表项数量；查询失败返回 null 而不是 0——0 会被判定为
 * 「已清理」，那会让一次查询失败伪装成 PASS。
 *
 * 必须 /s /v DisplayName：不带 /s 的 `reg query <Uninstall>` 只输出 GUID 子键名
 * （如 4ce36081-0c28-53d2-b28c-ef7f38214c22），应用名只存在于子键内的
 * DisplayName 值里。老代码用应用名去匹每一行文本，永远不中，于是安装状态下
 * 这一项也报 0/removed。
 */
function uninstallEntryCount() {
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall';
  let out;
  try {
    out = execFileSync('reg', ['query', key, '/s', '/v', 'DisplayName'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
  let count = 0;
  for (const line of out.split(/\r?\n/)) {
    const match = line.match(/^\s*DisplayName\s+REG_\S+\s+(.+?)\s*$/i);
    if (match && match[1].includes(APP_NAME)) count += 1;
  }
  return count;
}

function registryState() {
  return { uninstallEntries: uninstallEntryCount() };
}

function snapshot(extra = {}) {
  const profileFiles = treeFiles(PATHS.profile);
  const profileKeys = Object.keys(profileFiles);
  const profileBytes = profileKeys.reduce((sum, k) => sum + profileFiles[k].size, 0);
  return {
    timestamp: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    paths: {
      installDir: measure(PATHS.installDir),
      userData: measure(PATHS.userData),
      startMenuShortcut: measure(PATHS.startMenuShortcut),
      desktopShortcut: measure(PATHS.desktopShortcut),
      profile: {
        exists: profileKeys.length > 0,
        files: profileKeys.length,
        bytes: profileBytes,
        md5: profileKeys.length > 0
          ? createHash('md5').update(JSON.stringify(profileFiles)).digest('hex')
          : null,
      },
    },
    profileFiles,
    // 逐文件记录 userData：upgrade 判定要回答「v1 阶段写的文件升级后还在不在、
    // 有没有被清空」，只有 files 计数是答不出来的
    userDataFiles: treeFiles(PATHS.userData),
    registry: registryState(),
    ...extra,
  };
}

/** 两棵 profile 树的逐文件 diff。 */
function profileDiff(before, after) {
  const b = before.profileFiles ?? {};
  const a = after.profileFiles ?? {};
  const added = Object.keys(a).filter(k => !(k in b));
  const removed = Object.keys(b).filter(k => !(k in a));
  const changed = Object.keys(a).filter(k => k in b && b[k].md5 !== a[k].md5);
  return { added, removed, changed, clean: added.length === 0 && removed.length === 0 && changed.length === 0 };
}

/** 判定表：每一项都给出 expect / actual，FAIL 时能直接看出差在哪。 */
function verdict(after, before) {
  const rows = [];
  // 快捷方式是单个 .lnk：measure 对文件记 files=0、bytes=大小，
  // 直接显示 "present (0 files)" 会误导，这里按文件/目录分别描述
  const describe = (value) => {
    if (!value.exists) return 'absent';
    if (value.files > 0) return `present (${value.files} files)`;
    return value.bytes > 0 ? `present (file, ${value.bytes} bytes)` : 'present (empty)';
  };
  const removed = (label, key) => {
    const value = after.paths[key];
    rows.push({ item: label, expect: 'removed', actual: value.exists ? describe(value) : 'removed', pass: !value.exists });
  };
  const mayRemain = (label, key) => {
    const value = after.paths[key];
    rows.push({ item: label, expect: 'may remain', actual: describe(value), pass: true });
  };

  // 「Cache directory」与「Registry app key」两项已整行删除，原因见文件头
  // design notes：一个程序从不写的路径，检查它只会得到恒真的 PASS。
  removed('Start menu shortcut', 'startMenuShortcut');
  removed('Desktop shortcut', 'desktopShortcut');
  mayRemain('userData (deleteAppDataOnUninstall=false)', 'userData');

  // 安装目录按内容判定：文件删干净即通过，空目录本身是已知的 NSIS 行为
  const install = after.paths.installDir;
  if (!install.exists) {
    rows.push({ item: 'Install directory', expect: 'removed', actual: 'removed', pass: true });
  } else if (install.files === 0) {
    rows.push({ item: 'Install directory', expect: 'files removed', actual: 'empty directory left (NSIS behaviour, cosmetic)', pass: true });
  } else {
    rows.push({ item: 'Install directory', expect: 'files removed', actual: `${install.files} files left`, pass: false });
  }

  const diff = profileDiff(before, after);
  rows.push({
    item: '~/.stepcode untouched',
    expect: 'no file added, removed or changed',
    actual: diff.clean
      ? `identical (${after.paths.profile.files} files)`
      : `${diff.added.length} added, ${diff.removed.length} removed, ${diff.changed.length} changed`,
    pass: diff.clean,
    detail: diff.clean ? [] : [...diff.added, ...diff.removed, ...diff.changed].slice(0, 10),
  });

  // null = reg 查询本身失败：宁可变红也不要把失败读成「已清理」
  const entries = after.registry.uninstallEntries;
  rows.push({
    item: 'Registry uninstall entry',
    expect: 'removed',
    actual: entries === null ? 'reg query failed' : entries === 0 ? 'removed' : `${entries} left`,
    pass: entries === 0,
  });
  return rows;
}

function printVerdict(rows, extraRows = []) {
  const all = [...rows, ...extraRows];
  const width = Math.max(...all.map(r => r.item.length)) + 2;
  console.log('');
  console.log('  ' + 'item'.padEnd(width) + 'result');
  console.log('  ' + '-'.repeat(width + 8));
  for (const row of all) {
    console.log('  ' + row.item.padEnd(width) + (row.pass ? 'PASS' : 'FAIL') + '   ' + row.actual);
    if (row.detail && row.detail.length > 0) {
      for (const path of row.detail) console.log('      · ' + path);
    }
  }
  const failed = all.filter(r => !r.pass);
  console.log('');
  if (failed.length === 0) {
    console.log('  all checks passed');
  } else {
    console.log(`  ${failed.length} check(s) failed`);
    console.log('  if ~/.stepcode drifted, check the timestamps of the listed files: the');
    console.log('  desktop app redirects its own runtime to %APPDATA% via STEPCODE_*, so drift');
    console.log('  here usually means the Step CLI ran during the test window, not the app.');
  }
  return failed.length;
}

/**
 * upgrade 判定表。与 install 判定（verdict）分工：
 *   verdict      问「卸没卸干净」——东西该消失；
 *   upgradeVerdict 问「该留的留没留、该清的清没清」——数据该留下，
 *                 重复的安装产物/注册表项不该留下。
 * baselineFiles 是「v2 全新安装」的实测文件数，由调用方传入（见 upgrade 命令
 * 对 --baseline-files 的强制要求）；写成猜的数字，这条判定就失去意义。
 */
function upgradeVerdict(snaps, baselineFiles) {
  const rows = [];
  const v1Inventory = snaps.afterV1.userDataFiles ?? {};
  const upgradeInventory = snaps.afterUpgrade.userDataFiles ?? {};
  const v2Inventory = snaps.afterUpgradeLaunch.userDataFiles ?? {};

  // v1 阶段的用户数据，覆盖安装之后必须原样还在（内容被改写不算失败）
  const acrossInstall = inventoryDiff(v1Inventory, upgradeInventory);
  rows.push({
    item: 'userData kept across v1 -> v2',
    expect: 'v1 files present, none emptied',
    actual: `${acrossInstall.missing.length} missing, ${acrossInstall.emptied.length} emptied, ${acrossInstall.modified.length} modified`,
    pass: acrossInstall.missing.length === 0 && acrossInstall.emptied.length === 0,
    detail: [...acrossInstall.missing, ...acrossInstall.emptied].slice(0, 10),
  });

  // 覆盖安装不能叠加：文件数应等于 v2 全新安装，而不是 v1+v2
  const files = snaps.afterUpgrade.paths.installDir.files;
  rows.push({
    item: 'Install directory after upgrade',
    expect: `${baselineFiles} files (fresh v2 install baseline, not v1+v2)`,
    actual: files === undefined ? 'absent' : `${files} files`,
    pass: files === baselineFiles,
  });

  // 卸载项必须还是 1 个：覆盖安装复用同一个 GUID 键，多一个就是注册表残留
  const entries = snaps.afterUpgrade.registry.uninstallEntries;
  rows.push({
    item: 'Registry uninstall entries after upgrade',
    expect: '1 (not 2)',
    actual: entries === null ? 'reg query failed' : String(entries),
    pass: entries === 1,
  });

  // 升级后启动：进程真的活过 minima，且 v1 数据没被新版本的第一次运行抹掉。
  // 「能读到 v1 数据」在这里的可行代理是「v1 文件在 v2 跑完之后仍然完好」——
  // 进程内部读了什么从外部看不见，这一点在报告里要写明是代理而非直接证明。
  const acrossLaunch = inventoryDiff(v1Inventory, v2Inventory);
  const obs = snaps.afterUpgradeLaunch.launch ?? null;
  rows.push({
    item: 'v2 launches and v1 data survives it',
    expect: `process alive >= ${LAUNCH_MIN_ALIVE_MS}ms; v1 files still present`,
    actual: obs === null
      ? 'no launch recorded'
      : `${obs.stillRunning ? 'still running' : 'exited'} after ${obs.aliveMs}ms; ${acrossLaunch.missing.length} missing, ${acrossLaunch.emptied.length} emptied`,
    pass: obs !== null
      && obs.aliveMs >= LAUNCH_MIN_ALIVE_MS
      && acrossLaunch.missing.length === 0
      && acrossLaunch.emptied.length === 0,
    detail: [...acrossLaunch.missing, ...acrossLaunch.emptied].slice(0, 10),
  });

  // 最终卸载残留：与 install 判定用同一个函数、同一把尺子
  rows.push(...verdict(snaps.afterUninstall, snaps.before));
  return rows;
}

/**
 * 删除本应用的卸载注册表项（按 DisplayName 值定位 GUID 子键后整键删除）。
 * upgrade 流程要求从「从未安装过」的状态起步：上一个安装留下的卸载项会让
 * 「升级后仍是 1 个卸载项」这条判定失去意义。
 * 返回删除的条目数。
 */
function removeAppUninstallEntries() {
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall';
  let out;
  try {
    out = execFileSync('reg', ['query', key, '/s', '/v', 'DisplayName'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return 0;
  }
  let current = null;
  let removed = 0;
  for (const line of out.split(/\r?\n/)) {
    const keyLine = line.match(/^\s*(HKEY_[A-Za-z0-9_]+(?:\\[^\s]+)*)\s*$/);
    if (keyLine) {
      current = keyLine[1];
      continue;
    }
    const name = line.match(/^\s*DisplayName\s+REG_\S+\s+(.+?)\s*$/i);
    if (current && name && name[1].includes(APP_NAME)) {
      try {
        execFileSync('reg', ['delete', current, '/f'], { stdio: 'ignore' });
        removed += 1;
      } catch {
        // 删不掉的键留给后面的计数判定去暴露，不静默
      }
      current = null;
    }
  }
  return removed;
}

/**
 * 两棵 userData 清单的对比：丢失 / 被清空 / 内容有变。
 * 「有变」不算失败——新版本启动时改写配置、追加日志都是正常的；只有
 * 文件没了、或者从有内容变成 0 字节，才说明数据被抹了。
 */
function inventoryDiff(before, after) {
  const missing = [];
  const emptied = [];
  const modified = [];
  for (const [path, entry] of Object.entries(before)) {
    const next = after[path];
    if (!next) {
      missing.push(path);
      continue;
    }
    if (entry.size > 0 && next.size === 0) {
      emptied.push(path);
      continue;
    }
    if (next.md5 !== entry.md5) modified.push(path);
  }
  return { missing, emptied, modified };
}

/**
 * 启动观测的统一出口：打印 ELECTRON_RUN_AS_NODE 剔除警告、进程存活事实，
 * 并生成对应的 verdict 行。label 为空时保持 verify 命令原有的行名。
 */
function reportLaunch(label, obs, { suffixItem = true } = {}) {
  if (obs.poisoned) {
    console.log('  warning: ELECTRON_RUN_AS_NODE was set in this environment and has been');
    console.log('  removed for the launch. Left in place it degrades the packaged electron.exe');
    console.log('  to a bare node REPL that exits 0 on EOF, so the launch could never be observed.');
  }
  console.log(`  ${label} process: ${obs.stillRunning ? 'still running' : 'exited'} after ${obs.aliveMs}ms` + (obs.exitCode === null ? '' : ` (exit code ${obs.exitCode})`));
  return {
    item: label && suffixItem ? `App process after launch (${label})` : 'App process after launch',
    expect: `alive >= ${LAUNCH_MIN_ALIVE_MS}ms`,
    actual: obs.stillRunning
      ? `still running after ${obs.aliveMs}ms`
      : `exited after ${obs.aliveMs}ms with code ${obs.exitCode}`,
    pass: obs.aliveMs >= LAUNCH_MIN_ALIVE_MS,
  };
}

/** 停掉应用并等它退出；卸载/升级前调用，避免运行中的进程占文件。 */
async function stopApp() {
  try {
    execFileSync('taskkill', ['/IM', `${APP_NAME}.exe`, '/T', '/F'], { stdio: 'ignore' });
  } catch {
    // 已经退出也算达成目标
  }
  if (!(await waitForProcessExit(`${APP_NAME}.exe`))) {
    console.log('  warning: app still running after taskkill; later steps may see open files');
  }
}

/**
 * 容错的文件计数。卸载过程中目录被逐个删除，recursive readdirSync 会在遍历途中
 * 撞上 ENOENT——那不是错误，是"删得比遍历快"，此时按已空处理。
 */
function countFilesQuietly(dir) {
  try {
    if (!existsSync(dir)) return 0;
    return readdirSync(dir, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).length;
  } catch {
    return 0;
  }
}

/** 轮询到条件满足或超时；NSIS 的安装与卸载都是异步的，固定等待会抓到中间态。 */
async function waitFor(label, predicate, timeoutMs = POLL_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = predicate();
    if (last.done) return last;
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`timed out waiting for ${label} (last: ${JSON.stringify(last)})`);
}

/** 卸载器实际名为 "Uninstall <productName>.exe"；按模式匹配。 */
function findUninstaller() {
  if (!existsSync(PATHS.installDir)) return null;
  const match = readdirSync(PATHS.installDir).find(name => /^Uninstall.*\.exe$/i.test(name));
  return match ? join(PATHS.installDir, match) : null;
}

/**
 * 完整隔离一套环境变量，让 runtime 在测试期间不碰真实 ~/.stepcode。
 * 桌面端自己会用 isolatedEnvironment() 做同样的事；这里给单独跑 runtime 的人复用。
 */
function isolatedRuntimeEnv(target) {
  mkdirSync(target, { recursive: true });
  return {
    STEPCODE_STORAGE_ROOT_DIR: target,
    STEPCODE_AUTH_PATH: join(target, 'auth.json'),
    STEPCODE_LEGACY_AUTH_PATH: join(target, 'legacy-auth.json'),
    STEPCODE_CONFIG_PATH: join(target, 'config.toml'),
    STEP_CODING_AGENT_DIR: join(target, 'agent'),
    STEP_CODING_AGENT_SESSION_DIR: join(target, 'sessions'),
  };
}

/** PowerShell 可执行文件全路径；找不到时退回 PATH 解析。 */
function powershellExe() {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  const psPath = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return existsSync(psPath) ? psPath : 'powershell.exe';
}

/** PowerShell 单引号字符串字面量：路径中的单引号翻倍转义。 */
function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** 文件 SHA256；用来拦住「同一个包装两遍冒充升级」。 */
function fileSha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * 经 PowerShell Start-Process 调用外部可执行文件，返回其退出码。
 *
 * 为什么绕这一圈：node 的 child_process（execFileSync / spawnSync，stdio
 * ignore / inherit / pipe、windowsVerbatimArguments 均试过）直接启动这个
 * NSIS 安装器必崩，退出码 3221225477（0xC0000005 访问冲突）；同一条命令
 * 经 PowerShell Start-Process 发出则退出码 0，安装产物完整。安装器本身
 * 没有问题，是 node 侧拉起方式的问题。
 */
function startProcess(file, { args = [], wait = true } = {}) {
  const argList = args.length > 0 ? ` -ArgumentList ${args.map(psQuote).join(',')}` : '';
  const waitFlag = wait ? ' -Wait' : '';
  const command = `try { $proc = Start-Process -FilePath ${psQuote(file)}${argList}${waitFlag} -PassThru -ErrorAction Stop } catch { Write-Error $_; exit 1 }; if ($null -ne $proc -and $null -ne $proc.ExitCode) { exit $proc.ExitCode }; exit 0`;
  return execFileSync(powershellExe(), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], { stdio: 'inherit', windowsHide: true });
}

/**
 * 启动一次应用并观测进程存活，返回 { poisoned, aliveMs, exitCode, stillRunning }。
 *
 * 两个坑都是实测踩出来的：
 * 1. 本 harness 环境注入了 ELECTRON_RUN_AS_NODE=1，packaged electron.exe 因此
 *    退化成纯 node：无参启动就是一个 REPL，stdin 为空时立刻 EOF 退出（exit 0，
 *    约 50ms）。不剔除这个变量，"启动一次"永远是假成功——机器上四份快照里
 *    userData 零新写盘就是这么来的。真实用户环境没有它，剔除只是把测试环境
 *    对齐到用户体验，调用方会把剔除动作打出来。NODE_OPTIONS 同理剔除。
 * 2. 用 tasklist 轮询进程存活会漏掉 50ms 级窗口（500ms 轮询全都扑空）。
 *    改用 Start-Process -PassThru + WaitForExit(窗口)：退出与否、退出码、
 *    存活毫秒数都是确定性返回值，不存在 race。
 */
function launchAndObserve(file, { observeMs = LAUNCH_OBSERVE_MS } = {}) {
  const env = { ...process.env };
  const poisoned = 'ELECTRON_RUN_AS_NODE' in env;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  const command = [
    `$proc = Start-Process -FilePath ${psQuote(file)} -PassThru -ErrorAction Stop`,
    '$sw = [System.Diagnostics.Stopwatch]::StartNew()',
    `$exited = $proc.WaitForExit(${observeMs})`,
    '$aliveMs = [int]$sw.ElapsedMilliseconds',
    '$ec = if ($exited) { [string]$proc.ExitCode } else { \'\' }',
    'Write-Output ("APP_OBSERVED|$aliveMs|$ec")',
  ].join('; ');
  const out = execFileSync(powershellExe(), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], { stdio: ['ignore', 'pipe', 'ignore'], env });
  const line = String(out).split(/\r?\n/).map(s => s.trim()).find(s => s.startsWith('APP_OBSERVED|'));
  if (!line) throw new Error(`launch observation produced no output (raw: ${String(out).slice(0, 200)})`);
  const aliveMs = Number(line.split('|')[1]) || 0;
  const exitCode = line.split('|')[2];
  return { poisoned, aliveMs, exitCode: exitCode === '' ? null : Number(exitCode), stillRunning: exitCode === '' };
}

/** 轮询等到进程退出；tasklist 不可用时直接放行，不把等待变成硬失败。 */
async function waitForProcessExit(imageName, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let listing = '';
    try {
      listing = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${imageName}`, '/NH'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return true;
    }
    if (!listing.toLowerCase().includes(imageName.toLowerCase())) return true;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

const args = process.argv.slice(2);
const command = args[0];

if (command === 'snapshot') {
  const labelIndex = args.indexOf('--label');
  const label = labelIndex >= 0 ? args[labelIndex + 1] : 'snapshot';
  mkdirSync(RESULTS_DIR, { recursive: true });
  const output = join(RESULTS_DIR, `residue-${label}.json`);
  const data = snapshot();
  writeFileSync(output, JSON.stringify(data, null, 2));
  console.log(`  wrote ${output}`);
  console.log(`  installDir:    ${data.paths.installDir.exists ? `${data.paths.installDir.files} files` : 'absent'}`);
  console.log(`  userData:      ${data.paths.userData.exists ? `${data.paths.userData.files} files` : 'absent'}`);
  console.log(`  ~/.stepcode:   ${data.paths.profile.exists ? `${data.paths.profile.files} files, ${data.paths.profile.bytes} bytes` : 'absent'}`);
} else if (command === 'diff') {
  const before = args[1];
  const after = args[2];
  if (!before || !after) {
    console.error('  usage: verify-residue.mjs diff <before.json> <after.json>');
    process.exit(2);
  }
  const failed = printVerdict(verdict(JSON.parse(readFileSync(after, 'utf8')), JSON.parse(readFileSync(before, 'utf8'))));
  process.exit(failed === 0 ? 0 : 1);
} else if (command === 'env') {
  const target = args[1] ?? join(process.cwd(), RESULTS_DIR, 'isolated-runtime');
  for (const [key, value] of Object.entries(isolatedRuntimeEnv(target))) {
    console.log(`$env:${key} = "${value}"`);
  }
} else if (command === 'verify') {
  const installerIndex = args.indexOf('--installer');
  const installer = installerIndex >= 0 ? args[installerIndex + 1] : null;
  if (!installer || !existsSync(installer)) {
    console.error('  usage: verify-residue.mjs verify --installer <path-to-setup.exe>');
    process.exit(2);
  }
  mkdirSync(RESULTS_DIR, { recursive: true });
  const step = (label) => {
    const data = snapshot();
    const output = join(RESULTS_DIR, `residue-${label}.json`);
    writeFileSync(output, JSON.stringify(data, null, 2));
    console.log(`  [${label}] ${output}`);
    return output;
  };

  // 环境里已有 STEPCODE_* 时先警告：那会让 ~/.stepcode 的结论不可信
  const ambient = Object.keys(process.env).filter(k => /^STEPCODE_|^STEP_CODING_AGENT_/.test(k));
  if (ambient.length > 0) {
    console.log(`  warning: ambient ${ambient.join(', ')} redirects runtime writes;`);
    console.log('  the ~/.stepcode comparison may attribute them to the app');
  }

  console.log('  cleaning any previous install');
  if (existsSync(PATHS.installDir)) rmSync(PATHS.installDir, { recursive: true, force: true });
  const before = step('before');

  console.log('  installing (silent, per-user)');
  startProcess(installer, { args: ['/S'] });
  await waitFor('install to finish', () => {
    const exe = join(PATHS.installDir, `${APP_NAME}.exe`);
    const done = existsSync(exe) && existsSync(findUninstaller() ?? '');
    return { done, files: done ? 1 : 0 };
  });
  const installed = step('installed');

  console.log('  launching once');
  const exe = join(PATHS.installDir, `${APP_NAME}.exe`);
  if (!existsSync(exe)) {
    console.error(`  app exe not found at ${exe}; cannot verify launch`);
    process.exit(2);
  }
  const obs = launchAndObserve(exe);
  // 进程是否真的活过 LAUNCH_MIN_ALIVE_MS，是"启动一次"唯一的自证：
  // 50ms exit 0 的 REPL 假启动在这里无处遁形，verdict 表里单独一行。
  const launchRow = reportLaunch('app', obs, { suffixItem: false });
  const launched = step('launched');

  console.log('  stopping the app before uninstall');
  // 启动过的应用如果还活着，卸载器删不掉正在使用的文件，会伪造出 residue FAIL。
  // 正常用户也是先关应用再卸载，这一步只让循环确定性地走到卸载器。
  await stopApp();

  console.log('  uninstalling');
  const uninstaller = findUninstaller();
  if (!uninstaller) {
    console.error(`  uninstaller not found in ${PATHS.installDir}`);
    process.exit(2);
  }
  // 注：此安装包的 /S 曾被观察到仍会弹确认框等人点（后续 4 次又是静默完成）。
  // 所以 verify 不保证全无人值守——跑 CI 前先确认对话框行为，别让卸载步骤挂住。
  console.log('  uninstaller started; /S was once seen to still show its confirmation');
  console.log('  dialog (four later runs were silent), so a window may be waiting for a click');
  startProcess(uninstaller, { args: ['/S'] });
  await waitFor('uninstall to finish', () => {
    const files = countFilesQuietly(PATHS.installDir);
    return { done: files === 0, files };
  });
  const after = step('after');

  console.log('');
  console.log(`  snapshots: ${before} / ${installed} / ${launched} / ${after}`);
  const failed = printVerdict(verdict(JSON.parse(readFileSync(after, 'utf8')), JSON.parse(readFileSync(before, 'utf8'))), [launchRow]);
  process.exit(failed === 0 ? 0 : 1);
} else if (command === 'upgrade') {
  const flag = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : null;
  };
  const from = flag('--from');
  const to = flag('--to');
  const baselineFiles = flag('--baseline-files') === null ? null : Number(flag('--baseline-files'));
  if (!from || !to || !existsSync(from) || !existsSync(to)) {
    console.error('  usage: verify-residue.mjs upgrade --from <v1-setup.exe> --to <v2-setup.exe> --baseline-files N');
    process.exit(2);
  }
  // 同一个包装两遍不构成升级测试，先拦住
  if (fileSha256(from) === fileSha256(to)) {
    console.error('  --from and --to are the same file; an upgrade test needs two different builds');
    process.exit(2);
  }
  // 基准是实测值，不是猜的：单独装一次 v2、数安装目录文件数、把数字带进来
  if (baselineFiles === null || !Number.isInteger(baselineFiles) || baselineFiles <= 0) {
    console.error('  --baseline-files N is required: install v2 on a clean state, count the');
    console.error('  install-directory files, and pass that number. A guessed number would make');
    console.error('  the "not v1+v2" row meaningless.');
    process.exit(2);
  }
  mkdirSync(RESULTS_DIR, { recursive: true });
  const step = (label, extra) => {
    const data = snapshot(extra);
    const output = join(RESULTS_DIR, `residue-${label}.json`);
    writeFileSync(output, JSON.stringify(data, null, 2));
    console.log(`  [${label}] ${output}`);
    return output;
  };
  const installDone = () => {
    const exe = join(PATHS.installDir, `${APP_NAME}.exe`);
    const done = existsSync(exe) && existsSync(findUninstaller() ?? '');
    return { done, files: done ? 1 : 0 };
  };

  // 从「从未安装过」起步：安装目录、userData、卸载注册表项、快捷方式全清。
  // userData 也清，这样 after-v1 清单里只有 v1 自己写出来的东西——
  // 混着上一个安装的残留，「数据有没有保住」就说不清了。
  console.log('  cleaning any previous install (fresh state for an upgrade test)');
  if (existsSync(PATHS.installDir)) rmSync(PATHS.installDir, { recursive: true, force: true });
  if (existsSync(PATHS.userData)) rmSync(PATHS.userData, { recursive: true, force: true });
  const removedKeys = removeAppUninstallEntries();
  if (removedKeys > 0) console.log(`  removed ${removedKeys} leftover uninstall registry entr${removedKeys === 1 ? 'y' : 'ies'}`);
  for (const shortcut of [PATHS.startMenuShortcut, PATHS.desktopShortcut]) {
    if (existsSync(shortcut)) {
      rmSync(shortcut, { force: true });
      console.log(`  removed leftover shortcut ${shortcut}`);
    }
  }
  const before = step('before');

  console.log('  installing v1 (silent, per-user)');
  startProcess(from, { args: ['/S'] });
  await waitFor('v1 install to finish', installDone);

  console.log('  launching v1 once; this run is where user data comes from');
  const exe = join(PATHS.installDir, `${APP_NAME}.exe`);
  if (!existsSync(exe)) {
    console.error(`  app exe not found at ${exe}; cannot verify launch`);
    process.exit(2);
  }
  const obsV1 = launchAndObserve(exe);
  const launchRowV1 = reportLaunch('v1', obsV1);
  // 先停再快照：运行中的 lockfile 之类的瞬时文件会在退出时消失，
  // 不停机就快照会把它们算进「v1 数据」，之后对不上就是误报
  await stopApp();
  const afterV1 = step('after-v1', { launch: obsV1 });

  console.log('  upgrading: installing v2 over v1 (no uninstall first)');
  startProcess(to, { args: ['/S'] });
  await waitFor('v2 install to finish', installDone);
  const afterUpgrade = step('after-upgrade');

  console.log('  launching v2 once');
  const obsV2 = launchAndObserve(exe);
  const launchRowV2 = reportLaunch('v2', obsV2);
  await stopApp();
  const afterUpgradeLaunch = step('after-upgrade-launch', { launch: obsV2 });

  console.log('  uninstalling');
  const uninstaller = findUninstaller();
  if (!uninstaller) {
    console.error(`  uninstaller not found in ${PATHS.installDir}`);
    process.exit(2);
  }
  startProcess(uninstaller, { args: ['/S'] });
  await waitFor('uninstall to finish', () => {
    const files = countFilesQuietly(PATHS.installDir);
    return { done: files === 0, files };
  });
  const afterUninstall = step('after-uninstall');

  console.log('');
  console.log(`  snapshots: ${before} / ${afterV1} / ${afterUpgrade} / ${afterUpgradeLaunch} / ${afterUninstall}`);
  const snaps = {
    before: JSON.parse(readFileSync(before, 'utf8')),
    afterV1: JSON.parse(readFileSync(afterV1, 'utf8')),
    afterUpgrade: JSON.parse(readFileSync(afterUpgrade, 'utf8')),
    afterUpgradeLaunch: JSON.parse(readFileSync(afterUpgradeLaunch, 'utf8')),
    afterUninstall: JSON.parse(readFileSync(afterUninstall, 'utf8')),
  };
  const failed = printVerdict(upgradeVerdict(snaps, baselineFiles), [launchRowV1, launchRowV2]);
  process.exit(failed === 0 ? 0 : 1);
} else if (command === 'upgrade-diff') {
  // 只重算判定、不碰机器：给「证明检查会 FAIL」用，也方便对已有快照复盘
  const files = [];
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--baseline-files') {
      i += 1;
      continue;
    }
    if (args[i - 1] === '--baseline-files') continue;
    files.push(args[i]);
  }
  const baselineIndex = args.indexOf('--baseline-files');
  const baselineFiles = baselineIndex >= 0 ? Number(args[baselineIndex + 1]) : null;
  if (files.length !== 5 || baselineFiles === null || !Number.isInteger(baselineFiles) || baselineFiles <= 0) {
    console.error('  usage: verify-residue.mjs upgrade-diff <before> <after-v1> <after-upgrade> <after-upgrade-launch> <after-uninstall> --baseline-files N');
    process.exit(2);
  }
  const labels = ['before', 'afterV1', 'afterUpgrade', 'afterUpgradeLaunch', 'afterUninstall'];
  const snaps = {};
  for (let i = 0; i < labels.length; i++) snaps[labels[i]] = JSON.parse(readFileSync(files[i], 'utf8'));
  const failed = printVerdict(upgradeVerdict(snaps, baselineFiles));
  process.exit(failed === 0 ? 0 : 1);
} else {
  console.log('  usage:');
  console.log('    node scripts/verify-residue.mjs snapshot --label <name>');
  console.log('    node scripts/verify-residue.mjs diff <before.json> <after.json>');
  console.log('    node scripts/verify-residue.mjs env [target-dir]');
  console.log('    node scripts/verify-residue.mjs verify --installer <setup.exe>');
  console.log('    node scripts/verify-residue.mjs upgrade --from <v1.exe> --to <v2.exe> --baseline-files N');
  console.log('    node scripts/verify-residue.mjs upgrade-diff <5 snapshots> --baseline-files N');
  process.exit(2);
}
