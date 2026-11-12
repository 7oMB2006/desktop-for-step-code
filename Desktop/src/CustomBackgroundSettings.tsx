import { useEffect, useId, useRef, useState } from 'react';
import { Check, ImageOff, ImagePlus, LoaderCircle, RotateCcw, Trash2 } from 'lucide-react';
import type { DesktopBridge } from './contracts';
import { DEFAULT_BACKGROUND_OPTIONS, type BackgroundOptions, type CustomBackgroundState } from './custom-background';
import { hasStellarUi, resolveThemeBackground, type ThemeImage, type ThemePack } from './theme-packs';
import './custom-background-settings.css';

export interface CustomBackgroundBridge {
  customBackgroundState(): Promise<CustomBackgroundState>;
  customBackgroundImage(revision: string): Promise<ThemeImage>;
  customBackgroundImport(ref: string): Promise<CustomBackgroundState | null>;
  customBackgroundSave(input: { ref: string; patch: Partial<BackgroundOptions> }): Promise<CustomBackgroundState>;
  customBackgroundRemove(ref: string): Promise<CustomBackgroundState>;
  onEvent?: DesktopBridge['onEvent'];
}

function difference(value: BackgroundOptions, saved: BackgroundOptions): Partial<BackgroundOptions> {
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => item !== saved[key as keyof BackgroundOptions]));
}

export function CustomBackgroundSettings({ bridge, packageRef, language, visible, busy = false, themePack, onChanged, onPending }: {
  bridge: CustomBackgroundBridge; packageRef: string; language: string; visible: boolean; busy?: boolean; themePack?: ThemePack;
  onChanged?(state: CustomBackgroundState): void; onPending?(pending: boolean): void;
}) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const id = useId();
  const [state, setState] = useState<CustomBackgroundState>();
  const [options, setOptions] = useState<BackgroundOptions>({ ...DEFAULT_BACKGROUND_OPTIONS });
  const [image, setImage] = useState<ThemeImage>();
  const [imageFailed, setImageFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [failureAction, setFailureAction] = useState<'load' | 'import' | 'save' | 'remove'>();
  const [saved, setSaved] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const current = useRef(state), draft = useRef(options);
  const operation = useRef<{ generation: number } | undefined>(undefined), alive = useRef(false), generation = useRef(0);
  const callbacks = useRef({ onChanged, onPending });
  const focusAfterSave = useRef<HTMLElement | null>(null);
  const removeDialog = useRef<HTMLDialogElement>(null), removeTrigger = useRef<HTMLButtonElement>(null);
  callbacks.current = { onChanged, onPending };
  const install = (value: CustomBackgroundState) => {
    current.current = value; draft.current = { ...value.options };
    setState(value); setOptions(draft.current);
    callbacks.current.onChanged?.(value);
  };
  const reportError = (failure: unknown, action: 'load' | 'import' | 'save' | 'remove') => {
    const message = failure instanceof Error ? failure.message : '';
    setError(/too-large|image-size|image-dimensions/.test(message) ? t('图片过大，请选择较小的图片。', 'The image is too large. Choose a smaller image.')
      : /invalid-image|unsupported|invalid-format/.test(message) ? t('无法读取这张图片，请选择 PNG 或 JPEG。', 'This image could not be read. Choose PNG or JPEG.')
        : /stale|not-available|not-installed/.test(message) ? t('插件状态已变化，请重新读取后再试。', 'The plugin changed. Reload its settings and retry.')
          : action === 'load' ? t('无法读取背景设置。', 'Could not read background settings.')
            : action === 'import' ? t('未能导入图片，原背景保持不变。', 'The image was not imported. The previous background is unchanged.')
              : action === 'remove' ? t('未能删除图片。', 'The image was not removed.')
                : t('保存未确认，当前调节仍保留。', 'Save was not confirmed. Your adjustments are retained.'));
  };
  const perform = async (action: 'load' | 'import' | 'save' | 'remove', request: () => Promise<CustomBackgroundState | null>) => {
    if (operation.current || busy) return;
    const requestGeneration = generation.current;
    const owner = { generation: requestGeneration };
    operation.current = owner; setPending(true); callbacks.current.onPending?.(true);
    setError(''); setFailureAction(undefined); setSaved(false);
    const focused = document.activeElement;
    focusAfterSave.current = focused instanceof HTMLElement && focused.closest('.custom-background-settings') ? focused : null;
    try {
      const value = await request();
      if (!alive.current || generation.current !== requestGeneration) return;
      if (value) { install(value); setSaved(action !== 'load'); }
    } catch (failure) {
      if (alive.current && generation.current === requestGeneration) { setFailureAction(action); reportError(failure, action); }
    } finally {
      if (operation.current === owner) {
        operation.current = undefined;
        if (alive.current && generation.current === requestGeneration) {
          setPending(false); callbacks.current.onPending?.(false);
        }
      }
    }
  };
  const read = () => perform('load', () => bridge.customBackgroundState());
  useEffect(() => {
    generation.current++; alive.current = true; operation.current = undefined; current.current = undefined;
    draft.current = { ...DEFAULT_BACKGROUND_OPTIONS }; focusAfterSave.current = null;
    setState(undefined); setOptions(draft.current); setPending(false); setError(''); setFailureAction(undefined);
    setSaved(false); setConfirmRemove(false); void read();
    return () => {
      alive.current = false; generation.current++; operation.current = undefined; callbacks.current.onPending?.(false);
    };
  }, [bridge, packageRef]);
  useEffect(() => {
    if (visible && !state && !pending && !error && !busy) void read();
  }, [visible, state, pending, error, busy]);
  useEffect(() => {
    if (pending) return;
    const control = focusAfterSave.current; focusAfterSave.current = null;
    if (control?.isConnected && !control.matches(':disabled') && document.activeElement === document.body)
      control.focus({ preventScroll: true });
  }, [pending]);
  useEffect(() => bridge.onEvent?.(event => {
    if (event.type === 'desktop_custom_background' && event.state && !operation.current) {
      install(event.state as CustomBackgroundState); setSaved(false);
    }
  }), [bridge]);
  const revision = state?.image?.revision;
  useEffect(() => {
    let valid = true;
    setImage(undefined); setImageFailed(false);
    if (revision) void bridge.customBackgroundImage(revision).then(value => {
      if (valid) setImage(value);
    }).catch(() => { if (valid) setImageFailed(true); });
    return () => { valid = false; };
  }, [bridge, revision]);
  useEffect(() => {
    if (confirmRemove && visible) removeDialog.current?.showModal();
    else if (removeDialog.current?.open) {
      removeDialog.current.close(); removeTrigger.current?.focus({ preventScroll: true });
    }
  }, [confirmRemove, visible]);
  useEffect(() => { if (!visible) setConfirmRemove(false); }, [visible]);
  const stage = (patch: Partial<BackgroundOptions>) => {
    draft.current = { ...draft.current, ...patch }; setOptions(draft.current); setSaved(false);
  };
  const commit = (patch?: Partial<BackgroundOptions>) => {
    const value = current.current;
    if (!value?.available || !value.ref || operation.current || busy) return;
    if (patch) stage(patch);
    const changed = difference(draft.current, value.options);
    if (Object.keys(changed).length) void perform('save', () => bridge.customBackgroundSave({ ref: value.ref!, patch: changed }));
  };
  const locked = busy || pending || !state?.available;
  const blocked = Boolean(options.enabled && state?.image && themePack && resolveThemeBackground(themePack, 'image-v1').blocked);
  const hasImage = Boolean(state?.image);
  const slider = (key: Exclude<keyof BackgroundOptions, 'enabled' | 'fit'>, label: string, min: number, max: number, unit: string) =>
    <label className="custom-background-slider" key={key} htmlFor={`${id}-${key}`}>
      <span><span>{label}</span><output>{options[key]}{unit}</output></span>
      <input id={`${id}-${key}`} type="range" min={min} max={max} step={1} value={options[key]} aria-valuetext={`${options[key]}${unit}`}
        onChange={event => stage({ [key]: Number(event.target.value) })}
        onPointerUp={() => commit()} onPointerCancel={() => commit()} onBlur={() => commit()}
        onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) commit(); }}/>
    </label>;
  return <section className="custom-background-settings" hidden={!visible} aria-label={t('自定义背景设置', 'Custom background settings')}>
    {!state ? <div className="custom-background-feedback" role={error ? 'alert' : 'status'}>
      <span>{error || t('正在读取背景…', 'Loading background…')}</span>
      {error && <button type="button" disabled={pending || busy} onClick={() => void read()}>{t('重新读取', 'Reload')}</button>}
    </div> : <>
      <div className="custom-background-heading">
        <h3>{t('本机图片', 'Local image')}</h3>
        <label className="custom-background-enabled"><span>{t('启用背景', 'Enable background')}</span>
          <input type="checkbox" checked={options.enabled} disabled={locked || !hasImage}
            onChange={event => commit({ enabled: event.target.checked })}/></label>
      </div>
      <div className="custom-background-preview" aria-label={t('背景预览', 'Background preview')}>
        {image && !imageFailed ? <img src={image.dataUrl} alt="" draggable={false} onError={() => setImageFailed(true)}
          style={{ objectFit: options.fit, objectPosition: `${options.positionX}% ${options.positionY}%`, transform: `scale(${options.zoom / 100})`,
            transformOrigin: `${options.positionX}% ${options.positionY}%`,
            filter: `brightness(${options.brightness / 100}) blur(${options.blur}px)` }}/>
          : <div className="custom-background-empty"><ImageOff size={24}/><span>{imageFailed ? t('图片暂不可用', 'Image unavailable')
            : hasImage ? t('正在读取图片…', 'Loading image…') : t('尚未选择图片', 'No image selected')}</span></div>}
      </div>
      <div className="custom-background-image-row">
        <span className="custom-background-dimensions">{state.image ? `${state.image.width} × ${state.image.height}` : 'PNG / JPEG'}</span>
        <div><button type="button" className="icon-button" disabled={locked} aria-label={t('导入背景图片', 'Import background image')}
          data-tooltip={t('导入背景图片', 'Import background image')}
          onClick={() => void perform('import', () => bridge.customBackgroundImport(state.ref ?? packageRef))}><ImagePlus size={17}/></button>
          <button ref={removeTrigger} type="button" className="icon-button" disabled={locked || !hasImage} aria-label={t('删除背景图片', 'Delete background image')}
            data-tooltip={t('删除背景图片', 'Delete background image')} onClick={() => setConfirmRemove(true)}><Trash2 size={16}/></button></div>
      </div>
      <div className="custom-background-status" role="status">
        {!state.available ? t('插件当前不可用。', 'The plugin is unavailable.')
          : blocked ? t('当前主题不接受替换，图片和调节已保留。', 'This theme does not accept a replacement. Your image and adjustments are kept.')
            : state.issue === 'storage' ? t('本机背景存储暂不可用。', 'Local background storage is unavailable.')
              : state.issue || imageFailed ? t('图片不可用，请重新导入。', 'The image is unavailable. Import it again.')
                : options.enabled && hasImage ? <><Check size={13}/>{t('正在使用', 'Active')}</>
                  : hasImage ? t('跟随主题，已保留本机图片。', 'Following the theme. Your local image is kept.') : ''}
      </div>
      <fieldset className="custom-background-fields" disabled={locked || !hasImage}>
        <div className="custom-background-section-heading"><h3>{t('画面', 'Framing')}</h3>
          <div className="custom-background-fit" role="group" aria-label={t('图片适应方式', 'Image fit')}>
            {(['cover', 'contain'] as const).map(fit => <button type="button" key={fit} aria-pressed={options.fit === fit}
              onClick={() => commit({ fit })}>{fit === 'cover' ? t('填充', 'Fill') : t('适应', 'Fit')}</button>)}
          </div>
        </div>
        <div className="custom-background-grid">
          {slider('positionX', t('水平位置', 'Horizontal position'), 0, 100, '%')}
          {slider('positionY', t('垂直位置', 'Vertical position'), 0, 100, '%')}
          {slider('zoom', t('缩放', 'Zoom'), 100, 200, '%')}
          {slider('brightness', t('亮度', 'Brightness'), 40, 120, '%')}
          {slider('blur', t('背景模糊', 'Background blur'), 0, 24, 'px')}
          {slider('parallax', t('鼠标视差', 'Mouse parallax'), 0, 12, 'px')}
        </div>
        <fieldset className="custom-background-surfaces" disabled={blocked || hasStellarUi(themePack)}>
          <div className="custom-background-section-heading"><h3>{t('界面材质', 'Interface material')}</h3>
            {hasStellarUi(themePack) && <span className="custom-background-material-status" role="status">{t('由主题管理', 'Managed by theme')}</span>}
          </div>
          <div className="custom-background-grid">
            {slider('contentTransparency', t('对话区透明度', 'Conversation transparency'), 0, 100, '%')}
            {slider('composerTransparency', t('输入框透明度', 'Composer transparency'), 0, 100, '%')}
            {slider('sidebarTransparency', t('左栏透明度', 'Left sidebar transparency'), 0, 100, '%')}
            {slider('panelTransparency', t('右栏透明度', 'Right panel transparency'), 0, 100, '%')}
            {slider('surfaceBlur', t('界面毛玻璃', 'Interface blur'), 0, 24, 'px')}
          </div>
        </fieldset>
        <div className="custom-background-actions">
          <button type="button" onClick={() => commit({ enabled: false })} disabled={!options.enabled}><RotateCcw size={14}/>{t('跟随主题', 'Follow theme')}</button>
          <button type="button" className="icon-button" aria-label={t('重置背景调节', 'Reset background adjustments')}
            data-tooltip={t('重置背景调节', 'Reset background adjustments')}
            onClick={() => commit({ ...DEFAULT_BACKGROUND_OPTIONS, enabled: options.enabled })}><RotateCcw size={15}/></button>
        </div>
      </fieldset>
      <div className="custom-background-feedback" role={error ? 'alert' : 'status'} aria-live="polite">
        <span>{pending ? <><LoaderCircle size={13} className="pc-spin"/>{t('正在保存…', 'Saving…')}</> : error
          || (saved ? t('已保存', 'Saved') : '')}</span>
        {error && <div>{failureAction === 'save' && <button type="button" disabled={locked} onClick={() => commit()}>{t('重试保存', 'Retry save')}</button>}
          <button type="button" disabled={pending || busy} onClick={() => void read()}>{t('重新读取', 'Reload')}</button></div>}
      </div>
    </>}
    <dialog ref={removeDialog} className="pc-dialog custom-background-dialog" aria-label={t('删除本机背景图片？', 'Delete the local background image?')}
      onCancel={event => { event.preventDefault(); setConfirmRemove(false); }}>
      <header><h2>{t('删除本机背景图片？', 'Delete the local background image?')}</h2></header>
      <footer><button type="button" autoFocus onClick={() => setConfirmRemove(false)}>{t('取消', 'Cancel')}</button>
        <button type="button" className="pc-danger-button" onClick={() => {
          setConfirmRemove(false);
          if (current.current?.ref) void perform('remove', () => bridge.customBackgroundRemove(current.current!.ref!));
        }}>{t('删除图片', 'Delete image')}</button></footer>
    </dialog>
  </section>;
}
