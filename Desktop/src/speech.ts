export interface SpeechConfig {
  source: 'follow' | 'custom' | 'local';
  endpoint: string;
  model: string;
  language: string;
}
export interface SpeechSettings extends SpeechConfig {
  revision: string;
  hasKey: boolean;
  acknowledged: boolean;
  followAvailable: boolean;
  followChannel?: 'plan' | 'api';
  followRegion?: 'cn' | 'global';
}
export interface SpeechBridge {
  speechSettings(): Promise<SpeechSettings>;
  saveSpeech(config: SpeechConfig, revision: string, key?: string): Promise<SpeechSettings>;
  acknowledgeSpeech(revision: string): Promise<SpeechSettings>;
  beginSpeech(): Promise<{ id: string }>;
  transcribeSpeech(id: string, audio: Uint8Array, sequence?: number): Promise<string>;
  finishSpeech(id: string): Promise<void>;
  cancelSpeech(id: string): Promise<void>;
}
