// Inactive custom-highlight styles need not be computed for the whole transcript.
export function setTextHighlight(name: string, highlight: Highlight) {
  if (typeof CSS === 'undefined' || !CSS.highlights) return () => {};
  const registry = CSS.highlights;
  const root = document.documentElement;
  const attribute = `data-highlight-${name}`;
  if (!highlight.size) {
    registry.delete(name);
    root.removeAttribute(attribute);
    return () => {};
  }
  registry.set(name, highlight);
  if (!root.hasAttribute(attribute)) root.setAttribute(attribute, '');
  return () => {
    if (registry.get(name) !== highlight) return;
    registry.delete(name);
    root.removeAttribute(attribute);
  };
}
