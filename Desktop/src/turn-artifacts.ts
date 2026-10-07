import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { Nodes, Root } from 'mdast';
import type { IndexedMessage } from './conversation-presentation';
import type { Content } from './contracts';

export type ArtifactKind = 'website' | 'image' | 'document' | 'spreadsheet' | 'presentation' | 'audio' | 'video' | 'file';
export interface TurnArtifact { path: string; label: string; kind: ArtifactKind; inferred?: boolean }
export function localReference(value?: string): string | undefined {
  if (!value || value.length > 4096 || /[\u0000-\u001f]/u.test(value)) return;
  let path = value;
  if (path.startsWith('file:')) {
    try { const url = new URL(path); if (url.hostname) return; path = decodeURIComponent(url.pathname); } catch { return; }
  } else {
    if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) return;
    try { path = decodeURIComponent(path); } catch { return; }
  }
  path = path.replace(/^\/([a-z]:\/)/i, '$1').replace(/:\d+(?::\d+)?$/, '');
  if (/^(?:[a-z]:[\\/]|\/(?!\/)|\.\.?[\\/])/i.test(path) || /^[^:/\\]+(?:[\\/][^:]+)*\.[a-z\d]+$/i.test(path)) return path;
}
export function artifactKind(path: string): ArtifactKind {
  const ext = path.split('.').at(-1)?.toLowerCase();
  if (['html', 'htm'].includes(ext!)) return 'website';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext!)) return 'image';
  if (['pdf', 'docx', 'doc', 'md', 'txt'].includes(ext!)) return 'document';
  if (['xlsx', 'xls', 'csv'].includes(ext!)) return 'spreadsheet';
  if (['pptx', 'ppt'].includes(ext!)) return 'presentation';
  if (['wav', 'mp3', 'ogg', 'flac'].includes(ext!)) return 'audio';
  if (['mp4', 'webm', 'mov'].includes(ext!)) return 'video';
  return 'file';
}
const parser = unified().use(remarkParse);
const pathKey = (path: string) => path.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
const basename = (path: string) => path.replace(/\\/g, '/').split('/').at(-1)!;

export function turnOutputPaths(items: IndexedMessage[]): string[] {
  const calls = new Map<string, Content>();
  const found = new Map<string, string>();
  for (const { message } of items) {
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      for (const part of message.content) if (part.type === 'toolCall' && part.id) calls.set(part.id, part);
    }
    if (message.role !== 'toolResult' || message.isError || !message.toolCallId) continue;
    const call = calls.get(message.toolCallId);
    if (!call || !/^(edit|edit_file|apply_patch|write|write_file)$/.test(call.name ?? '')) continue;
    const args = call.arguments;
    const value = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>).path : undefined;
    const path = typeof value === 'string' ? localReference(value) : undefined;
    if (path && artifactKind(path) !== 'file' && found.size < 64) found.set(pathKey(path), path);
  }
  return [...found.values()];
}

export function turnArtifacts(text: string, outputPaths: string[] = []): TurnArtifact[] {
  if (text.length > 200_000) return [];
  const tree = parser.parse(text) as Root;
  const definitions = new Map<string, string>();
  for (const node of tree.children) if (node.type === 'definition') definitions.set(node.identifier.toLowerCase(), node.url);
  const found = new Map<string, TurnArtifact>();
  const add = (path: string, name: string, inferred = false) => {
    const kind = artifactKind(path);
    const key = pathKey(path);
    if (kind !== 'file' && found.size < 12 && !found.has(key)) found.set(key, {
      path, label: name.slice(0, 160) || basename(path), kind, ...(inferred ? { inferred: true } : {}),
    });
  };
  const label = (node: Nodes): string => 'value' in node ? String(node.value) : 'children' in node ? node.children.map(child => label(child as Nodes)).join('') : '';
  const visit = (node: Nodes) => {
    if (node.type === 'link' || node.type === 'linkReference') {
      const path = localReference(node.type === 'link' ? node.url : definitions.get(node.identifier.toLowerCase()));
      if (path) add(path, label(node));
      return;
    }
    if (node.type === 'inlineCode') {
      let path = localReference(node.value);
      if (path && !/[\\/]/.test(path)) {
        const matches = outputPaths.filter(output => basename(output).toLowerCase() === path!.toLowerCase());
        path = matches.length === 1 ? matches[0] : matches.length > 1 ? undefined : path;
      }
      if (path) add(path, basename(path), true);
    }
    if ('children' in node) for (const child of node.children) visit(child as Nodes);
  };
  visit(tree);
  for (const value of outputPaths) {
    const path = localReference(value);
    if (path) add(path, basename(path), true);
  }
  return [...found.values()];
}
