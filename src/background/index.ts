import { SessionManager } from '../session-manager';
import { OffscreenEvent, PanelCommand, STORAGE_KEYS, TargetTab } from '../audio-capture/messages';
import { handleActionClick } from './action';
import { chromeSessionStore, loadServices, loadSettings, offscreenMedia } from './chrome-adapters';

const manager = new SessionManager({ store: chromeSessionStore, media: offscreenMedia, services: loadServices });
// Reidrata a sessão ao acordar o service worker, sem reiniciar captura nem transcrição.
const ready = manager.restore().catch(() => null);

chrome.action.onClicked.addListener((tab) => {
  void handleActionClick(tab, {
    openPanel: (tabId) => chrome.sidePanel.open({ tabId }),
    saveTarget: (t) => chrome.storage.local.set({ [STORAGE_KEYS.target]: t }),
  });
});

async function onPanelCommand(cmd: PanelCommand): Promise<{ ok: boolean; error?: string }> {
  await ready;
  try {
    switch (cmd.type) {
      case 'start': {
        const raw = (await chrome.storage.local.get(STORAGE_KEYS.target))[STORAGE_KEYS.target];
        const target = TargetTab.safeParse(raw);
        if (!target.success) return { ok: false, error: 'Clique no ícone da extensão na aba que deseja monitorar.' };
        await manager.start({ tabId: target.data.tabId, title: target.data.title }, (await loadSettings()).providerMode);
        break;
      }
      case 'pause': await manager.pause(); break;
      case 'resume': await manager.resume(); break;
      case 'end': await manager.end(); break;
      case 'reset': await manager.reset(); break;
      case 'recheck': await manager.recheck(cmd.claimId); break;
      case 'ai-mode-opened': await manager.markAiModeOpened(cmd.claimId); break;
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Falha inesperada' };
  }
}

async function onOffscreenEvent(ev: OffscreenEvent): Promise<void> {
  await ready;
  switch (ev.type) {
    case 'segment': await manager.ingestSegment(ev.sessionId, ev.text, ev.offsetMs); break;
    case 'error':
      if (manager.session?.id !== ev.sessionId) break;
      await manager.setError(ev.message);
      if (ev.fatal) await manager.end();
      break;
    case 'ended':
      if (manager.session?.id === ev.sessionId) await manager.end();
      break;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const panel = PanelCommand.safeParse(msg);
  if (panel.success) {
    void onPanelCommand(panel.data).then(sendResponse);
    return true;
  }
  const ev = OffscreenEvent.safeParse(msg);
  if (ev.success) void onOffscreenEvent(ev.data);
  return false;
});

// Se a aba monitorada for fechada, encerra a sessão.
chrome.tabs.onRemoved.addListener((tabId) => {
  void ready.then(() => {
    if (manager.session && manager.session.state !== 'ended' && manager.session.tabId === tabId) void manager.end();
  });
});
