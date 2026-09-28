import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ModelEffortPicker } from '../../src/ModelEffortPicker';
import '../../src/style.css';
import '../../src/layout.css';

declare global {
  interface Window { effortCalls: string[] }
}

window.effortCalls = [];
function Harness() {
  const [level, setLevel] = useState('low');
  const [model, setModel] = useState({ id: 'step-5-preview', name: 'step-5-preview', provider: 'step' });
  return <div className="test-composer">
    <ModelEffortPicker model={model} models={[model, { id: 'step-4', name: 'step-4', provider: 'step' }]} level={level} levels={['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']} language="zh" disabled={false}
      onModel={async next => { setModel(next); }}
      onEffort={async next => { window.effortCalls.push(next); setLevel(next); }}/>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
