const prefix = 'Organize your working context using the current index below. The conversation is already in context; no preliminary mirror read is needed. Select useful reductions and make one atomic batched edit of ';
const instructions = ' with ordinary tools. Read and write the current file inside the same tool call, preserving metadata and headers. Retain the user\'s requirements, exact findings, failed approaches and remaining work. Keep protected messages and tool-call groups intact. Use actual IDs and your own summaries in the example. Once an edit is accepted, finish briefly. If no useful safe edit is available, explain that briefly.';
const recipeHeading = '\n\nExample atomic body replacement in a Python-capable shell (equivalent code in another available runtime is fine):\nfrom pathlib import Path\nimport re\np = Path(';

// The pinned runtime emits manual CLM as an ordinary user message, without a
// custom type. Recognize its full envelope; never match generic CLM prose.
export function manualClmInput(text: string): string | undefined {
  if (!text.startsWith(prefix)) return;
  const quoted = /^"(?:\\.|[^"\\])*"/.exec(text.slice(prefix.length))?.[0];
  if (!quoted) return;
  let path: unknown;
  try { path = JSON.parse(quoted); } catch { return; }
  if (typeof path !== 'string' || !/(?:^|[\\/])agent[\\/]live-context[\\/][^\\/\r\n]+[\\/]mirror-[^\\/\r\n]+[\\/]LIVE_CONTEXT\.md$/.test(path)) return;
  const heading = `${prefix}${quoted}${instructions}`;
  if (!text.startsWith(heading)) return;
  const index = `\n\n# Working context index (read-only)\nEditable file: ${quoted}\nRevision: `;
  const indexStart = text.indexOf(index, heading.length);
  if (indexStart < 0 || !/^\d+; document: [a-f0-9]{64}\nTotal messages: \d+; editable plain-text blocks: \d+\./.test(text.slice(indexStart + index.length))) return;
  const recipeStart = text.lastIndexOf(`${recipeHeading}${quoted})\nreplacements = {"ID_FROM_INDEX": `);
  const recipe = [
    `${recipeHeading}${quoted})`,
    'replacements = {"ID_FROM_INDEX": "Your concise summary preserving exact useful findings"}',
    'text = p.read_bytes().decode("utf-8")',
    String.raw`parts = re.split(r"(?m)(^\[\[CTX_TURN [^\n]*\]\]\n)", text)`,
    'seen = set()',
    'for i in range(1, len(parts), 2):',
    '    key = re.search(r" id=([A-Za-z0-9-]+) ", parts[i]).group(1)',
    '    if key in replacements:',
    '        assert "protected=false" in parts[i]',
    String.raw`        parts[i + 1] = replacements[key] + ("\n\n" if i + 2 < len(parts) else "")`,
    '        seen.add(key)',
    "assert seen == set(replacements), 'Re-read the index if selected IDs changed'",
    'p.write_bytes("".join(parts).encode("utf-8"))',
    "print('Updated', len(seen), 'context blocks')",
  ].join('\n');
  if (recipeStart <= indexStart || text.slice(recipeStart) !== recipe) return;
  const guidance = text.slice(heading.length, indexStart);
  if (guidance && !guidance.startsWith(' Additional guidance: ')) return;
  return `/clm-compact${guidance ? ` ${guidance.slice(' Additional guidance: '.length)}` : ''}`;
}
