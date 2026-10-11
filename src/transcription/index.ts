import { backendRequest, type BackendOptions } from '../shared/backend';
import { TranscribeResponse } from '../shared/schemas';

/** Interface de reconhecimento de fala. Troque a implementação sem mexer no restante. */
export interface Transcriber {
  transcribe(audio: Blob, signal?: AbortSignal): Promise<string>;
}

/** Envia o trecho ao backend, que o repassa ao provedor de STT (Gemini). Áudio não é persistido. */
export class BackendTranscriber implements Transcriber {
  constructor(private backend: BackendOptions) {}

  async transcribe(audio: Blob, signal?: AbortSignal): Promise<string> {
    const r = await backendRequest(this.backend, '/v1/transcribe', { body: audio, contentType: audio.type || 'audio/webm', signal }, TranscribeResponse);
    return r.text.trim();
  }
}
