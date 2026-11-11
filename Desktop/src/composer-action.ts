export function composerAction(busy: boolean, draft: string, attachmentCount: number, dictating = false) {
  const hasContent = Boolean(draft.trim()) || attachmentCount > 0;
  return { mode: busy && (dictating || !hasContent) ? 'stop' as const : 'send' as const, hasContent };
}
