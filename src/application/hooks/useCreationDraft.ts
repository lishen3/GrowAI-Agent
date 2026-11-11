import { createContext, useContext, useState } from 'react';

type Fields = Record<string, string | boolean>;
export const CreationDraftContext = createContext<{ identity: string; drafts: Map<string, Fields> } | null>(null);

/** Session-only inputs, never business records or write permissions. Epoch changes isolate restored data. */
export function useCreationDraft<T extends Fields>(name: string, scope: string | null, initial: T) {
  const cache = useContext(CreationDraftContext);
  const key = cache && scope ? JSON.stringify([cache.identity, scope, name]) : null;
  const [state, setState] = useState({ key, value: (key ? cache?.drafts.get(key) as T | undefined : undefined) ?? initial });
  const value = state.key === key ? state.value : (key ? cache?.drafts.get(key) as T | undefined : undefined) ?? initial;
  function update(next: T | ((current: T) => T)) {
    const updated = typeof next === 'function' ? next(value) : next;
    if (key) cache!.drafts.set(key, updated);
    setState({ key, value: updated });
  }
  function discard() {
    // A late completion from an unmounted form must not clear a newer edited draft.
    if (key && cache!.drafts.get(key) === value) cache!.drafts.delete(key);
    setState({ key, value: initial });
  }
  return [value, update, discard] as const;
}
