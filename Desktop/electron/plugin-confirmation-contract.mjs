const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = () => { throw new Error('capability:invalid-confirmation'); };
const text = (value, max) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max
    || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value)) invalid();
  return value.trim();
};
export function parsePluginConfirmations(value) {
  if (!Array.isArray(value) || !value.length || value.length > 8) invalid();
  const ids = new Set(), actions = new Set();
  return value.map(item => {
    if (!object(item) || Object.keys(item).length !== 7
      || Object.keys(item).some(key => !['id', 'version', 'action', 'policy', 'title', 'message', 'confirmLabel'].includes(key))
      || typeof item.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/u.test(item.id)
      || typeof item.version !== 'string' || !/^[a-zA-Z0-9._-]{1,64}$/u.test(item.version)
      || !['external.delegate', 'external.policy'].includes(item.action)
      || !['always', 'remember'].includes(item.policy) || ids.has(item.id) || actions.has(item.action)) invalid();
    ids.add(item.id); actions.add(item.action);
    return { id: item.id, version: item.version, action: item.action, policy: item.policy,
      title: text(item.title, 160), message: text(item.message, 1600), confirmLabel: text(item.confirmLabel, 40) };
  });
}
export function validPluginConfirmationBinding(value) {
  return object(value) && Object.keys(value).length === 2
    && typeof value.id === 'string' && /^[a-z0-9][a-z0-9_-]{0,127}$/u.test(value.id)
    && typeof value.installation === 'string' && /^[a-f0-9]{64}$/u.test(value.installation);
}
