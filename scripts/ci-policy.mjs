import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { windowsGroups } from './ci-acceptance.mjs';

const documents = new Set([
  'README.md', 'README.zh-CN.md', 'TODO.md', 'DESIGN.md', 'PRODUCT.md',
  'docs/CI.md', 'docs/RELEASE.md', 'docs/UPDATES.md', 'docs/VERIFICATION.md', 'docs/VERSIONING.md',
  'docs/BACKGROUND_AGENTS.md', 'docs/BVR_HOST_BRIDGE.md', 'docs/BTW.md',
  'docs/CAPABILITIES.md', 'docs/CLM.md', 'docs/COMMANDS.md', 'docs/COMPLETION_REVIEW.md',
  'docs/CRON.md', 'docs/MACOS.md', 'docs/NOTIFICATIONS.md', 'docs/PLATFORM_HANDOFF.md',
  'docs/PLAN-INTEGRATION.md', 'docs/PLUGIN_AUTHORING.md', 'docs/PLUGIN-SKELETON-PLAN.md',
  'docs/QUOTE_ANNOTATIONS.md', 'docs/REMOTE.md', 'docs/SESSION_IMPORT.md',
  'docs/SESSION_SEARCH.md', 'docs/STEPPAGE.md', 'docs/THEME_PACKS.md',
  'docs/UPSTREAM_QUESTIONNAIRE_BETA.md', 'docs/UPSTREAM_V016.md', 'docs/UPSTREAM_V017.md',
  'docs/USAGE_ESTIMATES.md',
]);

export const sharedWindowsStages = Object.freeze([
  'upstream_plan', 'upstream_shell', 'upstream_compatibility', 'upstream_clm',
  'upstream_workflow', 'upstream_v016', 'upstream_v017', 'typecheck', 'protocol',
]);

export function sharedChecksComplete(group, steps) {
  return group === 'runtime' && steps && Object.keys(steps).sort().join() === [...sharedWindowsStages].sort().join()
    && sharedWindowsStages.every(stage => steps[stage] === 'success');
}

export function isDocumentation(path) {
  return documents.has(path)
    || /^docs\/releases\/[^/]+\.md$/.test(path)
    || /^docs\/acceptance\/(?:[^/]+\/)*[^/]+\.(?:md|png|jpg|jpeg|webp|gif)$/.test(path)
    || /^assets\/readme\/(?:[^/]+\/)*[^/]+\.(?:png|jpg|jpeg|webp|gif|svg)$/.test(path);
}

export function changedPaths(output) {
  const fields = output.split('\0');
  if (fields.pop() !== '') throw new Error('Incomplete Git diff output');
  const paths = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!/^(?:[ACDMRTUXB]|[RC]\d+)$/.test(status)) throw new Error('Unexpected Git diff status');
    const count = /^[RC]/.test(status) ? 2 : 1;
    for (let offset = 0; offset < count; offset++) {
      const path = fields[index++];
      if (!path) throw new Error('Missing Git diff path');
      paths.push(path);
    }
  }
  return paths;
}

export function docsOnly(paths) {
  return paths.length > 0 && paths.every(isDocumentation);
}

export function checkConclusion(results) {
  const route = results?.changes?.outputs?.['docs-only'];
  const expected = ['changes', 'documentation', ...windowsGroups.map(group => `windows-${group}`)];
  if (!results || Object.keys(results).sort().join() !== expected.sort().join()) return false;
  if (results.changes?.result !== 'success' || !['true', 'false'].includes(route)) return false;
  return results.documentation?.result === (route === 'true' ? 'success' : 'skipped')
    && windowsGroups.every(group => {
      const job = results[`windows-${group}`];
      return route === 'true' ? job?.result === 'skipped'
        : job?.result === 'success' && job.outputs?.group === group && job.outputs?.complete === 'true'
          && job.outputs?.['shared-complete'] === (group === 'runtime' ? 'true' : 'not-applicable');
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === 'classify') {
    const { BASE_SHA, HEAD_SHA, GITHUB_OUTPUT } = process.env;
    if (!GITHUB_OUTPUT) throw new Error('Missing classification output');
    if (process.env.CI_EVENT_NAME && process.env.CI_EVENT_NAME !== 'pull_request') {
      appendFileSync(GITHUB_OUTPUT, 'docs-only=false\n');
      console.log('Non-PR event: full integration');
    } else {
      if (![BASE_SHA, HEAD_SHA].every(value => /^[a-f0-9]{40}$/.test(value ?? ''))) {
        throw new Error('Missing or invalid classification inputs');
      }
      const output = execFileSync('git', ['diff', '--name-status', '-z', '-M', `${BASE_SHA}...${HEAD_SHA}`], { encoding: 'utf8' });
      const paths = changedPaths(output);
      const route = docsOnly(paths);
      appendFileSync(GITHUB_OUTPUT, `docs-only=${route}\n`);
      console.log(`${paths.length} changed paths: ${route ? 'documentation checks' : 'full integration'}`);
    }
  } else if (process.argv[2] === 'shared-receipt') {
    const group = process.env.CI_WINDOWS_GROUP;
    const steps = JSON.parse(process.env.CI_SHARED_STEPS ?? '{}');
    const valid = group === 'runtime' ? sharedChecksComplete(group, steps)
      : windowsGroups.includes(group) && steps
        && Object.keys(steps).sort().join() === [...sharedWindowsStages].sort().join()
        && sharedWindowsStages.every(stage => steps[stage] === 'skipped');
    if (!valid)
      throw new Error('Shared Windows checks did not all complete successfully');
    if (!process.env.GITHUB_OUTPUT) throw new Error('Missing receipt output');
    appendFileSync(process.env.GITHUB_OUTPUT, `complete=${group === 'runtime' ? 'true' : 'not-applicable'}\n`);
  } else if (process.argv[2] === 'conclude') {
    const results = JSON.parse(process.env.CI_NEEDS);
    const passed = checkConclusion(results);
    console.log(JSON.stringify(results, null, 2));
    if (!passed) throw new Error('Required CI checks did not complete successfully');
  } else {
    throw new Error('Expected classify or conclude');
  }
}
