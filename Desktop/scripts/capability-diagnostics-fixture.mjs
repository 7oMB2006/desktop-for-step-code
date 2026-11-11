import { readFile } from 'node:fs/promises';

export async function readJsonDuringRefresh(path, read = readFile) {
  try { return JSON.parse(await read(path, 'utf8')); }
  catch (error) {
    // Git can briefly unlink the old manifest before publishing its replacement.
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function pollCapabilityDiagnostic(read, predicate, description, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  do {
    try {
      const result = await read();
      if (predicate(result)) return result;
    } catch (error) {
      if (!error.message.endsWith('Error: Shared settings operation in progress')) throw error;
    }
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${description}`);
}
