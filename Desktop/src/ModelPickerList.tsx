import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronLeft, Search, Star, X } from 'lucide-react';
import type { Model } from './contracts';
import { modelKey, modelListGroups, normalizeFavoriteModels, type ModelIdentity } from './model-favorites';

export function ModelPickerList({ models, favoriteModels, selected, language, onSelect, onFavorite, onBack }: {
  models: Model[]; favoriteModels?: ModelIdentity[]; selected?: Model; language: 'zh' | 'en';
  onSelect: (model: Model) => Promise<unknown>;
  onFavorite?: (model: Model, favorite: boolean) => Promise<unknown>;
  onBack: () => void;
}) {
  const [query, setQuery] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [favoriteError, setFavoriteError] = useState(false);
  const saving = useRef(false);
  const restoreFavoriteFocus = useRef<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const zh = language === 'zh';
  const groups = modelListGroups(models, favoriteModels, query);
  const favoriteKeys = new Set(normalizeFavoriteModels(favoriteModels).map(modelKey));
  const searching = Boolean(query.trim());
  useLayoutEffect(() => {
    if (savingKey || !restoreFavoriteFocus.current) return;
    const row = [...(list.current?.querySelectorAll<HTMLElement>('.model-picker-row') ?? [])]
      .find(element => element.dataset.modelKey === restoreFavoriteFocus.current);
    row?.querySelector<HTMLButtonElement>('.model-picker-star')?.focus();
    restoreFavoriteFocus.current = null;
  }, [favoriteModels, savingKey]);
  const favorite = async (model: Model, value: boolean, button: HTMLButtonElement) => {
    if (!onFavorite || saving.current) return;
    const key = modelKey(model);
    const focused = document.activeElement === button;
    saving.current = true;
    setSavingKey(key);
    setFavoriteError(false);
    try { await onFavorite(model, value); }
    catch { setFavoriteError(true); }
    finally {
      if (focused && (document.activeElement === button || document.activeElement === document.body))
        restoreFavoriteFocus.current = key;
      saving.current = false;
      setSavingKey(null);
    }
  };
  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    const active = document.activeElement as HTMLElement | null;
    const row = active?.closest<HTMLElement>('.model-picker-row');
    if (row && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      const target = row.querySelector<HTMLButtonElement>(event.key === 'ArrowRight' ? '.model-picker-star' : '.model-picker-select');
      if (target) { event.preventDefault(); target.focus(); }
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const column = active?.classList.contains('model-picker-star') ? '.model-picker-star' : '.model-picker-select';
    const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(column)];
    if (!options.length) return;
    event.preventDefault();
    const current = options.indexOf(active as HTMLButtonElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
      : current < 0 ? event.key === 'ArrowDown' ? 0 : options.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    options[index].focus();
  };
  const option = (model: Model) => {
    const key = modelKey(model);
    const active = Boolean(selected && key === modelKey(selected));
    const starred = favoriteKeys.has(key);
    const identity = `${model.name || model.id} · ${model.providerName || model.provider}`;
    const action = starred ? zh ? '取消收藏' : 'Remove favorite' : zh ? '收藏模型' : 'Favorite model';
    return <div className={`model-picker-row${active ? ' is-selected' : ''}`} key={key} data-model-key={key}>
      <button type="button" className="model-picker-select" aria-pressed={active}
        title={identity} onClick={() => void onSelect(model)}>
        <span className="model-picker-identity"><span>{model.name || model.id}</span>
          <small>{model.providerName || model.provider}</small></span>
        <span className="model-picker-check" aria-hidden="true">{active && <Check size={14}/>}</span>
      </button>
      {onFavorite && <button type="button" className={`model-picker-star${starred ? ' is-favorite' : ''}`}
        aria-label={`${action}: ${identity}`} data-tooltip={action} aria-pressed={starred}
        aria-disabled={Boolean(savingKey)} aria-busy={savingKey === key}
        onClick={event => void favorite(model, !starred, event.currentTarget)}>
        <Star size={14} fill={starred ? 'currentColor' : 'none'} aria-hidden="true"/>
      </button>}
    </div>;
  };
  return <>
    <div className="model-picker-toolbar">
      <button type="button" className="icon-button model-picker-back" onClick={onBack}
        aria-label={zh ? '返回思考强度' : 'Back to thinking level'}
        data-tooltip={zh ? '返回思考强度' : 'Back to thinking level'}><ChevronLeft size={16} aria-hidden="true"/></button>
      <div className="model-picker-search">
        <Search size={14} aria-hidden="true"/>
        <input type="search" value={query} aria-label={zh ? '搜索模型' : 'Search models'} aria-controls={listId}
          placeholder={zh ? '搜索模型' : 'Search models'} onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            if (event.key === 'ArrowDown') {
              list.current?.querySelector<HTMLButtonElement>('.model-picker-select')?.focus();
              event.preventDefault();
            }
          }}/>
        {query && <button type="button" className="icon-button" aria-label={zh ? '清空搜索' : 'Clear search'}
          title={zh ? '清空搜索' : 'Clear search'} onClick={event => {
            setQuery('');
            event.currentTarget.parentElement?.querySelector('input')?.focus();
          }}><X size={13}/></button>}
      </div>
    </div>
    <div ref={list} id={listId} className="model-effort-list model-picker-list" role="group"
      aria-label={zh ? '模型' : 'Models'} onKeyDown={onListKey}>
      {groups.favorites.length > 0 && <div role="group" aria-label={zh ? '已收藏' : 'Favorites'}>
        <div className="model-picker-section" aria-hidden="true">{zh ? '已收藏' : 'Favorites'}</div>
        {groups.favorites.map(option)}
      </div>}
      {groups.available.length > 0 && <div role="group" aria-label={searching ? zh ? '搜索结果' : 'Search results'
        : groups.favorites.length ? zh ? '其他模型' : 'Other models' : zh ? '全部模型' : 'All models'}>
        {!searching && groups.favorites.length > 0 && <div className="model-picker-section" aria-hidden="true">{zh ? '其他模型' : 'Other models'}</div>}
        {groups.available.map(option)}
      </div>}
      {!groups.favorites.length && !groups.available.length && <p className="model-picker-empty" role="status">
        {searching ? zh ? '没有匹配的模型' : 'No matching models' : zh ? '暂无可用模型' : 'No models available'}
      </p>}
    </div>
    {favoriteError && <p className="model-picker-error" role="alert">{zh ? '收藏未保存，请重试' : 'Favorite not saved. Try again.'}</p>}
  </>;
}
