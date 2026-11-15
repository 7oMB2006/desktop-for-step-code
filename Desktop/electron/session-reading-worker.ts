import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { importedHistoryMessages } from './imported-history';
import { messagesWithEntryIds } from './session-branching';
import { ConversationTiming } from './conversation-timing';
import { ModelSelections } from './model-selection';
import { WorkflowBindings, hydrateWorkflowHistory } from './workflow-history';
import { assertReadingBudget } from './session-reading-budget';
// @ts-expect-error The read-only native adapter is staged beside this bundle.
import { readHistorySource, assertHistoryUnchanged } from './session-history.mjs';

// One bounded request per process. Import only the library entry, never CLI main,
// SessionManager.open, an Agent, model discovery or session_start.
const lines = createInterface({ input: process.stdin });
lines.once('line', async line => {
  lines.close();
  let result;
  try {
    if (Buffer.byteLength(line) > 8192) throw new Error('Invalid reading request');
    const request = JSON.parse(line);
    const { root, profile, file, sessionId, cwd } = request;
    if (![root, profile, file, sessionId, cwd].every(value => typeof value === 'string' && value.length > 0))
      throw new Error('Invalid reading request');
    const upstream = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'step/dist/bundle/index.js')).href);
    const history = await readHistorySource(upstream, root, file, sessionId);
    // Desktop project redirects leave the original header cwd intact. Managed
    // file/session identity is verified above; decoration uses the current cwd.
    const imported = importedHistoryMessages(history.messages, history.entries, history.leafId);
    const messages = imported === history.messages
      ? messagesWithEntryIds(imported, history.entries, history.leafId) : imported;
    const timing = new ConversationTiming(join(profile, 'conversation-timing'));
    const bindings = new WorkflowBindings(join(profile, 'workflow-bindings'));
    const models = new ModelSelections(join(profile, 'model-changes'), () => {});
    result = { sessionId, version: history.version,
      messages: await hydrateWorkflowHistory(cwd, await timing.decorate(sessionId, messages), await bindings.load(sessionId)),
      modelChanges: (await models.load(sessionId)).changes };
    assertReadingBudget(result);
    await assertHistoryUnchanged(root, file, history.source);
  } catch (error) {
    const reason = (error as { reason?: string }).reason;
    result = { unavailable: ['changed', 'source-limit', 'future-format', 'response-limit', 'node-limit'].includes(reason!)
      ? reason : 'unavailable' };
  }
  // Only the final display projection crosses stdout; entries stay in this heap.
  process.stdout.write(JSON.stringify({ reading: result, metrics: process.memoryUsage() }) + '\n', () => process.exit(0));
});
