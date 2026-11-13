// Electron serializes this callback, so its dependencies must stay inside it.
export function installRuntimeFixturePreload({ app }, { preload, admin = true }) {
  const { join, resolve } = process.getBuiltinModule('path');
  const runtime = app.isPackaged ? join(process.resourcesPath, 'runtime') : resolve('runtime');
  const sessionEntry = join(runtime, 'step/dist/bundle/step.js');
  const cp = process.getBuiltinModule('child_process');
  const spawn = cp.spawn;
  cp.spawn = function(file, args, options) {
    if (args?.some(arg => /step\.js$/.test(arg) || admin && /admin\.mjs$/.test(arg)))
      args = ['--require', preload, ...args];
    else {
      const jobIndex = args?.indexOf('-File'), specIndex = args?.indexOf('-Spec');
      if (jobIndex >= 0 && specIndex >= 0 && args[jobIndex + 1] === join(runtime, 'windows-runtime-job.ps1')) {
        try {
          const spec = JSON.parse(Buffer.from(args[specIndex + 1], 'base64').toString('utf8'));
          if (Array.isArray(spec.args) && spec.args[0] === sessionEntry
            && spec.args.includes('--mode') && spec.args.includes('rpc')) {
            args = [...args];
            args[specIndex + 1] = Buffer.from(JSON.stringify({ ...spec, args: ['--require', preload, ...spec.args] })).toString('base64');
          }
        } catch {}
      }
    }
    return spawn.call(this, file, args, options);
  };
  process.getBuiltinModule('module').syncBuiltinESMExports();
}
