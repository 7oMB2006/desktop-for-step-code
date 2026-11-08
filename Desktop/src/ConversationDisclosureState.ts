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
  const [state, setState] = useState(() => ({ memory, key, revision, expanded: read() }));
  // A saved entry ID can arrive after the user has already opened the live message.
  const adoptingIdentity = state.memory === memory && state.revision === revision && state.key === undefined && key !== undefined;
  const current = state.memory === memory && state.key === key && state.revision === revision
    ? state : { memory, key, revision, expanded: adoptingIdentity ? state.expanded : read() };
  if (current !== state) setState(current);
  useLayoutEffect(() => {
    if (!memory || !key) return;
    memory.delete(key);
    memory.set(key, { revision, expanded: current.expanded });
    while (memory.size > 512) memory.delete(memory.keys().next().value!);
  }, [memory, key, revision, current.expanded]);
  const setExpanded: Dispatch<SetStateAction<boolean>> = value => setState(previous => ({
    ...previous, expanded: typeof value === 'function' ? value(previous.expanded) : value,
  }));
  return [current.expanded, setExpanded] as const;
}
