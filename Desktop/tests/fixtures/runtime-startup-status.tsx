import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { RuntimeStartupStatus } from '../../src/RuntimeStartupStatus';
import { SidebarTaskActions } from '../../src/ScheduledTasks';
import { AppTooltip } from '../../src/AppTooltip';
import { startupNeedsAttention, type RuntimeStartup } from '../../src/runtime-startup';
import '../../src/style.css';
import '../../src/session-navigation.css';

type Mode = 'connecting' | 'failed' | 'cleanup' | 'discovery' | 'ready';
declare global {
  interface Window {
    toolStatusFixture: {
      configure(mode: Mode, language?: 'zh' | 'en', disabled?: boolean): void;
      reconnects: number; settings: number;
    };
  }
}
function Harness() {
  const [mode, setMode] = useState<Mode>('connecting');
  const [language, setLanguage] = useState<'zh' | 'en'>('en');
  const [disabled, setDisabled] = useState(false);
  const [plugins, setPlugins] = useState(false);
  window.toolStatusFixture ??= { configure() {}, reconnects: 0, settings: 0 };
  window.toolStatusFixture.configure = (next, lang = 'en', locked = false) => {
    flushSync(() => { setMode(next); setLanguage(lang); setDisabled(locked); });
  };
  const state = {
    cleanupConfirmed: mode !== 'cleanup', discovery: mode === 'discovery' ? 'failed' : 'ready',
    targetBound: true, modelReady: true,
    tools: [{
      name: 'bilibili-video-research__bvr_with_an_intentionally_long_server_name',
      status: mode === 'connecting' ? 'connecting' : mode === 'ready' ? 'connected' : 'failed',
      toolCount: 0, startedAt: Date.now() - 2000,
    }],
  } as RuntimeStartup;
  return <><AppTooltip/><div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', padding: 16, gap: 16 }}>
    <div style={{ width: 244, maxWidth: '100%' }}>
      <SidebarTaskActions selected={false} pluginsSelected={plugins} pluginsAttention={startupNeedsAttention(state)}
        language={language} onNewSession={() => setPlugins(false)} onScheduledTasks={() => {}}
        onPlugins={() => setPlugins(value => !value)}/>
    </div>
    {plugins ? <section id="plugins" style={{ minWidth: 0, overflow: 'auto' }}>
      <RuntimeStartupStatus state={state} language={language} disabled={disabled}
        reconnect={() => window.toolStatusFixture.reconnects++}
        settings={() => window.toolStatusFixture.settings++}/>
    </section> : <main id="transcript" style={{ flex: 1 }}>
      <article style={{ flex: 1 }}>Conversation history</article>
      <div className="composer-tools"><button id="send">Send</button></div>
    </main>}
  </div></>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
