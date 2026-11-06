import { analyzeText, optionsFrom, prepareList, validateText, MAX_TEXT_LENGTH } from './text.mjs';

const versions = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'];
const inputSchema = {
  type: 'object', properties: { text: { type: 'string', maxLength: MAX_TEXT_LENGTH } },
  required: ['text'], additionalProperties: false,
};
const tools = [
  { name: 'prepare_list', description: 'Turn user-supplied lines into a list using saved local settings. No network or file writes.',
    inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'analyze_text', description: 'Count Unicode code points, UTF-16 units, lines and exact duplicate trimmed lines. No model or network.',
    inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
];
const error = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const textResult = text => ({ content: [{ type: 'text', text }] });

export function createRouter(configuration) {
  let initialized = false;
  return async request => {
    if (!request || typeof request !== 'object' || Array.isArray(request)
      || request.jsonrpc !== '2.0' || typeof request.method !== 'string'
      || (request.id !== undefined && typeof request.id !== 'string'
        && !(typeof request.id === 'number' && Number.isFinite(request.id)))) {
      return error(null, -32600, 'Invalid JSON-RPC request.');
    }
    if (request.id === undefined) return;
    const reply = result => ({ jsonrpc: '2.0', id: request.id, result });
    if (request.method === 'ping') return reply({});
    if (request.method === 'initialize') {
      if (initialized || typeof request.params?.protocolVersion !== 'string') {
        return error(request.id, -32602, 'Invalid initialization.');
      }
      try {
        optionsFrom((await configuration.current()).values);
        initialized = true;
        return reply({
          protocolVersion: versions.includes(request.params.protocolVersion) ? request.params.protocolVersion : '2025-03-26',
          capabilities: { tools: {} }, serverInfo: { name: 'text-workbench', version: '0.1.0' },
          instructions: 'Local supplied-text tools. Save settings in DFSC and restart after any configuration change. Never read files or submit credentials.',
        });
      } catch {
        return error(request.id, -32000, 'Save valid plugin settings in DFSC and restart the service.');
      }
    }
    if (!initialized) return error(request.id, -32000, 'Initialize the service first.');
    if (request.method === 'tools/list') return reply({ tools });
    if (request.method !== 'tools/call') return error(request.id, -32601, 'Method not found.');
    if (!tools.some(tool => tool.name === request.params?.name)) return error(request.id, -32602, 'Unknown tool.');
    let text;
    try { text = validateText(request.params.arguments); }
    catch { return error(request.id, -32602, 'Supply only a text string of at most 16000 UTF-16 code units, without NUL.'); }
    try {
      const { values } = await configuration.current();
      optionsFrom(values);
      return reply(request.params.name === 'prepare_list'
        ? textResult(prepareList(text, values).text)
        : textResult(JSON.stringify(analyzeText(text), null, 2)));
    } catch {
      return reply({ ...textResult('Plugin settings are unavailable or changed. Review settings and explicitly restart the service.'), isError: true });
    }
  };
}
