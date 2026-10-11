import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, HealthResponse, Session, Settings } from '../shared/schemas';
import { PanelCommand, STORAGE_KEYS, TargetTab } from '../audio-capture/messages';

function useStored<T>(key: string, parse: (v: unknown) => T): T {
  const [value, setValue] = useState<T>(() => parse(undefined));
  useEffect(() => {
    let alive = true;
    void chrome.storage.local.get(key).then((r) => alive && setValue(parse(r[key])));
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[key]) setValue(parse(changes[key].newValue));
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return value;
}

// O painel renderiza direto do estado persistido: abre instantaneamente e não reinicia nada.
export const useSession = () => useStored<Session | null>(STORAGE_KEYS.session, (v) => (Session.safeParse(v).data ?? null));
export const useTarget = () => useStored<TargetTab | null>(STORAGE_KEYS.target, (v) => (TargetTab.safeParse(v).data ?? null));
export const useSettings = () => useStored<Settings>(STORAGE_KEYS.settings, (v) => Settings.safeParse(v ?? {}).data ?? DEFAULT_SETTINGS);

export const saveSettings = (s: Settings) => chrome.storage.local.set({ [STORAGE_KEYS.settings]: s });

type CommandInput = PanelCommand extends infer T ? (T extends { source: 'panel' } ? Omit<T, 'source'> : never) : never;

export function useCommand() {
  const [error, setError] = useState<string>();
  const send = useCallback(async (cmd: CommandInput) => {
    setError(undefined);
    const r = (await chrome.runtime.sendMessage({ source: 'panel', ...cmd })) as { ok: boolean; error?: string } | undefined;
    if (r && !r.ok) setError(r.error);
  }, []);
  return { send, error };
}

export function useHealth(settings: Settings) {
  const [state, setState] = useState<'checking' | 'ok' | 'no-key' | 'down'>('checking');
  useEffect(() => {
    let alive = true;
    setState('checking');
    fetch(new URL('/health', settings.backendUrl), { signal: AbortSignal.timeout(4000) })
      .then((r) => r.json())
      .then((j) => {
        const h = HealthResponse.parse(j);
        if (alive) setState(h.providers.grounded ? 'ok' : 'no-key');
      })
      .catch(() => alive && setState('down'));
    return () => {
      alive = false;
    };
  }, [settings.backendUrl]);
  return state;
}
