export const submitAnswer = 'Submit answers / 提交答案';
export const cancelAnswer = 'Cancel / 取消';
export const remoteAnswerLimit = 1000;
const bounded = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;

export function validRemoteForm(value) {
  return Array.isArray(value) && value.length > 0 && value.length <= 12
    && value.every(field => field && typeof field === 'object' && !Array.isArray(field)
      && bounded(field.text, 2500) && Array.isArray(field.options) && field.options.length <= 8
      && field.options.every(option => bounded(option, 200))
      && typeof field.custom === 'boolean' && (field.options.length > 0 || field.custom))
    && JSON.stringify(value).length <= 5000;
}

/** Both transport and main validate the opaque indexed fields, not arbitrary RPC answers. */
export function remoteFormAnswers(fields, value) {
  if (!validRemoteForm(fields) || !value || typeof value !== 'object' || Array.isArray(value)) return;
  const keys = new Set(fields.flatMap((field, index) => [
    ...(field.options.length ? [`q${index}`] : []), ...(field.custom ? [`c${index}`] : []),
  ]));
  if (Object.keys(value).some(key => !keys.has(key))) return;
  const answers = [];
  for (const [index, field] of fields.entries()) {
    const selected = value[`q${index}`], custom = value[`c${index}`];
    if (custom !== undefined && (typeof custom !== 'string' || custom.length > remoteAnswerLimit)) return;
    if ((!field.options.length || selected === 'custom') && field.custom) {
      if (typeof custom !== 'string' || !custom.trim()) return;
      answers.push({ custom: custom.trim() });
    } else {
      if (typeof selected !== 'string' || !/^[0-7]$/.test(selected) || !field.options[Number(selected)]
        || typeof custom === 'string' && custom.trim()) return;
      answers.push({ index: Number(selected) });
    }
  }
  return answers;
}
