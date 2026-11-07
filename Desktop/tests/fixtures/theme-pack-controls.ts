import type { Model } from '../../src/contracts';
import type { ComposerCommand } from '../../src/composer-commands';

export function themeControlModels(): Model[] {
  return [
    { provider: 'fixture', id: 'offline', name: 'Step · 离线样例', providerName: '本地演示',
      reasoning: true, thinkingLevels: ['low', 'medium', 'high'], input: ['text', 'image'],
      declaredInput: ['text', 'image', 'audio'], declaredOutput: ['text'],
      contextWindow: 256000, maxTokens: 16384 },
    { provider: 'fixture', id: 'seven-levels', name: '七档思考 · 离线样例', providerName: '本地演示',
      reasoning: true, thinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
      input: ['text', 'image'], contextWindow: 128000, maxTokens: 8192 },
    { provider: 'fixture', id: 'service-default', name: '服务默认 · 离线样例', providerName: '本地演示',
      reasoning: true, thinkingServiceDefault: true, input: ['text'], declaredOutput: ['text', 'image'],
      contextWindow: 200000, metadataSource: 'upstream' },
    { provider: 'fixture', id: 'unconfirmed', name: '能力未确认的长模型名称 · 离线样例', providerName: '本地演示' },
  ];
}

export function themeControlCommands(): ComposerCommand[] {
  return [
    { name: 'permissions', source: 'extension', description: '权限' },
    { name: 'plan', source: 'extension' }, { name: 'todos', source: 'extension' },
    { name: 'usage', source: 'extension' }, { name: 'workflows', source: 'extension' },
    { name: 'review-layout', source: 'prompt', description: '检查布局与信息层级 · 离线模板' },
    { name: 'check-focus', source: 'skill', description: '检查键盘焦点与窄窗口 · 离线技能' },
  ];
}

export function selectThemeControlModel(models: Model[], args?: Record<string, unknown>) {
  const model = models.find(item => item.id === args?.modelId && item.provider === args?.provider);
  if (!model) throw new Error('离线样例模型不存在');
  return { model, thinkingLevel: model.thinkingLevels?.includes('medium') ? 'medium' : model.thinkingLevels?.[0] };
}
