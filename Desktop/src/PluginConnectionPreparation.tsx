import { ArrowRight, BookOpen, Cable, CircleCheck, CircleHelp, FolderKey, FolderOpen, Plug, TriangleAlert } from 'lucide-react';
import type { RefObject } from 'react';
import type { PluginConnection } from './capabilities';
import { pluginConnectionPreparation, type PluginConnectionGuide, type PreparationStepId } from './plugin-connection-preparation';

const copy = {
  zh: {
    title: '准备情况', scope: '仅检查你选择的本机身份，不自动安装、配对或扩大授权。',
    profile: 'Agent 身份目录', companion: '桥接组件配置', bridge: '配对与连接', roots: '工程目录授权',
    unchecked: '未检查', found: '已找到目录', missing: '缺少', invalid: '需检查',
    configured: '配置已核对', pairing: '待配对', unavailable: '无法连接', mismatch: '身份不符',
    verified: '只读已连通', authorized: '已核验范围', 'no-roots': '没有可见目录',
    choose: '选择身份目录', change: '更换身份目录', setup: '查看准备步骤', troubleshooting: '查看排查步骤',
    firstTask: '查看第一项任务', firstTitle: '接下来，做一项小任务',
    firstBody: '先用专用练习目录确认收到委托、执行结果与回传。只读连接成功不代表整条链路已通过。',
    profileUnchecked: '选择 Agent 使用的独立 profile 目录，不是源码目录或市场插件目录。',
    profileFound: '已找到 profile 标记。Agent 程序、模型和消息渠道是否可用，仍需在 Agent 侧确认。',
    profileMissing: '所选目录不可用，或缺少 config.yaml。请重新选择已有的独立 profile。',
    companionUnchecked: '先选择身份目录，再检查其中的桥接配置。',
    companionMissing: '未找到此身份的 dfsc-bridge 配置，请按指南安装本项目的配套组件。',
    companionInvalid: '桥接配置或连接描述文件未通过检查，请按排查步骤核对。这里不会自动修复。',
    companionConfigured: '已核对当前身份的桥接配置。组件是否已被 Agent 加载，仍需在 Agent 侧确认。',
    bridgeUnchecked: '配置核对后，检查此身份的配对凭据与工程桥连接。',
    bridgePairing: '缺少此身份的配对凭据，请在配套工程桥宿主中完成配对。',
    bridgeUnavailable: '暂时无法查询工程桥，请确认配套宿主已启动，配对仍有效。',
    bridgeMismatch: '身份不一致，已停止读取任务。请核对 profile 与配套宿主中的身份。',
    bridgeVerified: '本次只读查询已核验身份，不代表实时在线或已经可以派工。',
    rootsUnchecked: '连接核验后，才能确认这项身份实际可见的授权目录。',
    rootsNone: '连接已核验，但双方配置没有可见目录。请在配套宿主授权专用练习目录后重新检查。',
    rootsAuthorized: '本次已核验可见目录，路径列在下方。此检查不会新增或扩大授权。',
  },
  en: {
    title: 'Preparation', scope: 'Checks only the local identity you choose. No installation, pairing or permission changes.',
    profile: 'Agent profile', companion: 'Companion configuration', bridge: 'Pairing and connection', roots: 'Workspace authorization',
    unchecked: 'Not checked', found: 'Profile found', missing: 'Missing', invalid: 'Needs review',
    configured: 'Configuration checked', pairing: 'Pairing required', unavailable: 'Unavailable', mismatch: 'Identity mismatch',
    verified: 'Read-only verified', authorized: 'Scope verified', 'no-roots': 'No visible directories',
    choose: 'Choose profile', change: 'Change profile', setup: 'View setup steps', troubleshooting: 'View troubleshooting',
    firstTask: 'View first task', firstTitle: 'Next, try a small task',
    firstBody: 'Use a dedicated practice directory to confirm receipt, execution and the returned result. Read-only verification does not complete that workflow.',
    profileUnchecked: 'Choose the Agent’s independent profile directory, not its source or marketplace plugin directory.',
    profileFound: 'The profile marker was found. Confirm the Agent program, model and messaging channels separately in the Agent.',
    profileMissing: 'The selected directory is unavailable or has no config.yaml. Choose an existing independent profile.',
    companionUnchecked: 'Choose a profile before checking its companion configuration.',
    companionMissing: 'No dfsc-bridge configuration was found for this identity. Follow the guide to install the project’s companion.',
    companionInvalid: 'The bridge configuration or connection descriptor failed validation. Follow troubleshooting; nothing is repaired automatically.',
    companionConfigured: 'The bridge configuration for this identity was checked. Confirm companion loading separately in the Agent.',
    bridgeUnchecked: 'After checking configuration, check this identity’s pairing credentials and Bridge connection.',
    bridgePairing: 'Pairing credentials for this identity are missing. Pair it in the separate Bridge host.',
    bridgeUnavailable: 'The Bridge cannot be queried. Check that the separate host is running and pairing is still valid.',
    bridgeMismatch: 'The identities disagree, so task reading stopped. Check the profile and identity in the separate host.',
    bridgeVerified: 'This read-only query verified the identity. It does not establish live presence or dispatch readiness.',
    rootsUnchecked: 'Verify the connection before checking which authorized directories this identity can actually see.',
    rootsNone: 'The connection was verified but no directories are visible in both configurations. Authorize a practice directory in the separate host, then check again.',
    rootsAuthorized: 'Visible directories were verified for this check and are listed below. No authorization was added or expanded.',
  },
} as const;

const icons = { profile: FolderOpen, companion: Plug, bridge: Cable, roots: FolderKey };

export function PluginConnectionPreparation({ state, language, pending, available, hasFirstTask, profileButton, onChoose, onGuide }: {
  state?: PluginConnection; language: 'zh' | 'en'; pending: boolean; available: boolean; hasFirstTask: boolean;
  profileButton: RefObject<HTMLButtonElement | null>;
  onChoose(): void; onGuide(guide: PluginConnectionGuide): void;
}) {
  const c = copy[language];
  const descriptions: Record<PreparationStepId, string> = {
    profile: state?.status === 'profile-missing' ? c.profileMissing
      : !state || state.status === 'unselected' ? c.profileUnchecked : c.profileFound,
    companion: state?.status === 'companion-missing' ? c.companionMissing
      : state?.status === 'configuration-invalid' ? c.companionInvalid
      : !state || ['unselected', 'profile-missing'].includes(state.status) ? c.companionUnchecked : c.companionConfigured,
    bridge: state?.status === 'pairing-required' ? c.bridgePairing
      : state?.status === 'connection-unavailable' ? c.bridgeUnavailable
      : state?.status === 'identity-mismatch' ? c.bridgeMismatch
      : state?.status === 'ready' ? c.bridgeVerified : c.bridgeUnchecked,
    roots: state?.status === 'ready' ? state.roots.length ? c.rootsAuthorized : c.rootsNone : c.rootsUnchecked,
  };
  return <section className="plugin-preparation" aria-label={c.title} aria-busy={pending}>
    <p className="plugin-preparation-scope">{c.scope}</p>
    <ol className="plugin-preparation-steps">
      {pluginConnectionPreparation(state).map(step => {
        const Icon = icons[step.id];
        const StatusIcon = step.tone === 'verified' ? CircleCheck : step.tone === 'attention' ? TriangleAlert : CircleHelp;
        const label = step.action === 'choose' ? state?.profile ? c.change : c.choose : c[step.action];
        return <li key={step.id} className="plugin-preparation-step" data-preparation-step={step.id} data-result={step.result}>
          <div className="plugin-preparation-step-heading"><Icon size={18}/><h3>{c[step.id]}</h3></div>
          <span className={`plugin-preparation-result is-${step.tone}`}><StatusIcon size={13}/>{c[step.result]}</span>
          <p>{descriptions[step.id]}</p>
          <button type="button" ref={step.id === 'profile' ? profileButton : undefined}
            disabled={step.action === 'choose' && (!available || pending)}
            onClick={() => step.action === 'choose' ? onChoose() : onGuide(step.action)}>
            {step.action === 'choose' ? <FolderOpen size={14}/> : <BookOpen size={14}/>}{label}
          </button>
        </li>;
      })}
    </ol>
    {hasFirstTask && <section className="plugin-preparation-first">
      <div><h3>{c.firstTitle}</h3><p>{c.firstBody}</p></div>
      <button type="button" onClick={() => onGuide('firstTask')}><ArrowRight size={15}/>{c.firstTask}</button>
    </section>}
  </section>;
}
