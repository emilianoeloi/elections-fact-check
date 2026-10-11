import { OffscreenCommand, type OffscreenEvent } from '../audio-capture/messages';
import { TabAudioCapture } from '../audio-capture/capture';
import { BackendTranscriber } from '../transcription';

const CHUNK_MS = 12_000;
const MAX_BACKLOG = 3;

let capture: TabAudioCapture | undefined;
let sessionId = '';
let abort = new AbortController();
let chain: Promise<void> = Promise.resolve();
let backlog = 0;

const emit = (ev: OffscreenEvent) => void chrome.runtime.sendMessage(ev).catch(() => undefined);

chrome.runtime.onMessage.addListener((msg) => {
  const p = OffscreenCommand.safeParse(msg);
  if (!p.success) return;
  const cmd = p.data;
  switch (cmd.type) {
    case 'capture-start': void start(cmd); break;
    case 'capture-pause': capture?.pause(); break;
    case 'capture-resume': capture?.resume(); break;
    case 'capture-stop':
      abort.abort();
      capture?.stop();
      capture = undefined;
      break;
  }
});

async function start(cmd: Extract<OffscreenCommand, { type: 'capture-start' }>) {
  sessionId = cmd.sessionId;
  abort = new AbortController();
  backlog = 0;
  const transcriber = new BackendTranscriber({ settings: cmd.settings });
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: cmd.streamId } },
      video: false,
    } as MediaStreamConstraints);
    capture = new TabAudioCapture(() => new AudioContext(), {
      chunkMs: CHUNK_MS,
      speechThreshold: 0.01,
      onEnded: () => emit({ source: 'offscreen', type: 'ended', sessionId }),
      onChunk: (blob, offsetMs) => {
        if (backlog >= MAX_BACKLOG) {
          emit({ source: 'offscreen', type: 'error', sessionId, fatal: false, message: 'Transcrição atrasada: um trecho de áudio foi descartado.' });
          return;
        }
        backlog++;
        const sid = sessionId;
        // Transcrição em série para preservar a ordem; roda em paralelo às checagens.
        chain = chain.then(async () => {
          try {
            const text = await transcriber.transcribe(blob, abort.signal);
            if (text) emit({ source: 'offscreen', type: 'segment', sessionId: sid, text, offsetMs });
          } catch (e) {
            if (abort.signal.aborted) return;
            emit({ source: 'offscreen', type: 'error', sessionId: sid, fatal: false, message: e instanceof Error ? `Transcrição: ${e.message}` : 'Falha na transcrição' });
          } finally {
            backlog--;
          }
        });
      },
    });
    capture.start(stream);
  } catch {
    emit({ source: 'offscreen', type: 'error', sessionId, fatal: true, message: 'Não foi possível capturar o áudio da aba. Clique no ícone da extensão nessa aba e tente novamente.' });
  }
}
