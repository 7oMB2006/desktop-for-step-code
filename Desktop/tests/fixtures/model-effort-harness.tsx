import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ModelEffortPicker } from '../../src/ModelEffortPicker';
import type { Model } from '../../src/contracts';
import '../../src/style.css';
import '../../src/layout.css';

declare global {
  interface Window { effortCalls: string[] }
}

window.effortCalls = [];
const stepModel: Model = { id: 'step-5-preview', name: 'step-5-preview', provider: 'step', input: ['text', 'image'], contextWindow: 128000, maxTokens: 16384 };
function Harness() {
  const [level, setLevel] = useState('low');
  const [model, setModel] = useState<Model>(stepModel);
  return <div className="test-composer">
    <ModelEffortPicker model={model} models={[stepModel, { id: 'step-4', name: 'step-4', provider: 'step' }, { id: 'fixture-custom', name: 'Custom Model', provider: 'desktop-custom-fixture', providerName: 'Custom provider', input: ['text', 'image'], contextWindow: 200000, maxTokens: 16384 }]} level={level} levels={['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']} language="zh" disabled={false}
      onModel={async next => { setModel(next); }}
      onEffort={async next => { window.effortCalls.push(next); setLevel(next); }}/>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
