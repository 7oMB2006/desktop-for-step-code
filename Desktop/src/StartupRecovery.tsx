import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChevronDown, FileText, Hourglass, RotateCcw, TriangleAlert, X } from 'lucide-react';
import type { StartupRecoveryBridge, StartupRecoveryState } from './startup-recovery-contract';
import './startup-recovery.css';

export function mountStartupRecovery(bridge: StartupRecoveryBridge) {
  document.documentElement.classList.add('native-startup');
  const node = document.createElement('div');
  document.body.prepend(node);
  const root = createRoot(node);
  function Recovery() {
    const [state, setState] = useState<StartupRecoveryState>();
    useEffect(() => bridge.subscribe(setState), []);
    const surface = state?.surface ?? 'transparent';
    const recovery = surface === 'recovery';
    const failed = Boolean(state?.failure);
    const title = state?.busy ? '正在结束启动进程' : failed ? '启动未完成'
      : recovery ? '启动等待已超时' : '启动耗时较长';
    const detail = state?.busy ? '正在安全关闭，完成后执行所选操作。'
      : state?.failure === 'STOP_FAILED' ? '关闭未完成，请重试关闭或重新启动。'
        : failed ? '工作区未能就绪，可以重新启动。'
          : recovery ? '初始化尚未返回结果，可以继续等待或重新启动。'
            : '仍在准备工作区，暂未收到完成信号。';
    return <section className="startup-surface" data-surface={surface} role={recovery ? 'dialog' : undefined}
      aria-label={recovery ? 'Desktop for Step Code 启动恢复' : undefined}>
      <header className="startup-caption" aria-hidden={surface === 'transparent'}>
        <span>Desktop for Step Code</span>
        {recovery && <button className="startup-close" title="退出应用" aria-label="退出应用"
          disabled={state?.busy} onClick={() => bridge.command('close')}><X size={15}/></button>}
      </header>
      <div className="startup-logo-slot" aria-hidden="true"/>
      <div className="startup-message" aria-hidden={surface === 'transparent'}>
        <div role={recovery ? 'alert' : 'status'} aria-live="polite" aria-atomic="true">
          <h1>{recovery && !state?.busy && <TriangleAlert size={16}/>} {title}</h1>
          <p>{detail}</p>
        </div>
        {recovery && <div className="startup-actions">
          {!failed && <button disabled={state?.busy} onClick={() => bridge.command('continue')}>
            <Hourglass size={15}/>继续等待</button>}
          <button className="startup-primary" disabled={state?.busy} onClick={() => bridge.command('retry')}>
            <RotateCcw size={15}/>重试启动</button>
        </div>}
        {recovery && <details className="startup-diagnostic">
          <summary><FileText size={14}/>查看启动诊断<ChevronDown size={14}/></summary>
          <pre>{[
            'DFSC 启动诊断',
            `version: ${state?.version}`,
            `platform: ${state?.platform}`,
            `stage: ${state?.stage}`,
            `elapsed: ${((state?.elapsed ?? 0) / 1000).toFixed(1)}s`,
            `code: ${state?.failure ?? 'INIT_TIMEOUT'}`,
            '不包含账户、会话、路径或配置内容。',
          ].join('\n')}</pre>
        </details>}
      </div>
    </section>;
  }
  root.render(<Recovery/>);
  window.addEventListener('pagehide', () => root.unmount(), { once: true });
}
