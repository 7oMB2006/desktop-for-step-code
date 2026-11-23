import { useRef } from 'react';
import { SkillsSettings, type SkillsSettingsBridge } from '../../src/SkillsSettings';
import type { CapabilityResult, CapabilitySkill, CapabilitySkillMode } from '../../src/capabilities';

type Example = { skill: CapabilitySkill; body?: string; revision: number; source?: string; files: Map<string, { text?: string; revision: number }> };
type Localized = readonly [string, string];
const labels: { name: string; description: Localized; body?: Localized; plugin?: string; enabled?: boolean; files?: [string, Localized][] }[] = [
  { name: 'code-review',
    description: ['检查代码变更中的缺陷、行为回归与测试缺口。先报告发现，再总结改动。', 'Review changes for bugs, behavioral regressions, and missing tests. Lead with findings, then summarize.'],
    body: [
      '# 代码审查\n\n## 什么时候用\n\n审查拉取请求、工作区改动，或准备合并的一组提交。先确认要比较的分支和本次变更的范围。\n\n## 审查流程\n\n1. 阅读实际 diff，沿关键调用路径查看上下文。\n2. 检查行为变化，优先看失败路径、状态切换和并发边界。\n3. 核对已有测试是否能捕捉回归。\n\n## 输出\n\n按严重程度排列发现，每条附上文件位置、触发条件和用户影响。',
      '# Code review\n\n## When to use\n\nReview a pull request, worktree edits, or a batch of commits before merging. First identify the comparison base and the scope of the change.\n\n## Review workflow\n\n1. Read the actual diff and follow the relevant call paths.\n2. Check behavioral changes, focusing on failures, state transitions, and concurrency.\n3. Look for tests that would catch regressions.\n\n## Output\n\nOrder findings by severity. Include the file location, conditions, and user impact.',
    ],
    files: [['references/checklist.md', ['# 审查清单\n\n- 核对失败和恢复路径。', '# Review checklist\n\n- Check failure and recovery paths.']],
      ['templates/findings.md', ['# 审查发现\n\n- 严重程度：\n- 位置：\n- 影响：', '# Findings\n\n- Severity:\n- Location:\n- Impact:']]] },
  { name: 'frontend-check', enabled: false,
    description: ['核对布局、交互和可访问性。', 'Check layout, interaction, and accessibility.'],
    body: ['# 前端验收\n\n分别检查宽窗和窄窗。', '# Frontend checks\n\nInspect wide and narrow windows.'] },
  { name: 'release-notes',
    description: ['从已经合并的改动整理发布说明。', 'Draft release notes from merged changes.'],
    body: ['# 发布说明\n\n区分功能、修复与破坏性变更。', '# Release notes\n\nSeparate features, fixes, and breaking changes.'] },
  { name: 'workspace-audit', description: ['整理工作区中的改动和交接状态。', 'Review worktree changes and handoff status.'] },
  { name: 'browser-acceptance', plugin: 'Playwright',
    description: ['记录真实浏览器中的界面验收证据。', 'Record acceptance evidence from a real browser.'],
    body: ['# 浏览器验收\n\n记录浏览器、视口以及实际观察到的行为。', '# Browser acceptance\n\nRecord the browser, viewport, and observed behavior.'],
    files: [['references/evidence.md', ['# 验收记录\n\n- 浏览器\n- 视口\n- 观察结果', '# Evidence\n\n- Browser\n- Viewport\n- Observed result']]] },
  { name: 'theme-surface-check', plugin: 'Theme Studio',
    description: ['检查亮色、暗色和自定义主题中的基本界面。', 'Inspect shared surfaces in light, dark, and custom themes.'],
    body: ['# 主题验收\n\n比较文字、边框、焦点与选择态。', '# Theme checks\n\nCompare text, borders, focus, and selection states.'] },
];

function fixtureStore(language: 'zh' | 'en') {
  const lang = language === 'zh' ? 0 : 1;
  const entries = new Map<string, Example>();
  function add(name: string, description: string, body?: string, plugin?: string, enabled = true) {
    const skill: CapabilitySkill = { id: `${plugin || 'local'}:${name}`, name, description, location: `${plugin ? '' : 'agent/'}skills/${name}/SKILL.md`,
      source: plugin ? 'plugin' : 'user', pluginName: plugin, enabled, toggleable: !plugin, deletable: !plugin };
    const record: Example = { skill, body, revision: 1, files: new Map() };
    entries.set(skill.id, record);
    return record;
  }
  for (const item of labels) {
    const record = add(item.name, item.description[lang], item.body?.[lang], item.plugin, item.enabled);
    for (const [path, text] of item.files ?? []) record.files.set(path, { text: text[lang], revision: 1 });
  }
  function entry(id: string) {
    const item = entries.get(id);
    if (!item) throw new Error('capability:not-found');
    return item;
  }
  function source(item: Example) {
    return item.source ?? `---\nname: ${item.skill.name}\ndescription: ${JSON.stringify(item.skill.description)}${item.skill.manualOnly ? '\ndisable-model-invocation: true' : ''}\n---\n\n${item.body}`;
  }
  function assertRevision(expected: string | undefined, actual: number) {
    if (expected !== undefined && expected !== String(actual)) throw new Error('capability:stale');
  }
  let forceConflict = new URLSearchParams(location.search).has('skill-conflict');
  const api: Omit<SkillsSettingsBridge, 'capabilityImportSkill'> = {
    capabilityCatalog: async () => ({
      skills: structuredClone(Array.from(entries.values(), item => item.skill)),
      warnings: [], plugins: [], available: [], marketplaces: [], mcp: [],
    }),
    capabilitySkillDetail: async id => {
      const item = entry(id);
      const writable = item.skill.source === 'user';
      return {
        document: item.body === undefined ? undefined : {
          text: source(item), body: item.body, description: item.skill.description, revision: String(item.revision),
        },
        files: Array.from(item.files.keys(), path => ({ id: path, path })),
        editable: writable && item.body !== undefined, manageFiles: writable,
      };
    },
    capabilitySkillFile: async (id, fileId) => {
      const file = entry(id).files.get(fileId);
      if (!file) throw new Error('capability:not-found');
      return { text: file.text, revision: String(file.revision) };
    },
    capabilityMutate: async input => {
      if (input.action === 'skill-create') {
        if (entries.has(`local:${input.name}`)) throw new Error('capability:already-exists');
        return { warnings: [], skillId: add(input.name, input.description, input.instructions).skill.id };
      }
      if (!('id' in input)) return { warnings: [] };
      const record = entry(input.id);
      if (record.skill.source !== 'user') throw new Error('capability:read-only');
      if (input.action === 'skill-save') {
        if (forceConflict) { forceConflict = false; record.revision++; }
        assertRevision(input.revision, record.revision);
        record.skill.description = input.description;
        record.body = input.instructions;
        record.source = undefined;
        record.revision++;
      } else if (input.action === 'skill-mode') {
        assertRevision(input.revision, record.revision);
        const mode: CapabilitySkillMode = input.mode;
        record.skill.enabled = mode !== 'off';
        if (mode !== 'off') {
          record.skill.manualOnly = mode === 'manual';
          record.source = undefined;
          record.revision++;
        }
      } else if (input.action === 'skill-toggle') {
        record.skill.enabled = input.enabled;
      } else if (input.action === 'skill-remove') {
        assertRevision(input.revision, record.revision);
        entries.delete(input.id);
      } else if (input.action === 'skill-file-save') {
        if (!/^[\p{L}\p{N}][\p{L}\p{N}_. -]*(?:\/[\p{L}\p{N}][\p{L}\p{N}_. -]*)*$/u.test(input.path)
          || input.path.toLowerCase() === 'skill.md') throw new Error('capability:invalid-path');
        const file = input.fileId ? record.files.get(input.fileId) : undefined;
        if (input.fileId && !file) throw new Error('capability:not-found');
        if (record.files.has(input.path) && input.path !== input.fileId) throw new Error('capability:already-exists');
        if (file && input.fileId) { assertRevision(input.revision, file.revision); record.files.delete(input.fileId); }
        record.files.set(input.path, { text: input.text, revision: (file?.revision ?? 0) + 1 });
      } else if (input.action === 'skill-file-remove') {
        const file = record.files.get(input.fileId);
        if (!file) throw new Error('capability:not-found');
        assertRevision(input.revision, file.revision);
        record.files.delete(input.fileId);
      }
      return { warnings: [] };
    },
    copyText: async text => navigator.clipboard.writeText(text),
  };
  return { api, async importFolder(chosen: File[]) {
    const name = chosen[0].webkitRelativePath.split('/')[0];
    const manifest = chosen.find(item => item.webkitRelativePath === `${name}/SKILL.md`);
    if (!manifest) throw new Error('capability:invalid-input');
    if (entries.has(`local:${name}`)) throw new Error('capability:already-exists');
    if (chosen.length > 128 || chosen.reduce((total, file) => total + file.size, 0) > 2 * 1024 * 1024
      || manifest.size > 128 * 1024) throw new Error('capability:too-large');
    const raw = await manifest.text();
    const match = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(raw);
    const description = /^description: *(.*?)$/m.exec(match?.[1] ?? '')?.[1] ?? '';
    const files = await Promise.all(chosen.filter(item => item !== manifest).map(async item => [
      item.webkitRelativePath.slice(name.length + 1),
      { text: item.size <= 128 * 1024 ? await item.text() : undefined, revision: 1 },
    ] as const));
    const record = add(name, description, raw.slice(match?.[0].length ?? 0).trimStart());
    record.source = raw;
    record.files = new Map(files);
    return { warnings: [], skillId: record.skill.id };
  } };
}

export function SkillsDetailPreview({ language }: { language: 'zh' | 'en' }) {
  const input = useRef<HTMLInputElement>(null);
  const select = useRef<(files: File[]) => void>(undefined);
  const bridge = useRef<SkillsSettingsBridge>(undefined);
  if (!bridge.current) {
    const { api, importFolder } = fixtureStore(language);
    bridge.current = { ...api, capabilityImportSkill: () => new Promise<CapabilityResult | null>((resolve, reject) => {
      const field = input.current;
      if (!field) { resolve(null); return; }
      const cancel = () => { select.current = undefined; resolve(null); };
      field.addEventListener('cancel', cancel, { once: true });
      select.current = files => {
        field.removeEventListener('cancel', cancel);
        select.current = undefined;
        if (files.length) void importFolder(files).then(resolve, reject);
        else resolve(null);
      };
      field.webkitdirectory = true;
      field.click();
    }) };
  }
  return <div className="settings-content is-skills">
    <SkillsSettings bridge={bridge.current} language={language} busy={false} revision={0} preview onRestart={async () => {}}/>
    <input ref={input} type="file" hidden onChange={event => {
      const files = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = '';
      select.current?.(files);
    }}/>
  </div>;
}
