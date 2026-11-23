import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, KeyRound, Plus, Terminal } from 'lucide-react';
import { DisclosureChevron } from './DisclosureChevron';
import { ProviderPresetMark } from './ProviderBrand';
import { providerBillingLabels, providerPresetDraft, providerPresets, type ProviderBrandId } from './provider-presets';
import type { ProviderInfo } from './contracts';

const brands = [...new Set(providerPresets.map(p => p.brand))].map(id => ({ id, presets: providerPresets.filter(p => p.brand === id) }));
const brandRows = Array.from({ length: Math.ceil(brands.length / 2) }, (_, i) => brands.slice(i * 2, i * 2 + 2));
const brandHeadings: Partial<Record<ProviderBrandId, { name?: string; summary: readonly [string, string] }>> = {
  kimi: { name: 'Kimi', summary: ['开放平台 / Kimi Code', 'Open Platform / Kimi Code'] },
  bailian: { summary: ['按量 API / Token Plan', 'Pay as you go / Token Plan'] },
  minimax: { summary: ['按量 API / M Plan', 'Pay as you go / M Plan'] },
};

export function ProviderPresetPicker({ language, returnBrand, onBack, onSelect, onCustom }: {
  language: string; returnBrand?: ProviderBrandId; onBack: () => void;
  onSelect: (draft: ProviderInfo) => void; onCustom: () => void;
}) {
  const labels = language === 'en' ? 1 : 0;
  const [expanded, setExpanded] = useState<ProviderBrandId | undefined>(() =>
    brands.some(brand => brand.id === returnBrand && brand.presets.length > 1) ? returnBrand : undefined);
  const panelId = useId();
  const pane = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const initialBrand = useRef(returnBrand);
  useEffect(() => {
    const id = initialBrand.current;
    (id ? pane.current?.querySelector<HTMLButtonElement>(`[data-preset-brand="${id}"]`) : heading.current)?.focus();
  }, []);
  return <section ref={pane} className="provider-preset-picker" aria-labelledby={panelId} onKeyDown={event => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
    event.stopPropagation();
    if (!expanded) { onBack(); return; }
    pane.current?.querySelector<HTMLButtonElement>(`[data-preset-brand="${expanded}"]`)?.focus();
    setExpanded(undefined);
  }}>
    <div className="provider-preset-heading">
      <button type="button" className="icon-button" title={labels ? 'Back' : '返回'} aria-label={labels ? 'Back' : '返回'} onClick={onBack}><ArrowLeft size={16} aria-hidden="true"/></button>
      <h4 id={panelId} tabIndex={-1} ref={heading}>{labels ? 'Add provider' : '添加供应商'}</h4>
      <button type="button" onClick={onCustom}><Plus size={15} aria-hidden="true"/>{labels ? 'Create custom provider' : '创建自定义供应商'}</button>
    </div>
    <h5 className="provider-preset-section-label">{labels ? 'Popular providers' : '常用供应商'}</h5>
    <div className="provider-preset-grid">
      {brandRows.map(row => <div key={row[0].id} className="provider-preset-row">
        {row.map(({ id, presets }) => {
          const expandable = presets.length > 1;
          const open = expandable && expanded === id;
          const regionId = `${panelId}-${id}`;
          const heading = brandHeadings[id];
          return <Fragment key={id}>
            <button data-preset-brand={id} type="button" className="provider-preset-tile" aria-expanded={expandable ? open : undefined}
              aria-controls={expandable ? regionId : undefined} onClick={() => expandable
                ? setExpanded(open ? undefined : id) : onSelect(providerPresetDraft(presets[0], language))}>
              <ProviderPresetMark brand={id} size={28}/>
              <span className="provider-preset-label"><strong id={`${regionId}-name`}>{heading?.name ?? presets[0].name[labels]}</strong><small>{heading?.summary[labels] ?? presets[0].label[labels]}</small></span>
              <DisclosureChevron/>
            </button>
            {expandable && <div id={regionId} className="provider-preset-variants" role="group" aria-labelledby={`${regionId}-name`} inert={!open} aria-hidden={!open}>
              <div className="provider-preset-variants-clip"><div className="provider-preset-variants-list">
                {presets.map(preset => {
                  const Icon = preset.billing === 'usage' ? KeyRound : Terminal;
                  return <button type="button" key={preset.id} className="provider-preset-variant" onClick={() => onSelect(providerPresetDraft(preset, language))}>
                    <Icon size={15} aria-hidden="true"/>
                    <span className="provider-preset-label"><strong>{preset.name[labels]}</strong><small>{preset.label[labels]}</small></span>
                    <span className="provider-preset-kind">{providerBillingLabels[preset.billing][labels]}</span>
                    <DisclosureChevron/>
                  </button>;
                })}
              </div></div>
            </div>}
          </Fragment>;
        })}
      </div>)}
    </div>
  </section>;
}
