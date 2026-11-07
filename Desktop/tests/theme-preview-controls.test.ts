import test from 'node:test';
import assert from 'node:assert/strict';
import { themeControlCommands, themeControlModels, selectThemeControlModel } from './fixtures/theme-pack-controls';

test('offline model selection validates provider and preserves unknown capabilities', () => {
  const models = themeControlModels();
  assert.throws(() => selectThemeControlModel(models, { modelId: 'offline', provider: 'other' }));
  assert.throws(() => selectThemeControlModel(models));
  const seven = selectThemeControlModel(models, { modelId: 'seven-levels', provider: 'fixture' });
  assert.equal(seven.model.thinkingLevels?.length, 7);
  assert.equal(seven.thinkingLevel, 'medium');
  const unknown = selectThemeControlModel(models, { modelId: 'unconfirmed', provider: 'fixture' });
  assert.equal(unknown.thinkingLevel, undefined);
  assert.equal(unknown.model.contextWindow, undefined);
  assert.equal(unknown.model.input, undefined);
  models[0].name = 'changed';
  assert.notEqual(themeControlModels()[0].name, 'changed');
});

test('offline commands cover all actual menu groups without executable content', () => {
  const commands = themeControlCommands();
  assert.deepEqual([...new Set(commands.map(item => item.source))], ['extension', 'prompt', 'skill']);
  assert.equal(new Set(commands.map(item => item.name)).size, commands.length);
  assert.ok(commands.every(item => Object.keys(item).every(key => ['name', 'source', 'description'].includes(key))));
});
