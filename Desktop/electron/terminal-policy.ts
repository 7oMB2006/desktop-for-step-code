export function terminalEnvironment(source: NodeJS.ProcessEnv) {
  return Object.fromEntries(Object.entries(source).filter(([key, value]) => value !== undefined &&
    !/^(?:DESKTOP_|STEPCODE_|STEP_CODING_|STEP_CLIENT$|ELECTRON_|NODE_OPTIONS$|NODE_PATH$)/i.test(key) &&
    !/(?:API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTHORIZATION|COOKIE|^AWS_ACCESS_KEY_ID$)/i.test(key))) as NodeJS.ProcessEnv;
}

export function terminalSize(cols: unknown, rows: unknown) {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || (cols as number) < 2 || (cols as number) > 500 ||
    (rows as number) < 1 || (rows as number) > 300) throw new Error('Invalid terminal dimensions');
  return { cols: cols as number, rows: rows as number };
}

export function terminalInput(data: unknown): string {
  if (typeof data !== 'string' || data.length > 65536) throw new Error('Invalid terminal input');
  return data;
}
