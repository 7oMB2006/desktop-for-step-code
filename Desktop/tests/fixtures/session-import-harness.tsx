import React from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRightLeft } from 'lucide-react';
import { SessionImportSettings } from '../../src/SessionImportSettings';
import type { ImportCandidate, ImportJob, SessionImportBridge } from '../../src/session-import';
import { applyTheme } from '../../src/theme';
import '../../src/style.css';
import '../../src/settings-dialog.css';
import '../../src/theme.css';

const params = new URLSearchParams(location.search);
const language = params.get('lang') === 'en' ? 'en' : 'zh';
applyTheme(params.get('theme') === 'light' ? 'light' : 'dark', false);
const samples: ImportCandidate[] = [{
  id: 'sample-codex', source: 'codex', sessionId: 'codex-source', title: '为本地工具补充测试与文档',
  cwd: 'D:\\Projects\\desktop-tools', modified: '2026-10-22T06:10:00Z', version: '0.163', archived: false,
}, {
  id: 'sample-claude', source: 'claude-code', sessionId: 'claude-source', title: '梳理数据导入流程',
  cwd: 'D:\\Projects\\data-service', modified: '2026-10-21T02:30:00Z', version: '2.1', archived: false,
}];
if (params.has('many')) {
  const titles = ['修复登录后的账户刷新', '补充接口边界测试', '整理组件与主题样式', '排查任务恢复流程', '完善项目文档'];
  for (let index = 3; index <= (params.get('many') === 'large' ? 125 : 65); index++) {
    samples.push({
      ...samples[index % 2], id: `sample-${index}`, sessionId: `source-${index}`,
      title: `${titles[(index - 3) % titles.length]} #${index}`,
      cwd: `D:\\Projects\\workspace-${index}`, modified: new Date(Date.UTC(2026, 9, 22, 6, 0, -index)).toISOString(),
    });
  }
}
const jobs: ImportJob[] = [];
if (params.has('history')) {
  for (let index = 0; index < 7; index++) jobs.push({
    id: `history-${index}`, createdAt: new Date(Date.UTC(2026, 9, 22, 10, 0, -index)).toISOString(),
    status: 'completed', total: samples.length,
    results: samples.map((candidate, resultIndex) => ({
      candidateId: candidate.id, title: candidate.title,
      status: resultIndex === 2 ? 'failed' : resultIndex === 1 ? 'skipped' : 'imported',
      ...(resultIndex === 2 ? { error: 'fixture failure' } : { sessionId: 'demo-copy' }),
    })),
  });
}
const delay = () => new Promise(resolve => setTimeout(resolve, 180));
const bridge: SessionImportBridge = {
  importScan: async () => { await delay(); return { candidates: samples, errors: [] }; },
  importPreview: async id => {
    await delay();
    const candidate = samples.find(item => item.id === id)!;
    return { ...candidate, fingerprint: 'a'.repeat(64), messageCount: 18, toolCount: 7,
      warnings: id === 'sample-claude' ? [{ code: 'claude_compaction', count: 1 }] : [],
      excerpt: 'user: 先检查项目里的测试覆盖，补上边界场景。\n\nassistant: 我先确认数据入口与错误处理，再补定向回归。\n\ntoolResult: 12 tests passed\n\nassistant: 测试与文档已更新。' };
  },
  importStart: async selections => {
    await delay();
    const job: ImportJob = { id: String(jobs.length + 1), createdAt: new Date().toISOString(),
      status: 'completed', total: selections.length, results: selections.map(selection => ({
        candidateId: selection.candidateId, title: samples.find(item => item.id === selection.candidateId)?.title,
        status: 'imported', sessionId: 'demo-copy',
      })) };
    jobs.push(job); return structuredClone(job);
  },
  importJobs: async () => structuredClone(jobs),
  importCancel: async id => jobs.find(job => job.id === id)!,
  importChooseDirectory: async () => 'D:\\Projects\\migration-demo',
};
createRoot(document.getElementById('root')!).render(
  <div className="modal-backdrop settings-backdrop" style={{ position: 'absolute' }}>
    <section className="settings-dialog" role="dialog" aria-label={language === 'zh' ? '设置' : 'Settings'}>
      <header><h2>{language === 'zh' ? '设置' : 'Settings'}</h2></header>
      <div className="settings-layout"><nav><button aria-current="page" className="selected"><ArrowRightLeft size={17}/>{language === 'zh' ? '会话迁移' : 'Session migration'}</button></nav>
        <div className="settings-content"><SessionImportSettings bridge={bridge} language={language} onOpen={async () => {}}/></div>
      </div>
    </section>
  </div>,
);
