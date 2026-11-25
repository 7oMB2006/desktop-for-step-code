import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Accessibility, FlaskConical, Repeat2, RotateCcw, ZoomIn } from 'lucide-react';
import { STARTUP_SETTLE_MS, STARTUP_STELLAR_MS } from '../../src/startup-motion';
import './startup-preview.css';

function StartupPreview() {
  const [take, setTake] = useState(0);
  const [loop, setLoop] = useState(true);
  const [still, setStill] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [backdrop, setBackdrop] = useState('graphite');
  useEffect(() => {
    if (!loop || still) return;
    const timer = setTimeout(() => setTake(value => value + 1), STARTUP_STELLAR_MS + STARTUP_SETTLE_MS + 1600);
    return () => clearTimeout(timer);
  }, [loop, still, take]);
  return <main className="startup-preview" data-backdrop={backdrop}>
    <header><img src="/StepCode.svg" alt="" /><span>星辰巡航</span>
      <a className="preview-scenarios-link" href="./startup-scenarios.html"><FlaskConical size={15}/>启动场景</a>
    </header>
    <div className="startup-preview-stage" data-zoom={zoom}>
      <iframe key={`${take}-${still}`} title="启动动画"
        src={`/startup-logo.html?material=stellar&motion=${still ? 'off' : 'on'}`} />
    </div>
    <footer>
      <div className="preview-tools" role="group" aria-label="播放">
        <button type="button" title="重播" aria-label="重播" onClick={() => setTake(value => value + 1)}><RotateCcw size={18} /></button>
        <button type="button" title="循环播放" aria-label="循环播放" aria-pressed={loop} onClick={() => setLoop(value => !value)}><Repeat2 size={18} /></button>
        <button type="button" title="静止预览" aria-label="静止预览" aria-pressed={still} onClick={() => setStill(value => !value)}><Accessibility size={18} /></button>
        <button type="button" title="放大预览" aria-label="放大预览" aria-pressed={zoom} onClick={() => setZoom(value => !value)}><ZoomIn size={18} /></button>
      </div>
      <div className="preview-swatches" role="group" aria-label="背景">
        {(['graphite', 'black', 'light'] as const).map(color =>
          <button type="button" key={color} className={`swatch swatch-${color}`}
            title={{ graphite: '石墨背景', black: '纯黑背景', light: '浅色背景' }[color]}
            aria-label={{ graphite: '石墨背景', black: '纯黑背景', light: '浅色背景' }[color]}
            aria-pressed={backdrop === color} onClick={() => setBackdrop(color)} />)}
      </div>
    </footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<StartupPreview />);
