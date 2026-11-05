/** Shared outgoing card shape; the preview supplies only simulated message data. */
export function remoteCard(value, actions = []) {
  return { config: { wide_screen_mode: true, update_multi: true },
    ...(value.reply ? {} : { header: { title: { tag: 'plain_text', content: value.title } } }),
    elements: value.reply ? [
      { tag: 'div', text: { tag: 'lark_md', content: value.text.slice(-5000)
        || (value.reply === 'working' ? '正在回复… / Replying…' : '本轮没有文字回复。 / No text response for this turn.') } },
      { tag: 'note', elements: [{ tag: 'plain_text', content: value.reply === 'interrupted'
        ? `回复已中断 / Reply interrupted · ${value.title}` : value.title }] },
    ] : [
      { tag: 'div', text: { tag: 'plain_text', content: value.text.slice(-5000) || 'Desktop for Step Code' } },
      ...(actions.length ? [{ tag: 'action', actions }] : []),
    ] };
}
