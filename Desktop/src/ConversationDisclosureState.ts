import { createContext, useContext, useLayoutEffect, useState, type Dispatch, type SetStateAction } from 'react';

export type ConversationDisclosureState = Map<string, { revision: string; expanded: boolean }>;
export const ConversationDisclosureMemory = createContext<ConversationDisclosureState | undefined>(undefined);

/** Opt-in presentation memory, separate from messages and runtime state. */
export function useConversationDisclosure(key: string | undefined, defaultExpanded: boolean, resetKey?: string) {
  const memory = useContext(ConversationDisclosureMemory);
  const revision = JSON.stringify([defaultExpanded, resetKey]);
  const read = () => {
    const saved = key ? memory?.get(key) : undefined;
    return saved?.revision === revision ? saved.expanded : defaultExpanded;
  };
  const [state, setState] = useState(() => ({ memory, key, revision, expanded: read(), touched: false }));
  // A saved entry ID can arrive after the user has already opened the live message.
  const adoptingIdentity = state.memory === memory && state.revision === revision && state.key === undefined && key !== undefined;
  // Cold previews are interactive before their window presentation is restored.
  const adoptingPreview = state.memory === undefined && memory !== undefined && state.key === key
    && state.revision === revision && state.touched;
  const adopting = adoptingIdentity || adoptingPreview;
  const current = state.memory === memory && state.key === key && state.revision === revision
    ? state : { memory, key, revision, expanded: adopting ? state.expanded : read(), touched: adopting && state.touched };
  if (current !== state) setState(current);
  useLayoutEffect(() => {
    if (!memory || !key) return;
    memory.delete(key);
    memory.set(key, { revision, expanded: current.expanded });
    while (memory.size > 512) memory.delete(memory.keys().next().value!);
  }, [memory, key, revision, current.expanded]);
  const setExpanded: Dispatch<SetStateAction<boolean>> = value => setState(previous => {
    const expanded = typeof value === 'function' ? value(previous.expanded) : value;
    return { ...previous, expanded, touched: previous.touched || expanded !== previous.expanded };
  });
  return [current.expanded, setExpanded] as const;
}
