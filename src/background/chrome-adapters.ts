import { DEFAULT_SETTINGS, Session, Settings } from '../shared/schemas';
import { STORAGE_KEYS, type OffscreenCommand } from '../audio-capture/messages';
import type { MediaController, Services, SessionStore } from '../session-manager';
import { BackendTopicClassifier } from '../topic-classifier';
import { BackendClaimExtractor } from '../claim-extractor';
import { BackendWebSearchProvider, ManualAiModeProvider } from '../fact-check-provider';

export const chromeSessionStore: SessionStore = {
  async load() {
    const r = await chrome.storage.local.get(STORAGE_KEYS.session);
    const p = Session.safeParse(r[STORAGE_KEYS.session]);
    return p.success ? p.data : null;
  },
  async save(s) {
    await chrome.storage.local.set({ [STORAGE_KEYS.session]: s });
  },
  async clear() {
    await chrome.storage.local.remove(STORAGE_KEYS.session);
  },
};

export async function loadSettings(): Promise<Settings> {
  const r = await chrome.storage.local.get(STORAGE_KEYS.settings);
  const p = Settings.safeParse(r[STORAGE_KEYS.settings] ?? {});
  return p.success ? p.data : DEFAULT_SETTINGS;
}

export async function loadServices(): Promise<Services> {
  const backend = { settings: await loadSettings() };
  return {
    classifier: new BackendTopicClassifier(backend),
    extractor: new BackendClaimExtractor(backend),
    providers: { grounded: new BackendWebSearchProvider(backend), manual: new ManualAiModeProvider() },
  };
}

const OFFSCREEN_PATH = 'offscreen.html';

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  if (existing.length) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: 'Capturar e reproduzir o áudio da aba monitorada pelo usuário.',
  });
}

const send = (cmd: OffscreenCommand) => chrome.runtime.sendMessage(cmd);

export const offscreenMedia: MediaController = {
  async start(sessionId, tabId) {
    await ensureOffscreen();
    // Exige que o usuário tenha invocado a extensão nessa aba (activeTab) — garantido pelo clique no ícone.
    const streamId = await new Promise<string>((resolve, reject) =>
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
        const err = chrome.runtime.lastError;
        return err || !id ? reject(new Error(err?.message ?? 'Sem permissão para capturar esta aba')) : resolve(id);
      }),
    );
    await send({ target: 'offscreen', type: 'capture-start', streamId, sessionId, settings: await loadSettings() });
  },
  pause: async () => void (await send({ target: 'offscreen', type: 'capture-pause' })),
  resume: async () => void (await send({ target: 'offscreen', type: 'capture-resume' })),
  async stop() {
    await send({ target: 'offscreen', type: 'capture-stop' }).catch(() => undefined);
    await chrome.offscreen.closeDocument().catch(() => undefined);
  },
};
