import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SunMoon } from 'lucide-react';
import { ContextPanel } from '../../src/ContextPanel';
import { AccountSettings } from '../../src/AccountSettings';
import { EstimateRules } from '../../src/EstimateRules';
import { PlanAllowance } from '../../src/PlanAllowance';
import { ApiBalance } from '../../src/ApiBalance';
import { AppTooltip } from '../../src/AppTooltip';
import type { EstimateGroup, EstimateRules as Rules, SessionEstimate } from '../../src/usage-estimates';
import type { Settings } from '../../src/contracts';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/settings-dialog.css';

const params = new URLSearchParams(location.search), language = params.get('lang') === 'en' ? 'en' : 'zh';
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light';
function Harness() {
  const [profile, setProfile] = useState(params.get('mode') === 'api' ? 'platform_cn' : 'step_plan');
  const [custom, setCustom] = useState(false);
  const [rules, setRules] = useState<Rules>({ planProtected: false, apiLegacyCache: false });
  const [expanded, setExpanded] = useState(false);
  const mode = profile.startsWith('platform_') ? 'api' : 'plan';
  const settings: Settings = { account: { loggedIn: true, validity: 'valid', profile, userId: '100008326' },
    profiles: [{ id: 'step_plan', title: 'Step Plan', credentialSource: 'browser', description: '' },
      { id: 'platform_cn', title: 'API Key', credentialSource: 'apiKey', description: '' }], mcp: {}, skills: [] };
  const groups: EstimateGroup[] = [
    { id: 'plan', mode: 'plan', region: 'cn', currency: 'CNY', amount: 3.47, responses: 13, unknown: 0, currentAccount: true },
    { id: 'api', mode: 'api', region: 'cn', currency: 'CNY', amount: .1684, responses: 2, unknown: 0, currentAccount: true },
  ];
  const estimate: SessionEstimate = { settings: { available: true, accountRef: 'fixture', mode, region: 'cn', rules },
    active: groups.find(g => g.mode === mode), groups, historicalUnknown: true };
  const bridge = { estimateSettings: async () => estimate.settings,
    setEstimateRules: async (next: Rules) => { setRules(next); return { ...estimate.settings, rules: next }; } };
  return <main className="usage-estimates-preview">
    <section className="usage-estimates-settings">
      <header><h2>{language === 'en' ? 'Account' : '账户'}</h2><button aria-label="Theme" onClick={() => {
        document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      }}><SunMoon size={16}/></button></header>
      <AccountSettings settings={settings} profile={profile} onProfile={setProfile} apiKey="" onKey={() => {}} loggingIn={false} busy={false}
        language={language} onLogin={() => {}} onCancel={() => {}} onLogout={() => {}}
        allowance={<>{mode === 'plan' ? <PlanAllowance language={language} value={{ status: 'ready', planName: 'Step Plan Pro',
          meters: [{ id: 'subscription', label: language === 'en' ? 'Subscription allowance' : '订阅额度', remainingPercent: 96, timing: '2026/11/13 10:05' }] }}
          onRefresh={() => {}}/> : <ApiBalance language={language} value={{ status: 'ready', source: 'api', meters: [],
            balance: { amount: 128.65, currency: 'CNY', accountType: 'prepaid' } }} onRefresh={() => {}}/>}
          <EstimateRules key={mode} bridge={bridge} account={settings.account} language={language} disabled={false} onChanged={async () => {}}/></>}/>
      <label className="preview-custom"><input type="checkbox" checked={custom} onChange={e => setCustom(e.target.checked)}/>
        {language === 'en' ? 'Third-party model' : '第三方模型'}</label>
    </section>
    <div className="usage-estimates-context"><ContextPanel title={language === 'en' ? 'Review streaming behaviour' : '检查消息续流'}
      messages={[]} estimate={estimate} state={{ isStreaming: false, model: { id: 'step-5-preview', name: 'Step 5 Preview', provider: custom ? 'desktop-custom-example' : 'step' } }}
      stats={{ toolCalls: 6, assistantMessages: 15, tokens: { input: 386871, cacheRead: 1142528, cacheWrite: 0, output: 17987, total: 1547386 },
        contextUsage: { percent: 16.2, tokens: 162000, contextWindow: 1000000 } }}
      language={language} busy={false} connected expanded={expanded} onToggleExpanded={() => setExpanded(!expanded)} onClose={() => {}}
      onRefresh={async () => {}} onError={() => {}}/></div><AppTooltip/>
  </main>;
}
const style = document.createElement('style');
style.textContent = 'body{overflow:auto}.usage-estimates-preview{display:grid;grid-template-columns:minmax(0,600px) minmax(320px,440px);justify-content:center;min-height:100dvh;background:var(--bg);color:var(--ink)}.usage-estimates-settings{padding:28px;min-width:0}.usage-estimates-settings>header{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px}.usage-estimates-settings h2{font-size:16px;margin:0}.usage-estimates-settings h3{font-size:13px}.usage-estimates-context{min-width:0;height:100dvh;position:sticky;top:0}.preview-custom{display:flex;align-items:center;gap:8px;font-size:12px;margin-top:20px}.preview-custom input{width:14px;height:14px}.account-estimate-rules p{max-width:65ch}@media(max-width:720px){.usage-estimates-preview{grid-template-columns:minmax(0,1fr)}.usage-estimates-context{height:760px;position:static}.usage-estimates-settings{padding:20px}}';
document.head.append(style);
createRoot(document.getElementById('root')!).render(<Harness/>);
