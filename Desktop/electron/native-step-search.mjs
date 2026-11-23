import { pathToFileURL } from 'node:url';

// The parent sends only the Step credential for this request via stdin.
try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const { key, url, query } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const { createStepToolProfile } = await import(pathToFileURL(process.argv[2]).href);
  const tool = createStepToolProfile(process.cwd(), {
    searchWeb: { env: {}, authPath: process.env.STEPCODE_AUTH_PATH, apiKey: key, url },
  }).find(tool => tool.name === 'search_web');
  const result = await tool.execute('desktop-search', { query }, AbortSignal.timeout(7500));
  process.stdout.write(JSON.stringify({
    text: result.content.filter(item => item.type === 'text').map(item => item.text).join('\n\n').slice(0, 24000),
    count: result.details?.resultCount ?? 0,
  }));
} catch (error) {
  // Private pipe to the parent, which maps this to a fixed status code.
  process.stdout.write(JSON.stringify({ error: error instanceof Error ? error.message.slice(0, 1024) : 'Unavailable' }));
}
