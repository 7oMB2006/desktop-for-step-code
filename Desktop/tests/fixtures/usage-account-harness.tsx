import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { UserRound, Palette, SlidersHorizontal, SunMoon } from 'lucide-react';
import { AccountSettings } from '../../src/AccountSettings';
import { PlanAllowance, type PlanAllowanceView } from '../../src/PlanAllowance';
import { AppTooltip } from '../../src/AppTooltip';
import type { Settings } from '../../src/contracts';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/appearance.css';
import '../../src/settings-dialog.css';

const params = new URLSearchParams(location.search);
const en = params.get('lang') === 'en';
const t = (zh: string, english: string) => en ? english : zh;
document.documentElement.lang = en ? 'en' : 'zh-CN';
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const scenarios: Record<string, PlanAllowanceView> = {
  coding: { status: 'ready', planName: 'Step Plan Pro', expiry: t('2026/11/17 到期', 'Expires Nov 17, 2026'), updated: t('更新于 14:32', 'Updated at 14:32'), meters: [
    { id: 'five_hour', label: t('5 小时额度', '5-hour allowance'), remainingPercent: 72, timing: t('16:30 重置 · 约 2 小时后', 'Resets at 16:30 · in about 2 hours') },
    { id: 'weekly', label: t('每周额度', 'Weekly allowance'), remainingPercent: 43, timing: t('10/20 08:00 重置 · 约 3 天后', 'Resets Oct 20 at 08:00 · in about 3 days') },
  ] },
  token: { status: 'ready', planName: t('Token 订阅套餐', 'Token subscription'), expiry: t('2026/11/17 到期', 'Expires Nov 17, 2026'), updated: t('更新于 14:32', 'Updated at 14:32'), meters: [
    { id: 'subscription', label: t('订阅额度', 'Subscription allowance'), remainingPercent: 68.5, timing: t('11/17 08:00 重置', 'Resets Nov 17 at 08:00') },
    { id: 'topup', label: t('充值额度', 'Top-up allowance'), remainingPercent: 12, timing: t('2027/01/01 到期', 'Expires Jan 1, 2027') },
  ] },
  none: { status: 'ready', noPlan: true, meters: [], message: t('当前账户没有有效订阅。', 'No active subscription on this account.') },
  loading: { status: 'loading', meters: [] },
  error: { status: 'error', meters: [], message: t('暂时无法获取套餐与额度，请稍后重试。', 'Unable to retrieve plan and allowance. Try again later.') },
  unsupported: { status: 'unsupported', meters: [], message: t('当前 API Key 登录方式不支持查询个人 Plan 额度。', 'API Key sign-in does not support personal Plan allowance queries.') },
};
scenarios.stale = { ...scenarios.coding, status: 'stale', message: t('刷新失败，正在显示上次获取的额度。', 'Refresh failed. Showing the last retrieved allowance.') };
const labels = [t('Coding 套餐', 'Coding plan'), t('Token 套餐', 'Token plan'), t('未订阅', 'No subscription'), t('加载中', 'Loading'), t('查询失败', 'Query failed'), t('不支持', 'Unsupported'), t('旧数据', 'Stale data')];
const settings: Settings = {
  account: { loggedIn: true, validity: 'valid', profile: 'step_plan', userId: '100008326' },
  profiles: [
    { id: 'step_plan', title: 'Step Plan', description: '', credentialSource: 'browser' },
    { id: 'step_plan_oversea', title: 'Step Plan', description: '', credentialSource: 'browser' },
    { id: 'platform_cn', title: 'API Key', description: '', credentialSource: 'apiKey' },
    { id: 'platform_oversea', title: 'API Key', description: '', credentialSource: 'apiKey' },
  ], mcp: {}, skills: [],
};
function Harness() {
  const [scenario, setScenario] = useState(Object.hasOwn(scenarios, params.get('state') ?? '') ? params.get('state')! : 'coding');
  const [refreshing, setRefreshing] = useState(false);
  const [updated, setUpdated] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const value = { ...scenarios[scenario], ...(refreshing ? { status: 'loading' as const } : {}),
    ...(updated ? { updated: t('刚刚更新', 'Updated just now') } : {}) };
  return <div className="modal-backdrop settings-backdrop">
    <section className="settings-dialog" role="dialog" aria-label={t('设置', 'Settings')}>
      <header><h2>{t('设置', 'Settings')}</h2><div className="usage-preview-controls">
        <span>{t('示例数据', 'Sample data')}</span>
        <select aria-label={t('预览状态', 'Preview state')} value={scenario} onChange={event => {
          clearTimeout(timer.current); setRefreshing(false); setUpdated(false); setScenario(event.target.value);
        }}>{Object.keys(scenarios).map((key, index) => <option key={key} value={key}>{labels[index]}</option>)}</select>
        <button aria-label={t('切换主题', 'Toggle theme')} data-tooltip={t('切换主题', 'Toggle theme')} onClick={() => {
          document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        }}><SunMoon size={16}/></button>
      </div></header>
      <div className="settings-layout"><nav aria-label={t('设置分类', 'Settings categories')}>
        <button className="selected" aria-current="page"><UserRound size={17}/>{t('账户', 'Account')}</button>
        <button disabled><SlidersHorizontal size={17}/>{t('界面复杂度', 'Interface complexity')}</button>
        <button disabled><Palette size={17}/>{t('外观', 'Appearance')}</button>
      </nav><div className="settings-content"><AccountSettings
        settings={{ ...settings, account: { ...settings.account, profile: scenario === 'unsupported' ? 'platform_cn' : 'step_plan' } }}
        profile="step_plan" onProfile={() => {}} apiKey="" onKey={() => {}} loggingIn={false} busy
        language={en ? 'en' : 'zh'} onLogin={() => {}} onCancel={() => {}} onLogout={() => {}}
        allowance={<PlanAllowance value={value} language={en ? 'en' : 'zh'} onRefresh={() => {
          setRefreshing(true);
          timer.current = setTimeout(() => {
            if (scenario === 'error' || scenario === 'stale') setScenario('coding');
            setRefreshing(false); setUpdated(true);
          }, 900);
        }}/>}
      /></div></div>
    </section><AppTooltip/>
  </div>;
}
const style = document.createElement('style');
style.textContent = '.usage-preview-controls{display:flex;align-items:center;gap:12px;font-size:11px;color:var(--muted);min-width:0}.usage-preview-controls select{font-size:11px;width:120px}.usage-preview-controls button{display:grid;place-items:center;padding:5px;border:0;background:transparent}@media(max-width:520px){.usage-preview-controls{gap:6px}.usage-preview-controls>span{display:none}}';
document.head.append(style);
createRoot(document.getElementById('root')!).render(<Harness/>);
