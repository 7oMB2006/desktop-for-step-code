import { useId, useState, type KeyboardEvent } from 'react';
import { Check, Search, X } from 'lucide-react';
import type { Model } from './contracts';
import { modelKey, modelListGroups, type RecentModel } from './recent-models';

export function ModelPickerList({ models, recentModels, selected, language, onSelect }: {
  models: Model[]; recentModels?: RecentModel[]; selected?: Model; language: 'zh' | 'en';
  onSelect: (model: Model) => Promise<unknown>;
}) {
  const [query, setQuery] = useState('');
  const listId = useId();
  const zh = language === 'zh';
  const groups = modelListGroups(models, recentModels, query);
  const searching = Boolean(query.trim());
  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]')];
    if (!options.length) return;
    event.preventDefault();
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
      : current < 0 ? event.key === 'ArrowDown' ? 0 : options.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    options[index].focus();
  };
  const option = (model: Model) => {
    const active = Boolean(selected && modelKey(model) === modelKey(selected));
    return <button type="button" role="option" aria-selected={active} key={modelKey(model)}
      title={`${model.name || model.id} · ${model.providerName || model.provider}`}
      onClick={() => void onSelect(model)}>
      <span className="model-picker-identity"><span>{model.name || model.id}</span>
        <small>{model.providerName || model.provider}</small></span>
      {active && <Check size={15} aria-hidden="true"/>}
    </button>;
  };
  return <>
    <div className="model-picker-search">
      <Search size={14} aria-hidden="true"/>
      <input type="search" value={query} aria-label={zh ? '搜索模型' : 'Search models'} aria-controls={listId}
        placeholder={zh ? '搜索模型' : 'Search models'} onChange={event => setQuery(event.target.value)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          if (event.key === 'ArrowDown') {
            document.getElementById(listId)?.querySelector<HTMLButtonElement>('[role="option"]')?.focus();
            event.preventDefault();
          }
        }}/>
      {query && <button type="button" className="icon-button" aria-label={zh ? '清空搜索' : 'Clear search'}
        title={zh ? '清空搜索' : 'Clear search'} onClick={event => {
          setQuery('');
          event.currentTarget.parentElement?.querySelector('input')?.focus();
        }}><X size={13}/></button>}
    </div>
    <div id={listId} className="model-effort-list model-picker-list" role="listbox"
      aria-label={zh ? '模型' : 'Models'} onKeyDown={onListKey}>
      {groups.recent.length > 0 && <div role="group" aria-label={zh ? '最近使用' : 'Recently used'}>
        <div className="model-picker-section" aria-hidden="true">{zh ? '最近使用' : 'Recently used'}</div>
        {groups.recent.map(option)}
      </div>}
      {groups.available.length > 0 && <div role="group" aria-label={searching ? zh ? '搜索结果' : 'Search results' : zh ? '其他模型' : 'Other models'}>
        {!searching && groups.recent.length > 0 && <div className="model-picker-section" aria-hidden="true">{zh ? '其他模型' : 'Other models'}</div>}
        {groups.available.map(option)}
      </div>}
      {!groups.recent.length && !groups.available.length && <p className="model-picker-empty" role="status">
        {searching ? zh ? '没有匹配的模型' : 'No matching models' : zh ? '暂无可用模型' : 'No models available'}
      </p>}
    </div>
  </>;
}
