export const markdownScenarios = ['prose', 'code', 'math', 'mixed', 'single-paragraph', 'growing-code'] as const;
export type MarkdownScenario = typeof markdownScenarios[number];

export function streamingMarkdownCorpus(kind: MarkdownScenario, count = 12) {
  if (kind === 'single-paragraph') return 'A long paragraph retains **formatting** and selectable text while its last sentence keeps growing. '.repeat(90);
  if (kind === 'growing-code') return '```typescript\n' + Array.from({ length: 144 }, (_, index) =>
    `export const growing${index} = { ready: true, label: "item", amount: ${index} };`).join('\n') + '\n```';
  return Array.from({ length: count }, (_, index) => {
    const prose = `## Section ${index + 1}\n\n` +
      'A completed paragraph keeps its **formatting**, selectable text and [reference](https://example.com/). '.repeat(4) + '\n\n';
    const code = '```typescript\n' + Array.from({ length: 12 }, (_, line) =>
      `export const value${index}_${line} = { ready: true, label: "item", amount: ${line} };`).join('\n') + '\n```\n\n';
    const math = `Formula $E=mc^2$ and $\\frac{${index + 1}}{n}+\\sqrt{x^2+y^2}$.\n\n` +
      '$$\n\\sum_{i=1}^{n}i=\\frac{n(n+1)}{2}\n$$\n\n';
    return kind === 'prose' ? prose : kind === 'code' ? code : kind === 'math' ? math : prose + code + math;
  }).join('');
}

export function markdownDeltas(source: string, size = 180) {
  return Array.from({ length: Math.ceil(source.length / size) }, (_, index) => source.slice(0, (index + 1) * size));
}
