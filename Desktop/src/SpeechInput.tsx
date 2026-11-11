import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle, Mic, Settings, Square, X } from 'lucide-react';
import type { SpeechBridge, SpeechSettings } from './speech';
import { pcmWav } from './speech-audio';
import { captureSpeech, type SpeechCapture } from './speech-capture';
import { SpeechSegments, speechLevel } from './speech-segments';
import './speech.css';

type Recording = {
  id?: string; stream?: MediaStream; capture?: SpeechCapture; timer?: ReturnType<typeof setTimeout>;
  segments: SpeechSegments; queue: Uint8Array[]; sequence: number; samples: number;
  draining: boolean; inserted: boolean; stopping: boolean; ending: boolean; cancelled: boolean;
};
const configured = (settings: SpeechSettings) => settings.source === 'follow' ? settings.followAvailable
  : Boolean(settings.model && settings.endpoint && (settings.source !== 'custom' || settings.hasKey));
export function SpeechInput({ bridge, language, disabled, statusTarget, onText, onConfigure, onActiveChange, onConsentChange }: {
  bridge: SpeechBridge; language: string; disabled: boolean;
  statusTarget: HTMLElement | null;
  onText: (text: string, continuation: boolean) => void; onConfigure: () => void; onActiveChange: (active: boolean) => void;
  onConsentChange: (open: boolean) => void;
}) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const [phase, setPhase] = useState<'idle' | 'starting' | 'recording' | 'finishing'>('idle');
  const [consent, setConsent] = useState<SpeechSettings>();
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [working, setWorking] = useState(false);
  const [statusPresent, setStatusPresent] = useState(false);
  const active = phase !== 'idle';
  const statusVisible = active || Boolean(error);
  if (statusVisible && !statusPresent) setStatusPresent(true);
  const current = useRef<Recording | undefined>(undefined);
  const trigger = useRef<HTMLButtonElement>(null);
  const consentPanel = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const latest = useRef({ onText, onConfigure, onActiveChange, onConsentChange, disabled });
  latest.current = { onText, onConfigure, onActiveChange, onConsentChange, disabled };
  const release = (operation: Recording) => {
    clearTimeout(operation.timer);
    operation.capture?.cancel();
    operation.stream?.getTracks().forEach(track => track.stop());
  };
  const cancel = () => {
    const operation = current.current;
    current.current = undefined;
    if (operation) {
      operation.cancelled = true;
      operation.queue = [];
      release(operation);
      if (operation.id) void bridge.cancelSpeech(operation.id).catch(() => {});
    }
    latest.current.onActiveChange(false);
    if (alive.current) { setPhase('idle'); setLevel(0); setWorking(false); }
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false; cancel(); latest.current.onConsentChange(false);
    };
  }, [bridge]);
  useEffect(() => {
    if (statusVisible || !statusPresent) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setStatusPresent(false); return; }
    const timer = setTimeout(() => setStatusPresent(false), 240);
    return () => clearTimeout(timer);
  }, [statusVisible, statusPresent]);
  useEffect(() => { if (disabled) { cancel(); setConsent(undefined); } }, [disabled]);
  useEffect(() => {
    const hide = () => { if (document.hidden) { cancel(); setConsent(undefined); } };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, []);
  useEffect(() => {
    if (phase !== 'recording') return;
    const started = Date.now(); setSeconds(0);
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(timer);
  }, [phase]);
  useEffect(() => {
    latest.current.onConsentChange(Boolean(consent));
    if (consent) {
      consentPanel.current?.showPopover();
      consentPanel.current?.querySelector('button')?.focus();
    } else if (consentPanel.current?.matches(':popover-open')) consentPanel.current.hidePopover();
  }, [consent]);

  const failed = (operation: Recording, reason?: unknown, message?: string) => {
    if (operation.cancelled || current.current !== operation) return;
    const status = reason instanceof Error ? /Speech service HTTP (\d{3})/.exec(reason.message)?.[1] : undefined;
    setError(message ?? t('听写已停止，请检查录音、服务凭据和模型。已写入文字保留。', 'Dictation stopped. Check the recording, credentials and model. Inserted text was kept.') + (status ? ` (HTTP ${status})` : ''));
    cancel();
  };
  const drain = async (operation: Recording) => {
    if (operation.draining || operation.cancelled) return;
    operation.draining = true;
    try {
      while (operation.queue.length && !operation.cancelled) {
        setWorking(true);
        const audio = operation.queue.shift()!;
        const text = await bridge.transcribeSpeech(operation.id!, audio, operation.sequence++);
        if (operation.cancelled || current.current !== operation) return;
        latest.current.onText(text, operation.inserted);
        operation.inserted = true;
      }
      if (operation.ending && !operation.cancelled) {
        await bridge.finishSpeech(operation.id!);
        if (!operation.cancelled && current.current === operation) cancel();
      }
    } catch (reason) { failed(operation, reason); }
    finally {
      operation.draining = false;
      if (alive.current && current.current === operation) setWorking(false);
    }
  };
  const enqueue = (operation: Recording, samples: Float32Array) => {
    if (operation.cancelled) return;
    if (operation.queue.length >= 4) {
      failed(operation, undefined, t('识别服务响应较慢，听写已停止。已写入文字保留。', 'The recognition service is too slow. Dictation stopped; inserted text was kept.'));
      return;
    }
    operation.queue.push(pcmWav(samples));
    void drain(operation);
  };
  const stop = async (operation: Recording) => {
    if (operation.stopping || operation.cancelled) return;
    operation.stopping = true;
    clearTimeout(operation.timer);
    setPhase('finishing'); setLevel(0);
    try {
      await operation.capture?.stop();
      if (operation.cancelled) return;
      const tail = operation.segments.finish();
      if (tail) enqueue(operation, tail);
      operation.ending = true;
      void drain(operation);
    } catch (reason) { failed(operation, reason); }
  };
  const start = async () => {
    if (current.current || latest.current.disabled || !alive.current) return;
    const operation: Recording = { cancelled: false, stopping: false, ending: false, draining: false,
      inserted: false, samples: 0, sequence: 0, segments: new SpeechSegments(), queue: [] };
    current.current = operation;
    setPhase('starting'); setError(''); latest.current.onActiveChange(true);
    try {
      const settings = await bridge.speechSettings();
      if (operation.cancelled) return;
      if (!settings.acknowledged) { cancel(); setConsent(settings); return; }
      if (!configured(settings)) { cancel(); latest.current.onConfigure(); return; }
      const request = await bridge.beginSpeech();
      operation.id = request.id;
      if (operation.cancelled) { await bridge.cancelSpeech(request.id); return; }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      operation.stream = stream;
      if (operation.cancelled) { release(operation); return; }
      const capture = await captureSpeech(stream, samples => {
        if (operation.cancelled) return;
        const remaining = 60 * 16000 - operation.samples;
        const bounded = samples.subarray(0, Math.max(0, remaining));
        operation.samples += bounded.length;
        setLevel(Math.min(1, speechLevel(bounded) * 8));
        for (const segment of operation.segments.push(bounded)) enqueue(operation, segment);
        if (operation.samples >= 60 * 16000) void stop(operation);
      }, () => failed(operation, undefined, t('麦克风录音失败。已写入文字保留。', 'Microphone recording failed. Inserted text was kept.')));
      operation.capture = capture;
      if (operation.cancelled) { capture.cancel(); return; }
      stream.getAudioTracks().forEach(track => { track.onended = () => void stop(operation); });
      operation.timer = setTimeout(() => void stop(operation), 60000);
      setPhase('recording');
    } catch (reason) {
      if (!operation.cancelled) {
        setError(reason instanceof DOMException && ['NotAllowedError', 'NotFoundError', 'NotReadableError'].includes(reason.name)
          ? t('无法使用麦克风，请检查设备和系统麦克风权限。', 'Microphone unavailable. Check the device and system microphone permissions.')
          : t('无法开始听写，请检查听写设置。', 'Could not start dictation. Check dictation settings.'));
        cancel();
      }
    }
  };
  const label = phase === 'recording' ? t('结束听写', 'Finish dictation')
    : active ? t('取消听写', 'Cancel dictation') : t('语音听写', 'Voice dictation');
  return <div className="speech-input">
    <button ref={trigger} type="button" className={`icon-button${active ? ' speech-active' : ''}`} aria-label={label}
      data-tooltip={label} aria-pressed={active} disabled={disabled}
      onClick={() => {
        if (phase === 'recording') { const operation = current.current; if (operation) void stop(operation); }
        else if (active) cancel(); else void start();
      }}>
      {phase === 'recording' ? <Square size={15}/> : active ? <LoaderCircle size={17} className="speech-spinner"/> : <Mic size={17}/>}
    </button>
    {statusPresent && statusTarget && createPortal(<div className={`speech-progress${active ? ' speech-listening' : ''}${error ? ' speech-error' : ''}`}
      data-open={statusVisible} aria-hidden={!statusVisible} inert={!statusVisible} role={error ? 'alert' : undefined}>
      <div className="speech-progress-body">
        {phase === 'recording' ? <span className="speech-level" aria-hidden="true">{[0.6, 1, 0.8, 0.5].map((factor, index) =>
          <i key={index} style={{ transform: `scaleY(${0.15 + level * factor * 0.85})` }}/>)}</span>
          : active && <LoaderCircle size={14} className="speech-spinner" aria-hidden="true"/>}
        <span className="speech-status-label" role={active ? 'status' : undefined} data-tooltip={error || undefined} tabIndex={error ? 0 : undefined}>
          {error || (phase === 'recording' ? working ? t('正在写入', 'Writing') : t('听写中', 'Listening')
            : phase === 'starting' ? t('正在打开麦克风…', 'Opening microphone…')
            : phase === 'finishing' ? t('正在完成听写…', 'Finishing dictation…') : t('听写已结束', 'Dictation ended'))}
        </span>
        {phase === 'recording' && <span className="speech-clock" aria-hidden="true">0:{String(seconds).padStart(2, '0')}</span>}
        {error && <button type="button" className="icon-button" aria-label={t('听写设置', 'Dictation settings')}
          data-tooltip={t('听写设置', 'Dictation settings')} onClick={() => { setError(''); onConfigure(); }}><Settings size={14}/></button>}
        <button type="button" className="icon-button" aria-label={error ? t('关闭', 'Dismiss') : t('取消听写', 'Cancel dictation')}
          data-tooltip={error ? t('关闭', 'Dismiss') : t('取消剩余听写，保留已写入文字', 'Cancel remaining dictation; keep inserted text')}
          onClick={() => { if (error) setError(''); else cancel(); trigger.current?.focus({ preventScroll: true }); }}><X size={14}/></button>
      </div>
    </div>, statusTarget)}
    <div ref={consentPanel} popover="auto" role="dialog" aria-label={t('启用语音听写', 'Enable voice dictation')} className="speech-consent"
      onToggle={event => { if ((event.nativeEvent as ToggleEvent).newState === 'closed') setConsent(undefined); }}>
      <h3>{t('启用语音听写', 'Enable voice dictation')}</h3>
      <p>{t('DFSC 是社区版客户端，无法提供官方 Desktop 的内置 ASR 服务。听写可使用你的 DFSC 登录账户、独立 ASR 服务或本地适配器；登录不代表拥有 ASR 权益。', 'DFSC is a community client and cannot provide the official Desktop built-in ASR service. Dictation can use your DFSC account, an independent ASR service or a local adapter. Signing in does not establish ASR entitlement.')}</p>
      <p>{t('录音期间，音频按停顿或约 4 秒的短片段发送至选定服务，每段可能消耗额度或产生费用；失败不自动切换计费渠道。DFSC 不保存录音，识别文字陆续追加到草稿，不自动发送。取消会丢弃未完成的片段，保留已写入文字。', 'While recording, audio is sent to the selected service in short segments at pauses or about every 4 seconds. Each request may consume quota or incur charges; there is no billing fallback. DFSC does not save recordings. Text is appended to your draft without being sent automatically. Cancel discards unfinished segments and keeps inserted text.')}</p>
      {consent?.source === 'follow' && consent.followAvailable && <p>{t(`当前使用 ${consent.followChannel === 'plan' ? 'Step Plan' : 'API'}（${consent.followRegion === 'global' ? '海外' : '国内'}），识别模型 stepaudio-2.5-asr。`,
        `Current route: ${consent.followChannel === 'plan' ? 'Step Plan' : 'API'} (${consent.followRegion === 'global' ? 'overseas' : 'China'}), model stepaudio-2.5-asr.`)}</p>}
      <div className="button-row"><button disabled={accepting} onClick={() => { setConsent(undefined); trigger.current?.focus(); }}>{t('取消', 'Cancel')}</button>
        <button className="primary" disabled={accepting} onClick={() => {
          if (!consent || accepting) return;
          setAccepting(true);
          void bridge.acknowledgeSpeech(consent.revision).then(next => {
            if (!alive.current || latest.current.disabled || !consentPanel.current?.matches(':popover-open')) return;
            setConsent(undefined);
            if (configured(next)) void start(); else latest.current.onConfigure();
          }, () => {
            if (alive.current) { setConsent(undefined); setError(t('设置已改变或授权保存失败，请重试。', 'Settings changed or consent could not be saved. Try again.')); }
          }).finally(() => { if (alive.current) setAccepting(false); });
        }}>{consent && configured(consent) ? t('同意并录音', 'Agree and record') : t('了解并配置', 'Continue to settings')}</button></div>
    </div>
  </div>;
}
