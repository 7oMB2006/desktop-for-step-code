import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Play, Square, RotateCcw, SunMoon } from 'lucide-react';
import { Text } from '../../src/ConversationMessages';
import type { DesktopBridge } from '../../src/contracts';
import { applyTheme } from '../../src/theme';
import { markdownDeltas, streamingMarkdownCorpus, type MarkdownScenario } from './streaming-markdown-corpus';
import 'katex/dist/katex.min.css';
import '../../src/style.css';
import '../../src/layout.css';
import './streaming-markdown.css';

const params = new URLSearchParams(location.search);
let dark = params.get('theme') === 'dark';
applyTheme(dark ? 'original-dark' : 'original-light', false);
const errors: string[] = [];
const onError = (message: string) => { errors.push(message); };
const openImage = () => {};
window.desktop = { platform: 'win32', copyText: async text => { fixture.copied = text; } } as DesktopBridge;
let set: (value: { text: string; active: boolean }) => void;
let timer: ReturnType<typeof setInterval> | undefined;
let source = '';
const fixture = {
  done: true, updates: 0, workMs: [] as number[], copied: '', errors,
  step(text: string, active = true) {
    const start = performance.now();
    flushSync(() => set({ text, active }));
    this.workMs.push(performance.now() - start);
    this.updates++;
  },
  stop() { clearInterval(timer); timer = undefined; this.done = true; },
  reset() {
    this.stop(); this.updates = 0; this.workMs = []; this.copied = ''; source = '';
    flushSync(() => set({ text: '', active: false }));
  },
  start(kind: MarkdownScenario, interval = 40) {
    this.reset(); this.done = false;
    source = streamingMarkdownCorpus(kind);
    const parts = markdownDeltas(source);
    let index = 0;
    timer = setInterval(() => {
      if (index < parts.length) this.step(parts[index++]);
      else { this.step(source, false); this.stop(); }
    }, interval);
  },
  get source() { return source; },
};
declare global { interface Window { streamingFixture: typeof fixture } }
window.streamingFixture = fixture;
function App() {
  const [value, update] = useState({ text: '', active: false });
  const [kind, setKind] = useState<MarkdownScenario>('mixed');
  set = update;
  return <main className="streaming-fixture">
    <header>
      <strong>流式渲染</strong>
      <select aria-label="输出内容" value={kind} onChange={event => setKind(event.target.value as MarkdownScenario)}>
        <option value="prose">段落</option><option value="code">代码</option><option value="math">公式</option><option value="mixed">混合</option>
        <option value="single-paragraph">单段长文</option><option value="growing-code">单个代码块</option>
      </select>
      <button className="icon-button" aria-label="开始" title="开始" onClick={() => fixture.start(kind)}><Play size={16}/></button>
      <button className="icon-button" aria-label="停止" title="停止" onClick={() => { fixture.step(value.text, false); fixture.stop(); }}><Square size={15}/></button>
      <button className="icon-button" aria-label="清空" title="清空" onClick={() => fixture.reset()}><RotateCcw size={16}/></button>
      <button className="icon-button" aria-label="切换主题" title="切换主题" onClick={() => {
        dark = !dark; applyTheme(dark ? 'original-dark' : 'original-light', false);
      }}><SunMoon size={16}/></button>
    </header>
    <div className="conversation"><div className="messages"><article className="message assistant">
      <div className="message-body response-text" id="streaming-output"><Text text={value.text} streaming={value.active}
        language="zh" openImage={openImage} onError={onError}/></div>
    </article></div></div>
    {params.has('compare') && <div id="full-reference" hidden><Text text={value.text} language="zh" openImage={openImage} onError={onError}/></div>}
  </main>;
}
flushSync(() => createRoot(document.getElementById('root')!).render(<App/>));
if (params.get('demo') === '1') fixture.start('mixed');
