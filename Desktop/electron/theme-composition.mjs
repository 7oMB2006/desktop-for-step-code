const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (value, keys) => Object.keys(value).every(key => keys.includes(key));
const invalid = () => { throw new Error('Invalid theme composition'); };

export function parseThemeComposition(value) {
  if (!record(value)) invalid();
  if (value.schemaVersion === 1) {
    if (value.renderer !== 'stellar-v1' || value.scene !== 'scene.json') invalid();
    return { ui: 'stellar-v1', background: { renderer: 'stellar-v1', source: 'scene.json' }, accepts: [] };
  }
  if (value.schemaVersion !== 2
    || !onlyKeys(value, ['$schema', 'schemaVersion', 'name', 'author', 'cover', 'scheme', 'colors', 'ui', 'background'])
    || value.$schema !== undefined && (typeof value.$schema !== 'string' || value.$schema.length > 2048
      || /[\u0000-\u001f]/u.test(value.$schema))
    || !record(value.ui) || !onlyKeys(value.ui, ['renderer'])
    || !['standard-v1', 'stellar-v1'].includes(value.ui.renderer)
    || !record(value.background) || !onlyKeys(value.background, ['renderer', 'source', 'accepts'])) invalid();
  const { renderer, source, accepts = [] } = value.background;
  if (!Array.isArray(accepts) || accepts.length > 1 || accepts.some(item => item !== 'image-v1')) invalid();
  if (renderer === 'stellar-v1') {
    if (source !== 'scene.json') invalid();
  } else if (renderer === 'image-v1') {
    if (!['background.png', 'background.jpg'].includes(source)) invalid();
  } else if (renderer === 'solid-v1') {
    if (Object.hasOwn(value.background, 'source')) invalid();
  } else invalid();
  return { ui: value.ui.renderer, background: { renderer, ...(source === undefined ? {} : { source }) }, accepts: [...accepts] };
}
