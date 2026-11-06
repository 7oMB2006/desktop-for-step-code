export const MAX_TEXT_LENGTH = 16000;
export const DEFAULTS = Object.freeze({
  heading: '\u6574\u7406\u7ed3\u679c', style: 'bullet', max_items: 50,
  deduplicate: true, order: 'original',
});

export function validateText(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).length !== 1 || typeof input.text !== 'string'
    || input.text.length > MAX_TEXT_LENGTH || input.text.includes('\0')) {
    throw new Error('Supply only a text string, at most 16000 UTF-16 code units, without NUL.');
  }
  return input.text;
}

export function optionsFrom(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Invalid saved settings.');
  const settings = { ...DEFAULTS, ...values };
  if (typeof settings.heading !== 'string' || settings.heading.length > 60
    || /[\r\n\0]/u.test(settings.heading)
    || !['bullet', 'numbered', 'checklist'].includes(settings.style)
    || !Number.isInteger(settings.max_items) || settings.max_items < 1 || settings.max_items > 200
    || typeof settings.deduplicate !== 'boolean'
    || !['original', 'ascending', 'descending'].includes(settings.order)) {
    throw new Error('Invalid saved settings.');
  }
  return settings;
}

function linesOf(text) {
  return text === '' ? [] : text.split(/\r\n|\r|\n/u);
}

export function analyzeText(text) {
  const lines = linesOf(text);
  const nonEmpty = lines.map(line => line.trim()).filter(Boolean);
  const unique = new Set(nonEmpty).size;
  return {
    unicodeCodePoints: Array.from(text).length,
    utf16CodeUnits: text.length,
    lines: lines.length,
    nonEmptyLines: nonEmpty.length,
    uniqueLines: unique,
    repeatedLines: nonEmpty.length - unique,
  };
}

export function prepareList(text, values) {
  const settings = optionsFrom(values);
  let lines = linesOf(text).map(line => line.trim()).filter(Boolean);
  const nonEmptyLines = lines.length;
  if (settings.deduplicate) lines = [...new Set(lines)];
  const removedDuplicates = nonEmptyLines - lines.length;
  if (settings.order !== 'original') {
    lines.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
    if (settings.order === 'descending') lines.reverse();
  }
  const omitted = Math.max(0, lines.length - settings.max_items);
  const shown = lines.slice(0, settings.max_items);
  const body = shown.map((line, index) => {
    const prefix = settings.style === 'numbered' ? `${index + 1}.`
      : settings.style === 'checklist' ? '- [ ]' : '-';
    return `${prefix} ${line}`;
  }).join('\n');
  const heading = settings.heading.trim();
  return {
    text: !shown.length ? '\u6ca1\u6709\u975e\u7a7a\u884c\u53ef\u6574\u7406\u3002'
      : `${heading ? `## ${heading}\n\n` : ''}${body}${omitted
        ? `\n\n\u53e6\u6709 ${omitted} \u6761\u672a\u5c55\u793a\uff08\u53d7\u6700\u591a\u8f93\u51fa\u6761\u6570\u9650\u5236\uff09\u3002` : ''}`,
    items: shown.length, removedDuplicates, omitted,
  };
}
