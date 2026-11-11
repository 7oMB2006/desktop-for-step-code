import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ModelEffortPicker } from '../../src/ModelEffortPicker';
import { AppTooltip } from '../../src/AppTooltip';
import type { Model } from '../../src/contracts';
import { changeFavoriteModel, normalizeFavoriteModels, type ModelIdentity } from '../../src/model-favorites';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/model-picker-list.css';

declare global {
  interface Window {
    effortCalls: string[];
    modelCalls: string[];
    modelPickerFixture: {
      configure: (value: { models?: Model[]; favorites?: ModelIdentity[]; language?: 'zh' | 'en'; favoriteFailure?: boolean }) => void;
    };
  }
}

window.effortCalls = [];
window.modelCalls = [];
const stepModel: Model = { id: 'step-5-preview', name: 'step-5-preview', provider: 'step', input: ['text', 'image'], contextWindow: 128000, maxTokens: 16384 };
const preview = /\/(?:recent-models|favorite-models)\.html$/.test(location.pathname);
const storageKey = 'dfsc-model-favorites-preview-v1';
const fixtureModels: Model[] = [stepModel, { id: 'step-4', name: 'step-4', provider: 'step' },
  { id: 'fixture-custom', name: 'Custom Model', provider: 'desktop-custom-fixture', providerName: 'Custom provider', input: ['text', 'image'], contextWindow: 200000, maxTokens: 16384 }];
// Illustrative names exercise density and provider identity, not live availability.
const previewModels: Model[] = [...fixtureModels, ...[
  ['deepseek-chat', 'DeepSeek Chat', 'deepseek', 'DeepSeek'],
  ['deepseek-reasoner', 'DeepSeek Reasoner', 'deepseek', 'DeepSeek'],
  ['qwen-coder', 'Qwen Coder', 'qwen', 'Qwen'],
  ['qwen-plus', 'Qwen Plus', 'qwen', 'Qwen'],
  ['qwen-turbo', 'Qwen Turbo', 'qwen', 'Qwen'],
  ['claude-sonnet', 'Claude Sonnet', 'anthropic', 'Anthropic'],
  ['claude-opus', 'Claude Opus', 'anthropic', 'Anthropic'],
  ['claude-haiku', 'Claude Haiku', 'anthropic', 'Anthropic'],
  ['gpt-5', 'GPT-5', 'openai', 'OpenAI'],
  ['gpt-5-mini', 'GPT-5 mini', 'openai', 'OpenAI'],
  ['gpt-5-nano', 'GPT-5 nano', 'openai', 'OpenAI'],
  ['gemini-pro', 'Gemini Pro', 'google', 'Google'],
  ['gemini-flash', 'Gemini Flash', 'google', 'Google'],
  ['gemini-flash-lite', 'Gemini Flash-Lite', 'google', 'Google'],
  ['team-step', 'step-5-preview', 'team', 'Team Gateway'],
  ['team-deepseek', 'DeepSeek Chat', 'team', 'Team Gateway'],
  ['team-code-review', 'Code Review - Extended Context', 'team', 'Team Gateway'],
  ['local-qwen', 'Qwen Coder', 'local', 'Local Runtime'],
  ['local-reasoning', 'Local Reasoning - 32B', 'local', 'Local Runtime'],
  ['local-coding', 'Local Coding - 14B', 'local', 'Local Runtime'],
  ['local-workspace', 'Workspace Assistant - Long Context', 'local', 'Local Runtime'],
].map(([id, name, provider, providerName]) => ({ id: `fixture-${id}`, name, provider: `desktop-custom-${provider}`, providerName }))];
function Harness() {
  const [level, setLevel] = useState('low');
  const [model, setModel] = useState<Model>(stepModel);
  const [favorites, setFavorites] = useState<ModelIdentity[]>(() => {
    if (!preview) return [];
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) return normalizeFavoriteModels(JSON.parse(saved));
    } catch { /* An unavailable fixture store must not block the preview. */ }
    return [{ provider: 'step', id: stepModel.id }];
  });
  const [favoriteFailure, setFavoriteFailure] = useState(false);
  const [language, setLanguage] = useState<'zh' | 'en'>('zh');
  const [models, setModels] = useState<Model[]>(() => preview ? previewModels : fixtureModels);
  window.modelPickerFixture = { configure: value => {
    if (value.models) setModels(value.models);
    if (value.favorites) setFavorites(value.favorites);
    if (value.language) setLanguage(value.language);
    if (value.favoriteFailure !== undefined) setFavoriteFailure(value.favoriteFailure);
  } };
  useEffect(() => {
    if (!preview) return;
    document.querySelector<HTMLButtonElement>('.model-effort-trigger')?.click();
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.model-effort-heading')?.click());
  }, []);
  return <div className="test-composer">
    <ModelEffortPicker model={model} models={models} favoriteModels={favorites} level={level} levels={model.thinkingLevels ?? ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']} language={language} disabled={false}
      onFavorite={async (model, favorite) => {
        if (favoriteFailure) throw new Error('fixture storage unavailable');
        const next = changeFavoriteModel(favorites, { ...model, favorite });
        if (preview) localStorage.setItem(storageKey, JSON.stringify(next));
        setFavorites(next);
      }}
      onModel={async next => {
        window.modelCalls.push(`${next.provider}/${next.id}`);
        const levels = next.thinkingLevels ?? ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
        if (!levels.includes(level)) setLevel(levels.at(-1) ?? 'off');
        setModel(next);
      }}
      onEffort={async next => { window.effortCalls.push(next); setLevel(next); }}/>
    <AppTooltip/>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
