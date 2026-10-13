import { credentialStorageText, type CredentialStorageState } from './credential-storage';

export function CredentialStorageNotice({ state, language, disabled, onCheck }: {
  state: CredentialStorageState; language: string; disabled: boolean; onCheck: () => void;
}) {
  const text = credentialStorageText(language);
  return <div className={`credential-storage is-${state}`}>
    <strong>{text.title}</strong>
    <p role="status" aria-live="polite">{state === 'unavailable' ? text.unavailable : text[state]}</p>
    {state !== 'ready' && <p className="credential-storage-guidance">{text.guidance}</p>}
    <button type="button" disabled={disabled || state === 'checking'} onClick={onCheck}>
      {state === 'checking' ? text.checkingAction : state === 'unchecked' ? text.check : text.retry}
    </button>
  </div>;
}
