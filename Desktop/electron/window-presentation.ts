import type { WindowPresentation } from '../src/window-conversation';

export function parseWindowPresentation(input: WindowPresentation): WindowPresentation {
  const position = input?.position;
  if (!position || typeof position.follow !== 'boolean' || !Number.isFinite(position.top)
    || position.top < 0 || position.top > 1e9 || !Array.isArray(input.disclosures) || input.disclosures.length > 512)
    throw new Error('Invalid reading position');
  const anchor = position.anchor;
  if (anchor && (!Number.isSafeInteger(anchor.index) || anchor.index < 0 || typeof anchor.role !== 'string'
    || anchor.role.length > 40 || !Number.isFinite(anchor.offset) || Math.abs(anchor.offset) > 1e7
    || anchor.entryId !== undefined && (typeof anchor.entryId !== 'string' || anchor.entryId.length > 300)
    || anchor.timestamp !== undefined && !Number.isFinite(anchor.timestamp))) throw new Error('Invalid reading anchor');
  const disclosures = input.disclosures.map(entry => {
    if (!Array.isArray(entry) || entry.length !== 2) throw new Error('Invalid disclosure');
    const [key, value] = entry;
    if (typeof key !== 'string' || key.length > 500 || typeof value?.revision !== 'string'
      || value.revision.length > 10000 || typeof value.expanded !== 'boolean') throw new Error('Invalid disclosure');
    return [key, { revision: value.revision, expanded: value.expanded }] as WindowPresentation['disclosures'][number];
  });
  return { position: { follow: position.follow, top: position.top, ...(anchor ? { anchor: {
    index: anchor.index, role: anchor.role, offset: anchor.offset, entryId: anchor.entryId, timestamp: anchor.timestamp,
  } } : {}) }, disclosures };
}
