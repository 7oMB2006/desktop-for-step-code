import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowLeft, Check, ChevronDown, CircleCheck, FileText, Folder, Hourglass, Image, LayoutGrid,
  Monitor, Moon, Play, RotateCcw, Search, Sparkles, Square, Sun, SunMoon, TimerOff, Trash2, TriangleAlert, X,
} from 'lucide-react';
import {
  previewScenario, scenarioPhase, scenarioSurface, startupScenarios, type ScenarioPhase, type StartupScenario,
} from './startup-scenario-model';
import './startup-scenarios.css';

type Material = 'stellar' | 'default';
type Desktop = 'light' | 'dark' | 'busy';
const desktops = [
  { id: 'light', name: '明亮桌面', Icon: Sun },
  { id: 'dark', name: '深色桌面', Icon: Moon },
  { id: 'busy', name: '复杂壁纸', Icon: Image },
] as const;
const icons = { normal: CircleCheck, slow: Hourglass, timeout: TimerOff, failure: TriangleAlert, animation: Sparkles };
const names: Record<ScenarioPhase, string> = {
  opening: '入场', waiting: '等待工作区', delayed: '慢启动', timeout: '等待超时', failed: '启动失败', handoff: '工作区交接',
};

function DesktopBackdrop({ desktop }: { desktop: Desktop }) {
  return <div className="scenario-desktop" data-desktop={desktop} aria-hidden="true">
    {desktop === 'busy' && <img className="scenario-wallpaper"
      src="/tests/fixtures/startup-scenario-assets/stellar-desktop.webp" alt=""/>}
    <div className="scenario-desktop-shortcuts">
      <div><Monitor size={30}/><span>这台电脑</span></div>
      <div><Folder size={30}/><span>项目</span></div>
      <div><Trash2 size={29}/><span>回收站</span></div>
    </div>
    <div className="scenario-taskbar">
      <div className="scenario-taskbar-apps"><LayoutGrid size={20}/><Search size={19}/><Folder size={21}/>
        <span><img src="/StepCode.svg" alt="" width="22" height="22"/></span></div>
      <div className="scenario-taskbar-clock"><span>10:24</span><small>2026/11/10</small></div>
    </div>
  </div>;
}

function StartupScenarioRun({ scenario, material, desktop, retry, stop }: {
  scenario: StartupScenario; material: Material; desktop: Desktop; retry: () => void; stop: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [continuedAt, setContinuedAt] = useState(0);
  const [entranceComplete, setEntranceComplete] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [shellReady, setShellReady] = useState(false);
  const [shellFailed, setShellFailed] = useState(false);
  const startedAt = useRef(performance.now());
  const cleanupSplash = useRef<() => void>(() => {});
  const cleanupShell = useRef<() => void>(() => {});
  const phase = scenarioPhase(scenario, elapsed, entranceComplete, continuedAt);
  const terminal = phase === 'failed' || phase === 'timeout' || phase === 'handoff' && (shellReady || shellFailed);
  useEffect(() => {
    if (terminal) return;
    const timer = setInterval(() => setElapsed(performance.now() - startedAt.current), 100);
    return () => clearInterval(timer);
  }, [terminal]);
  useEffect(() => () => { cleanupSplash.current(); cleanupShell.current(); }, []);
  useEffect(() => {
    if (phase !== 'handoff' || shellReady) return;
    const timer = setTimeout(() => setShellFailed(true), 12000);
    return () => clearTimeout(timer);
  }, [phase, shellReady]);

  const observeSplash = (iframe: HTMLIFrameElement) => {
    cleanupSplash.current();
    const doc = iframe.contentDocument;
    if (!doc) return;
    let injected = false, faultTimer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      const logo = doc.querySelector<HTMLElement>('.logo');
      if (doc.documentElement.dataset.startupComplete === 'true') setEntranceComplete(true);
      if (logo?.dataset.fallback === 'true') setDegraded(true);
      if (scenario !== 'animation' || injected || !logo
        || material === 'stellar' && logo.dataset.ready !== 'true') return;
      injected = true;
      // Exercise the actual renderer's fallback handler, without changing production code.
      faultTimer = setTimeout(() => {
        if (material === 'stellar') {
          const event = doc.createEvent('Event');
          event.initEvent('webglcontextlost', true, true);
          logo.querySelector('canvas')?.dispatchEvent(event);
        } else {
          logo.style.animation = 'none';
          setDegraded(true);
        }
      }, 500);
    };
    const observer = new MutationObserver(read);
    observer.observe(doc.documentElement, { subtree: true, attributes: true,
      attributeFilter: ['data-startup-complete', 'data-ready', 'data-fallback'] });
    read();
    cleanupSplash.current = () => { observer.disconnect(); clearTimeout(faultTimer); };
  };
  const observeShell = (iframe: HTMLIFrameElement) => {
    cleanupShell.current();
    const doc = iframe.contentDocument;
    if (!doc) return;
    const read = () => {
      if (!doc.querySelector('.app')) return;
      setShellReady(true);
      observer.disconnect();
    };
    const observer = new MutationObserver(read);
    observer.observe(doc, { subtree: true, childList: true });
    read();
    cleanupShell.current = () => observer.disconnect();
  };

  const failed = phase === 'failed' || shellFailed;
  const surface = scenarioSurface(phase, elapsed, continuedAt, shellFailed);
  const title = shellFailed ? '工作区样例加载失败' : phase === 'failed' ? '启动未完成'
    : phase === 'timeout' ? '启动等待已超时' : phase === 'delayed' ? '启动耗时较长'
      : phase === 'handoff' ? shellReady ? '工作区已就绪' : '正在打开工作区'
        : degraded ? '已切换为静态徽标' : continuedAt ? '继续等待初始化' : '正在准备工作区';
  const detail = shellFailed ? '离线样例未能打开，可以重试这次演示。'
    : phase === 'failed' ? '工作区设置读取失败。'
      : phase === 'timeout' ? '初始化尚未返回结果，可以继续等待或重新启动。'
        : phase === 'delayed' ? '仍在准备工作区，暂未收到完成信号。'
          : degraded ? '动画不可用，不影响继续启动。' : '';
  const diagnostic = [
    'DFSC 启动诊断 · 模拟数据',
    `scenario: ${scenario}`,
    `stage: ${shellFailed ? 'preview-workspace' : 'workspace-initialization'}`,
    `elapsed: ${(elapsed / 1000).toFixed(1)}s`,
    `code: ${shellFailed ? 'PREVIEW_SHELL_LOAD_FAILED' : failed ? 'PREVIEW_INIT_FAILED' : 'PREVIEW_INIT_TIMEOUT'}`,
    `animation: ${degraded ? 'static-fallback' : entranceComplete ? 'completed' : 'pending'}`,
    '未读取真实日志、会话、凭据或配置。',
  ].join('\n');

  return <section className="scenario-run" data-phase={phase} data-degraded={degraded}
    data-shell-ready={shellReady} aria-label="启动场景">
    <div className="scenario-screen">
      <DesktopBackdrop desktop={desktop}/>
      {phase === 'handoff' && !shellFailed && <iframe className="scenario-workspace"
        title="工作区 · 离线样例" src="./theme-pack.html?view=chat"
        data-visible={shellReady} onLoad={event => observeShell(event.currentTarget)}/>}
      {(!shellReady || shellFailed) && <div className="scenario-splash" data-surface={surface}
        role={surface === 'recovery' ? 'dialog' : undefined}
        aria-label={surface === 'recovery' ? 'Desktop for Step Code 启动恢复' : undefined}
        aria-modal={surface === 'recovery' ? false : undefined}>
        <div className="scenario-window-bar" aria-hidden={surface === 'transparent'}>
          <span>Desktop for Step Code</span>
          {surface === 'recovery' && <button type="button" className="scenario-icon"
            title="退出演示" aria-label="退出演示" onClick={stop}><X size={15}/></button>}
        </div>
        <div className="scenario-logo-slot">
          <iframe className="scenario-logo" title="启动徽标" tabIndex={-1}
            src={`/startup-logo.html?material=${material}`} onLoad={event => observeSplash(event.currentTarget)}/>
        </div>
        <div className="scenario-message" aria-hidden={surface === 'transparent'}>
          <div role={failed || phase === 'timeout' ? 'alert' : 'status'} aria-live="polite" aria-atomic="true">
            <h1>{(failed || phase === 'timeout') && <TriangleAlert size={16}/>}
              {title}</h1>
            {detail && <p>{detail}</p>}
          </div>
          {(failed || phase === 'timeout') && <div className="scenario-actions">
            {phase === 'timeout' && <button type="button" onClick={() => {
              const now = performance.now() - startedAt.current;
              setElapsed(now); setContinuedAt(now);
            }}>
              <Hourglass size={15}/>继续等待</button>}
            <button type="button" className="scenario-primary" onClick={retry}>
              <RotateCcw size={15}/>重试启动</button>
          </div>}
          {(failed || phase === 'timeout') && <details className="scenario-diagnostic">
            <summary><FileText size={14}/>查看模拟诊断<ChevronDown size={14}/></summary>
            <pre>{diagnostic}</pre>
          </details>}
        </div>
      </div>}
      {shellReady && !shellFailed && <div className="scenario-ready"><Check size={14}/>启动完成 · 离线工作区</div>}
    </div>
    <footer className="scenario-run-footer">
      <div><span className="scenario-state-dot" data-state={failed || phase === 'timeout' ? 'warning' : shellReady ? 'ready' : 'waiting'}/>
        <span>{shellReady && !shellFailed ? '启动完成' : names[phase]}</span>
        <time>{(elapsed / 1000).toFixed(1)} s</time>
        {degraded && <span className="scenario-fallback-note">静态降级</span>}
      </div>
      <button className="scenario-icon" type="button" title="结束演示" aria-label="结束演示" onClick={stop}><Square size={15}/></button>
    </footer>
  </section>;
}

function StartupScenarios() {
  const [scenario, setScenario] = useState(() => previewScenario(new URLSearchParams(location.search).get('scenario')));
  const [material, setMaterial] = useState<Material>('stellar');
  const [desktop, setDesktop] = useState<Desktop>(() => {
    const value = new URLSearchParams(location.search).get('desktop');
    return value === 'dark' || value === 'busy' ? value : 'light';
  });
  const [take, setTake] = useState(0);
  const [recovery, setRecovery] = useState(false);
  const [stopped, setStopped] = useState(false);
  const replay = () => { setTake(value => value + 1); setRecovery(false); setStopped(false); };
  const select = (value: StartupScenario) => {
    setScenario(value); replay();
    const url = new URL(location.href);
    url.searchParams.set('scenario', value);
    history.replaceState(null, '', url);
  };
  return <main className="startup-scenarios">
    <header className="scenario-header">
      <a href="./startup-preview.html" className="scenario-icon" aria-label="返回纯动画预览" title="返回纯动画预览"><ArrowLeft size={18}/></a>
      <img src="/StepCode.svg" alt="" width="20" height="20"/>
      <span>启动场景</span><span className="scenario-simulation">模拟</span>
      <button type="button" className="scenario-icon scenario-replay" title="重播场景" aria-label="重播场景" onClick={replay}><RotateCcw size={17}/></button>
    </header>
    <div className="scenario-controls">
      <fieldset className="scenario-picker"><legend className="sr-only">启动场景</legend>
        {(Object.keys(startupScenarios) as StartupScenario[]).map(id => {
          const Icon = icons[id];
          return <label key={id}><input type="radio" name="scenario" checked={scenario === id} onChange={() => select(id)}/>
            <span><Icon size={16}/>{startupScenarios[id].label}</span></label>;
        })}
      </fieldset>
      <div className="scenario-view-options">
        <fieldset className="scenario-desktop-picker"><legend className="sr-only">桌面背景</legend>
          {desktops.map(({ id, name, Icon }) => <label key={id} title={name}>
            <input type="radio" name="desktop" aria-label={name} checked={desktop === id} onChange={() => {
              setDesktop(id);
              const url = new URL(location.href); url.searchParams.set('desktop', id); history.replaceState(null, '', url);
            }}/>
            <span><Icon size={16}/></span>
          </label>)}
        </fieldset>
        <fieldset className="scenario-material"><legend className="sr-only">徽标风格</legend>
          <label><input type="radio" name="material" checked={material === 'stellar'} onChange={() => { setMaterial('stellar'); replay(); }}/>
            <span><Sparkles size={14}/>星辰</span></label>
          <label><input type="radio" name="material" checked={material === 'default'} onChange={() => { setMaterial('default'); replay(); }}/>
            <span><SunMoon size={14}/>原版</span></label>
        </fieldset>
      </div>
    </div>
    {stopped ? <section className="scenario-stopped"><Square size={22}/><p>演示已停止</p>
      <button type="button" className="scenario-primary" onClick={replay}><Play size={15}/>重新演示</button></section>
      : <StartupScenarioRun key={`${scenario}-${material}-${take}`} scenario={recovery ? 'normal' : scenario}
        material={material} desktop={desktop} retry={() => { setRecovery(true); setTake(value => value + 1); }} stop={() => setStopped(true)}/>}
    <div className="scenario-scope"><span>{recovery ? '重试 · 正常恢复' : startupScenarios[scenario].label}</span>
      <span>模拟桌面与窗口，尚未接入正式启动</span></div>
  </main>;
}

createRoot(document.getElementById('root')!).render(<StartupScenarios />);
