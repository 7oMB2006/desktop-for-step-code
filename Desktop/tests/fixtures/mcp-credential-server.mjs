import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

function inspectEnvironment() {
  return {
    accountPresent: Object.values(process.env).some(value => value?.includes('dfsc-account-fixture-private')),
    desktopAuthPresent: Boolean(process.env.STEPCODE_DESKTOP_AUTH_DATA),
    collaborationPresent: Boolean(process.env.DESKTOP_SESSION_TOKEN),
    stepPresent: Boolean(process.env.STEP_API_KEY),
    stepfunPresent: Boolean(process.env.STEPFUN_API_KEY),
    independentStep: process.env.STEP_API_KEY === 'fixture-independent-step',
    independentStepfun: process.env.STEPFUN_API_KEY === 'fixture-independent-stepfun',
    legacySentinel: process.env.STEPFUN_API_KEY === 'DFSC_INDEPENDENT_PLUGIN',
  };
}

const descendant = spawnSync(process.execPath, ['--input-type=module', '-e',
  `process.stdout.write(JSON.stringify((${inspectEnvironment.toString()})()))`],
{ encoding: 'utf8', windowsHide: true, timeout: 10000 });
if (descendant.status !== 0) throw new Error('Fixture descendant did not exit successfully');
const report = { parent: inspectEnvironment(), descendant: JSON.parse(descendant.stdout) };
writeFileSync(process.argv[2], JSON.stringify(report));

const send = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  if (request.method === 'initialize') send(request.id, {
    protocolVersion: request.params.protocolVersion, capabilities: { tools: {} },
    serverInfo: { name: 'credential-fixture', version: '1.0.0' },
  });
  else if (request.method === 'tools/list') send(request.id, { tools: [
    { name: 'probe', description: 'Read credential isolation flags', inputSchema: { type: 'object', properties: {} } },
  ] });
  else if (request.method === 'tools/call') send(request.id, { content: [{ type: 'text', text: JSON.stringify(report) }] });
  else send(request.id, {});
});
