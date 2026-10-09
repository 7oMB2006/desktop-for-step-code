import { Check, Cloud, ExternalLink, KeyRound, LogOut } from 'lucide-react';
import type { Settings } from './contracts';
import './account-settings.css';
import { StepPlatformIcon } from './ProviderBrand';
export { StepPlatformIcon } from './ProviderBrand';

export function ProviderIcon({ size = 17 }: { size?: number }) {
  return <Cloud size={size} aria-hidden="true"/>;
}

const channels: Record<string, { title: string; zh: string; en: string }> = {
  step_plan: { title: 'Step Plan', zh: '中国大陆', en: 'Mainland China' },
  step_plan_oversea: { title: 'Step Plan', zh: '海外', en: 'International' },
  platform_cn: { title: 'API Key', zh: '中国大陆', en: 'Mainland China' },
  platform_oversea: { title: 'API Key', zh: '海外', en: 'International' },
};

export function AccountSettings({ settings, profile, onProfile, apiKey, onKey, loggingIn, busy, language, onLogin, onCancel, onLogout }: {
  settings: Settings; profile: string; onProfile: (id: string) => void;
  apiKey: string; onKey: (key: string) => void; loggingIn: boolean; busy: boolean;
  language: string; onLogin: () => void; onCancel: () => void; onLogout: () => void;
}) {
  const t = (zh: string, en: string) => language === 'en' ? en : zh;
  const { account } = settings;
  const active = channels[account.profile ?? ''];
  const selected = settings.profiles.find(item => item.id === profile);
  const verified = account.loggedIn && account.validity === 'valid';
  const status = !account.loggedIn ? t('未登录', 'Not signed in') : verified ? t('已登录', 'Signed in') : account.validity === 'invalid' ? t('凭据已失效', 'Credential rejected') : t('已保存凭据 · 暂无法验证', 'Credential saved · Verification unavailable');
  return <section className="account-settings">
    <h3>{t('阶跃账户', 'StepFun account')}</h3>
    <div className="account-identity">
      <span className="account-logo"><StepPlatformIcon size={30}/></span>
      <div className="account-identity-text"><strong>{active ? `${active.title} · ${t(active.zh, active.en)}` : t('阶跃开放平台', 'StepFun platform')}</strong><span className={`account-status${verified ? ' is-verified' : account.validity === 'invalid' ? ' is-invalid' : ''}`}><i/>{status}</span>{account.userId && <span className="account-user-id">UID {account.userId}</span>}</div>
      {account.loggedIn && <button className="account-logout" disabled={busy || loggingIn} onClick={onLogout}><LogOut size={15}/>{t('退出登录', 'Sign out')}</button>}
    </div>
    {account.loggedIn && <dl className="account-details"><div><dt>{active?.title === 'API Key' ? t('账户余额', 'Account balance') : t('套餐与额度', 'Plan and allowance')}</dt><dd>{t('当前接口未提供', 'Unavailable from the current API')}</dd></div></dl>}
    <h4>{t('登录方式', 'Sign-in method')}</h4>
    <div className="account-channels" role="group" aria-label={t('登录方式', 'Sign-in method')}>
      {settings.profiles.map(item => {
        const channel = channels[item.id];
        const isSelected = profile === item.id;
        return <button type="button" key={item.id} className={`account-channel${isSelected ? ' is-selected' : ''}`} aria-pressed={isSelected} disabled={loggingIn} onClick={() => { onProfile(item.id); onKey(''); }}>
          <span className="account-channel-top">{item.credentialSource === 'browser' ? <StepPlatformIcon size={20}/> : <KeyRound size={20}/>}<span>{t(channel?.zh ?? item.title, channel?.en ?? item.title)}</span>{isSelected && <Check size={15}/>}</span>
          <strong>{channel?.title ?? item.title}</strong><small>{item.credentialSource === 'browser' ? t('浏览器授权', 'Browser authorization') : t('按量付费', 'Pay as you go')}</small>
        </button>;
      })}
    </div>
    <div className="account-login-area">
      {selected?.credentialSource === 'apiKey' && <label>API Key<input type="password" autoComplete="off" value={apiKey} onChange={event => onKey(event.target.value)}/></label>}
      <div className="button-row"><button className="primary" disabled={loggingIn || busy || !selected || (selected.credentialSource === 'apiKey' && !apiKey.trim())} onClick={onLogin}><ExternalLink size={15}/>{loggingIn ? t('等待授权…', 'Waiting for sign-in…') : t('登录', 'Sign in')}</button>{loggingIn && <button onClick={onCancel}>{t('取消', 'Cancel')}</button>}</div>
    </div>
  </section>;
}
