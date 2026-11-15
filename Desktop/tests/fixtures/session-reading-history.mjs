export function readingHistory(cwd, id = 'reading-large') {
  const timestamp = '2026-11-14T00:00:00.000Z';
  const values = [{ type: 'session', version: 3, id, cwd, timestamp }];
  let parentId = null;
  // Case-sized raw history with native compaction. Keep the original records,
  // not a pre-trimmed file, while displaying the complete native current context.
  for (let index = 0; index < 1750; index++) {
    const entryId = `entry-${index}`;
    const message = index % 2 === 0
      ? { role: 'user', content: [{ type: 'text', text: `Question ${index}: ` + 'Saved conversation text. '.repeat(360) }], timestamp: index + 1 }
      : { role: 'assistant', content: [{ type: 'text', text: `Answer ${index}: ` + 'Saved conversation text. '.repeat(360) }],
        provider: 'fixture', model: 'fixture', api: 'openai-completions', stopReason: 'stop', timestamp: index + 1,
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    values.push({ type: 'message', id: entryId, parentId, timestamp, message });
    parentId = entryId;
  }
  values.push({ type: 'message', id: 'abandoned', parentId, timestamp,
    message: { role: 'user', content: 'ABANDONED_BRANCH_MUST_NOT_APPEAR', timestamp: 1751 } });
  values.push({ type: 'compaction', id: 'compact', parentId, timestamp,
    summary: 'READING_CONTEXT_SUMMARY', firstKeptEntryId: 'entry-1710', tokensBefore: 100000 });
  values.push({ type: 'custom_message', id: 'visible-custom', parentId: 'compact', timestamp,
    customType: 'fixture', content: [{ type: 'text', text: 'READING_HISTORY_END' }], display: true });
  values.push({ type: 'session_info', id: 'name', parentId: 'visible-custom', timestamp, name: 'Reading large' });
  return values.map(value => JSON.stringify(value)).join('\n') + '\n';
}
