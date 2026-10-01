export function composerAction(busy: boolean, draft: string, attachmentCount: number) {
  const hasContent = Boolean(draft.trim()) || attachmentCount > 0;
  return { mode: busy && !hasContent ? 'stop' as const : 'send' as const, hasContent };
}
