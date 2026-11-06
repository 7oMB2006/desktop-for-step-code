// Native announcements are append-only. The latest block, not an earlier
// occurrence of "Plan Mode" in history, owns the current provider request.
export function planContext(messages) {
  const text = messages.map(message => typeof message.content === 'string' ? message.content
    : message.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? '').join('\n');
  return [...text.matchAll(/<collaboration_mode>[\s\S]*?<\/collaboration_mode>/g)].at(-1)?.[0] ?? '';
}

export function planPath(context) {
  return /Write the plan to (.*) with write_file/.exec(context)?.[1];
}
