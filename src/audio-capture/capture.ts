import { downsample, encodeWav, rms } from './wav';

/**
 * Captura de áudio de aba (roda no documento offscreen).
 * - O áudio original é SEMPRE devolvido ao alto-falante (tabCapture silencia a aba por padrão).
 * - O áudio vive só em memória: a cada `chunkMs` vira um WAV 16 kHz mono, é entregue e descartado.
 * - Trechos sem fala (silêncio) nem chegam a ser enviados.
 */
export const TARGET_RATE = 16_000;

/** Reconecta o stream capturado à saída padrão, preservando a reprodução original. */
export function connectPlayback(ctx: AudioContext, stream: MediaStream): MediaStreamAudioSourceNode {
  const source = ctx.createMediaStreamSource(stream);
  source.connect(ctx.destination);
  return source;
}

export interface CaptureOptions {
  chunkMs: number;
  /** Nível RMS (0..1) a partir do qual há fala. */
  speechThreshold: number;
  onChunk(wav: Blob, offsetMs: number): void;
  onEnded(): void;
}

export class TabAudioCapture {
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private processor?: ScriptProcessorNode;
  private recording = false;
  private stopped = false;
  private pieces: Float32Array[] = [];
  private bufferedSamples = 0;
  private heardSpeech = false;
  /** Posição, em amostras, do início do trecho em curso desde o início da sessão. */
  private samplesBeforeChunk = 0;

  constructor(private createContext: () => AudioContext, private opts: CaptureOptions) {}

  get isRecording() {
    return this.recording;
  }

  start(stream: MediaStream): void {
    this.stream = stream;
    const ctx = (this.ctx = this.createContext());
    const source = connectPlayback(ctx, stream); // o áudio segue tocando
    const proc = (this.processor = ctx.createScriptProcessor(4096, 1, 1));
    proc.onaudioprocess = (e) => this.onAudio(e.inputBuffer);
    source.connect(proc);
    proc.connect(ctx.destination); // necessário para o processador rodar; a saída é silêncio
    stream.getAudioTracks().forEach((t) => t.addEventListener('ended', () => this.handleTrackEnded()));
    this.recording = true;
  }

  /** Para de gravar/enviar, mas mantém o áudio da aba tocando. */
  pause(): void {
    this.recording = false;
    this.resetBuffer();
  }

  resume(): void {
    if (this.stopped || this.recording) return;
    this.resetBuffer();
    this.recording = true;
  }

  stop(): void {
    this.stopped = true;
    this.recording = false;
    this.resetBuffer();
    if (this.processor) this.processor.onaudioprocess = null;
    this.processor?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
  }

  private resetBuffer() {
    this.pieces = [];
    this.bufferedSamples = 0;
    this.heardSpeech = false;
  }

  private onAudio(buf: AudioBuffer): void {
    if (!this.recording || !this.ctx) return;
    // Mistura os canais em mono.
    const mono = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < buf.length; i++) mono[i] = (mono[i] as number) + (ch[i] as number) / buf.numberOfChannels;
    }
    if (rms(mono) >= this.opts.speechThreshold) this.heardSpeech = true;
    this.pieces.push(mono);
    this.bufferedSamples += mono.length;

    const rate = this.ctx.sampleRate;
    if (this.bufferedSamples >= (rate * this.opts.chunkMs) / 1000) this.flush(rate);
  }

  private flush(rate: number): void {
    const all = new Float32Array(this.bufferedSamples);
    let o = 0;
    for (const p of this.pieces) { all.set(p, o); o += p.length; }
    const offsetMs = (this.samplesBeforeChunk / rate) * 1000;
    this.samplesBeforeChunk += this.bufferedSamples;
    const speech = this.heardSpeech;
    this.resetBuffer();
    if (!speech) return; // silêncio: não envia nada
    const wav = encodeWav(downsample(all, rate, TARGET_RATE), Math.min(rate, TARGET_RATE));
    this.opts.onChunk(new Blob([wav as BlobPart], { type: 'audio/wav' }), offsetMs);
  }

  private handleTrackEnded(): void {
    if (this.stopped) return;
    this.stop();
    this.opts.onEnded();
  }
}
