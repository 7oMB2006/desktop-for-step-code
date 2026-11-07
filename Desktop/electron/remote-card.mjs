import { remoteMarkdown } from './remote-markdown.mjs';
import { submitAnswer, cancelAnswer, remoteAnswerLimit, validRemoteForm } from './remote-form.mjs';

/** Shared outgoing card shape; the preview supplies only simulated message data. */
export const remoteCardElements = card => card.schema === '2.0' ? card.body.elements : card.elements;
const literal = content => ({ tag: 'div', text: { tag: 'plain_text', content } });
function questionCard(value, actions) {
  if (!validRemoteForm(value.form) || value.reply || value.overview) throw new Error('Invalid question card');
  const button = action => ({ tag: 'button', text: action.text, name: action.value.option === submitAnswer ? 'submit' : 'cancel',
    behaviors: [{ type: 'callback', value: action.value }] });
  const fields = value.form.flatMap((field, index) => [
    literal(field.text),
    ...(actions.length && field.options.length ? [{
      tag: 'select_static', name: `q${index}`, required: true, width: 'fill',
      placeholder: { tag: 'plain_text', content: '选择答案 / Choose an answer' },
      options: [...field.options.map((option, index) => ({ text: { tag: 'plain_text', content: option }, value: String(index) })),
        ...(field.custom ? [{ text: { tag: 'plain_text', content: '自行填写 / Write my own' }, value: 'custom' }] : [])],
    }] : []),
    ...(actions.length && field.custom ? [{
      tag: 'input', name: `c${index}`, required: !field.options.length, input_type: 'multiline_text',
      max_length: remoteAnswerLimit, rows: 3, width: 'fill',
      placeholder: { tag: 'plain_text', content: field.options.length ? '选择“自行填写”后在此作答 / Custom answer only' : '填写答案 / Your answer' },
    }] : []),
  ]);
  const submit = actions.find(action => action.value.option === submitAnswer);
  const cancel = actions.find(action => action.value.option === cancelAnswer);
  return { schema: '2.0', config: { wide_screen_mode: true, update_multi: true },
    header: { title: { tag: 'plain_text', content: value.title } },
    body: { elements: [
      literal(value.text),
      ...(submit ? [{ tag: 'form', name: 'answers', elements: [...fields, {
        ...button(submit), type: 'primary', form_action_type: 'submit',
      }] }] : fields),
      ...(cancel ? [button(cancel)] : []),
      ...(value.status ? [literal({ handled: 'Handled / 已处理', expired: 'Expired / 已过期', unavailable: 'Unavailable / 已不可用' }[value.status])] : []),
    ] } };
}
export const remoteOverviewLimit = 8;
export function validRemoteOverview(value) {
  const line = (text, max) => typeof text === 'string' && text.length > 0 && text.length <= max && !/[\r\n]/.test(text);
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && ['zh', 'en'].includes(value.language)
    && (value.current === undefined || line(value.current, 200))
    && Number.isSafeInteger(value.total) && value.total >= 0 && value.total <= 4096
    && Array.isArray(value.rows) && value.rows.length <= remoteOverviewLimit && value.rows.length <= value.total
    && (value.total === 0 || value.rows.length > 0)
    && value.rows.every(row => row && typeof row === 'object' && !Array.isArray(row)
      && line(row.ref, 200) && line(row.name, 70) && line(row.status, 60)
      && Number.isSafeInteger(row.queue) && row.queue >= 0 && row.queue <= 1000000
      && typeof row.attention === 'boolean');
}
function overviewCard(value) {
  const zh = value.language === 'zh';
  const plain = content => ({ tag: 'div', text: { tag: 'plain_text', content } });
  const heading = content => ({ tag: 'div', text: { tag: 'lark_md', content: `**${content}**` } });
  const note = content => ({ tag: 'note', elements: [{ tag: 'plain_text', content }] });
  const elements = [
    note(`${zh ? '当前输入' : 'Input target'}  ${value.current || (zh ? '待选择会话' : 'Select a session')}`),
  ];
  if (!value.total) {
    elements.push(heading(zh ? '暂无进行中的任务' : 'No active tasks'));
    elements.push(note(zh ? '查看会话  /sessions' : 'Browse sessions  /sessions'));
  } else {
    for (const attention of [true, false]) {
      const rows = value.rows.filter(row => row.attention === attention);
      if (!rows.length) continue;
      const label = attention ? zh ? '需要你处理' : 'Needs attention' : zh ? '正在进行' : 'In progress';
      elements.push(heading(`${label}${value.total === value.rows.length ? ` · ${rows.length}` : ''}`));
      for (const row of rows) {
        // Session names and status stay literal; only fixed section labels use Markdown.
        elements.push(plain(`${row.ref} · ${row.name}`));
        const commands = /^s[1-9]\d{0,4}$/i.test(row.ref)
          ? `${zh ? '查看' : 'Details'} /status ${row.ref}    ${zh ? '切换' : 'Switch'} /session ${row.ref}` : '';
        const state = `${row.status}${row.queue ? ` · ${zh ? '排队' : 'Queued'} ${row.queue}` : ''}`;
        elements.push(note([state, commands].filter(Boolean).join('\n')));
      }
    }
    if (value.total > value.rows.length) elements.push(note(zh
      ? `另有 ${value.total - value.rows.length} 个会话，请在 Desktop 查看`
      : `${value.total - value.rows.length} more sessions in Desktop`));
  }
  elements.push(note(zh ? '已加载会话 · 只读快照' : 'Loaded sessions · Read-only snapshot'));
  return { config: { wide_screen_mode: true, update_multi: true },
    header: { title: { tag: 'plain_text', content: `${zh ? '会话总览' : 'Session overview'}${value.total ? ` · ${value.total}` : ''}` } },
    elements };
}
export function remoteCard(value, actions = []) {
  if (value.form !== undefined) return questionCard(value, actions);
  if (value.overview !== undefined) {
    if (!validRemoteOverview(value.overview) || value.reply || actions.length) throw new Error('Invalid overview card');
    return overviewCard(value.overview);
  }
  const status = { handled: 'Handled / 已处理', expired: 'Expired / 已过期', unavailable: 'Unavailable / 已不可用' }[value.status];
  const detail = value.reply !== 'working' && typeof value.detail === 'string' ? value.detail.slice(0, 200) : '';
  const progress = typeof value.progress === 'string' ? value.progress.slice(0, 200) : '';
  const source = value.reply === 'interrupted' ? `回复已中断 / Reply interrupted · ${value.title}` : value.title;
  // Reserve the source and truncation notice outside the Markdown tail.
  const reserved = progress.length + (status?.length ?? 0);
  const sourceFooter = [value.reply ? source : '', detail].filter(Boolean).join(' · ');
  const clipped = !!value.truncated || value.text.length > Math.max(0, 5000 - sourceFooter.length - reserved);
  const footer = [sourceFooter, clipped
    ? '仅显示末尾内容 / Showing latest text (truncated); full text in Desktop / 全文见 Desktop' : ''].filter(Boolean).join(' · ');
  const budget = Math.max(0, 5000 - footer.length - reserved);
  let text = budget ? value.text.slice(-budget) : '';
  if (/^[\uDC00-\uDFFF]/.test(text)) text = text.slice(1);
  if (value.reply) {
    const content = text || (value.reply === 'working' ? '正在回复… / Replying…'
      : value.reply === 'interrupted' ? '回复已中断，本轮没有文字回复。 / Reply interrupted; no text response for this turn.'
        : '本轮没有文字回复。 / No text response for this turn.');
    return { schema: '2.0', config: { wide_screen_mode: true, update_multi: true },
      body: { elements: [
        ...remoteMarkdown(content).map(content => ({ tag: 'markdown', content })),
        ...(progress ? [{ ...literal(progress), element_id: 'progress' }] : []),
        { tag: 'div', text: { tag: 'plain_text', content: footer, text_size: 'notation' }, element_id: 'source' },
      ] } };
  }
  return { config: { wide_screen_mode: true, update_multi: true },
    header: { title: { tag: 'plain_text', content: value.title } },
    elements: [
      { tag: 'div', text: { tag: 'plain_text', content: text || 'Desktop for Step Code' } },
      ...(status ? [{ tag: 'div', text: { tag: 'plain_text', content: status } }] : []),
      ...(footer ? [{ tag: 'note', elements: [{ tag: 'plain_text', content: footer }] }] : []),
      ...(actions.length ? [{ tag: 'action', actions }] : []),
    ] };
}
