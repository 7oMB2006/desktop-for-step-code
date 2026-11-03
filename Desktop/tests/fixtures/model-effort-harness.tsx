import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ModelEffortPicker } from '../../src/ModelEffortPicker';
import type { Model } from '../../src/contracts';
import { rememberRecentModel, type RecentModel } from '../../src/recent-models';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/model-picker-list.css';

declare global {
  interface Window {
    effortCalls: string[];
    modelPickerFixture: {
      configure: (value: { models?: Model[]; recent?: RecentModel[]; language?: 'zh' | 'en' }) => void;
    };
  }
}

window.effortCalls = [];
const stepModel: Model = { id: 'step-5-preview', name: 'step-5-preview', provider: 'step', input: ['text', 'image'], contextWindow: 128000, maxTokens: 16384 };
const preview = location.pathname.endsWith('/recent-models.html');
function Harness() {
  const [level, setLevel] = useState('low');
  const [model, setModel] = useState<Model>(stepModel);
  const [recent, setRecent] = useState<RecentModel[]>(preview
    ? [{ provider: 'step', id: stepModel.id }, { provider: 'desktop-custom-fixture', id: 'fixture-custom' }] : []);
  const [language, setLanguage] = useState<'zh' | 'en'>('zh');
  const [models, setModels] = useState<Model[]>([stepModel, { id: 'step-4', name: 'step-4', provider: 'step' },
    { id: 'fixture-custom', name: 'Custom Model', provider: 'desktop-custom-fixture', providerName: 'Custom provider', input: ['text', 'image'], contextWindow: 200000, maxTokens: 16384 }]);
  window.modelPickerFixture = { configure: value => {
    if (value.models) setModels(value.models);
    if (value.recent) setRecent(value.recent);
    if (value.language) setLanguage(value.language);
  } };
  useEffect(() => {
    if (!preview) return;
    document.querySelector<HTMLButtonElement>('.model-effort-trigger')?.click();
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.model-effort-heading')?.click());
  }, []);
  return <div className="test-composer">
    <ModelEffortPicker model={model} models={models} recentModels={recent} level={level} levels={['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']} language={language} disabled={false}
      onModel={async next => { setModel(next); setRecent(previous => rememberRecentModel(previous, next)); }}
      onEffort={async next => { window.effortCalls.push(next); setLevel(next); }}/>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
