import type { Nodes, Root } from 'mdast';

export function standaloneWebAddress(value: string): string | undefined {
  if (value.length > 4096 || !/^https?:\/\/\S+$/i.test(value)) return;
  try {
    const url = new URL(value);
    if (url.username || url.password) return;
    return url.href;
  } catch { return; }
}

// A code-styled standalone address is still a reference, not a code sample.
export function remarkWebReferences() {
  return (tree: Root) => {
    const adapt = (node: Nodes): Nodes => {
      if (node.type === 'link' || node.type === 'linkReference') return node;
      if (node.type === 'inlineCode') {
        const url = standaloneWebAddress(node.value);
        if (url) return {
          type: 'link', url, position: node.position,
          children: [{ type: 'text', value: node.value }],
        };
      }
      if ('children' in node) {
        const children = node.children as Nodes[];
        for (let index = 0; index < children.length; index++) children[index] = adapt(children[index]);
      }
      return node;
    };
    adapt(tree);
  };
}
