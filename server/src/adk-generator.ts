import { Gemini, GOOGLE_SEARCH, InMemorySessionService, LlmAgent, Runner, isFinalResponse, stringifyContent } from '@google/adk';
import type { Content } from '@google/genai';
import { randomUUID } from 'node:crypto';
import { LlmError, type Citation, type GenerateOptions, type LlmOutput, type LlmPart, type TextGenerator } from './llm';

const AUDIO_MIME: Record<string, string> = {
  wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg',
  flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4', aiff: 'audio/aiff',
};

interface SafeInputMetadata {
  inputKinds: string[];
  audioMimeTypes: string[];
  audioByteLengths: number[];
}

interface SafeModelResponseMetadata {
  modelVersion?: string;
  finishReason?: string;
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

function safeInputMetadata(input: GenerateOptions['input']): SafeInputMetadata {
  const parts: LlmPart[] = typeof input === 'string' ? [{ type: 'text', text: input }] : input;
  const audioParts = parts.filter((part): part is Extract<LlmPart, { type: 'audio' }> => part.type === 'audio');
  return {
    inputKinds: parts.map((part) => part.type),
    audioMimeTypes: audioParts.map((part) => AUDIO_MIME[part.format] ?? `audio/${part.format}`),
    audioByteLengths: audioParts.map((part) => Buffer.from(part.data, 'base64').byteLength),
  };
}

function safeModelResponseMetadata(response: {
  errorCode?: string;
  modelVersion?: string;
  finishReason?: string;
  usageMetadata?: {
    promptTokenCount?: number | null;
    candidatesTokenCount?: number | null;
    totalTokenCount?: number | null;
  };
}): SafeModelResponseMetadata | undefined {
  if (!response.errorCode) return undefined;

  const metadata: SafeModelResponseMetadata = {};
  if (response.modelVersion) metadata.modelVersion = response.modelVersion;
  if (response.finishReason && response.finishReason !== response.errorCode) {
    metadata.finishReason = response.finishReason;
  }
  for (const key of ['promptTokenCount', 'candidatesTokenCount', 'totalTokenCount'] as const) {
    const value = response.usageMetadata?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) metadata[key] = value;
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function safeErrorDetail(value: unknown, sensitiveValues: string[]): string | undefined {
  if (typeof value !== 'string' && !(value instanceof Error)) return undefined;
  let message = typeof value === 'string' ? value : value.message;
  for (const sensitiveValue of sensitiveValues) {
    if (sensitiveValue) message = message.replaceAll(sensitiveValue, '[redacted]');
  }
  const detail = message
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  return detail || undefined;
}

function logProviderFailure(
  diagnostic: {
    operationId: string;
    model: string;
    input: SafeInputMetadata;
    errorCode?: string;
    errorName?: string;
    detail?: string;
    responseMetadata?: SafeModelResponseMetadata;
  },
): void {
  const { detail, responseMetadata, ...metadata } = diagnostic;
  console.error('ADK/Gemini request failed', {
    ...metadata,
    ...(responseMetadata ? { responseMetadata } : {}),
    ...(detail ? { detail } : {}),
  });
}

export interface AdkGeneratorConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export class AdkGenerator implements TextGenerator {
  private readonly sessionService = new InMemorySessionService();

  constructor(private readonly cfg: AdkGeneratorConfig) {}

  get configured(): boolean {
    return this.cfg.apiKey.length > 0;
  }

  async generate(opts: GenerateOptions): Promise<LlmOutput> {
    if (!this.configured) throw new LlmError('GOOGLE_API_KEY não configurada no backend', 'config');

    const gemini = new Gemini({ model: this.cfg.model, apiKey: this.cfg.apiKey });
    const tools = opts.webSearch ? [GOOGLE_SEARCH] : [];
    const agent = new LlmAgent({
      name: 'adk-gen',
      model: gemini,
      instruction: opts.system ?? '',
      tools,
      afterModelCallback: ({ response }) => {
        modelResponseMetadata = safeModelResponseMetadata(response);
        return undefined;
      },
      generateContentConfig: {
        temperature: opts.temperature ?? 0,
        maxOutputTokens: opts.maxTokens,
      },
    });

    const appName = 'factcheck-live';
    const userId = 'backend';
    const sessionId = randomUUID();

    const runner = new Runner({ appName, agent, sessionService: this.sessionService });

    const parts: Content['parts'] = typeof opts.input === 'string'
      ? [{ text: opts.input }]
      : opts.input.map((p: LlmPart) =>
          p.type === 'text'
            ? { text: p.text }
            : { inlineData: { data: p.data, mimeType: AUDIO_MIME[p.format] ?? `audio/${p.format}` } }
        );

    const newMessage: Content = { role: 'user', parts };
    const inputMetadata = safeInputMetadata(opts.input);
    const sensitiveValues = [
      this.cfg.apiKey,
      opts.system ?? '',
      ...(typeof opts.input === 'string' ? [opts.input] : opts.input.flatMap((part) => part.type === 'text' ? [part.text] : [part.data])),
    ];

    const timeout = AbortSignal.timeout(this.cfg.timeoutMs);
    const abortSignal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

    let text = '';
    let modelResponseMetadata: SafeModelResponseMetadata | undefined;
    const citations: Citation[] = [];

    try {
      await this.sessionService.createSession({ appName, userId, sessionId });
      for await (const event of runner.runAsync({ userId, sessionId, newMessage, abortSignal })) {
        if (event.errorCode) {
          const detail = safeErrorDetail(event.errorMessage ?? event.errorCode, sensitiveValues);
          const distinctDetail = detail === event.errorCode ? undefined : detail;
          logProviderFailure({
            operationId: sessionId,
            model: this.cfg.model,
            input: inputMetadata,
            errorCode: event.errorCode,
            responseMetadata: modelResponseMetadata,
            detail: distinctDetail,
          });
          const status = Number(event.errorCode);
          throw new LlmError(
            `ADK/Gemini retornou ${event.errorCode}${distinctDetail ? `: ${distinctDetail}` : ''}`,
            'http',
            Number.isInteger(status) ? status : undefined,
          );
        }
        if (!isFinalResponse(event)) continue;
        text = stringifyContent(event);
        for (const chunk of event.groundingMetadata?.groundingChunks ?? []) {
          const web = chunk.web;
          if (!web?.uri) continue;
          citations.push({ url: web.uri, title: web.title ?? web.uri });
        }
      }
    } catch (e) {
      if (timeout.aborted) throw new LlmError('Tempo esgotado ao consultar o ADK/Gemini', 'timeout');
      if (opts.signal?.aborted) throw e;
      if (e instanceof LlmError) throw e;
      const detail = safeErrorDetail(e, sensitiveValues);
      logProviderFailure({
        operationId: sessionId,
        model: this.cfg.model,
        input: inputMetadata,
        responseMetadata: modelResponseMetadata,
        errorName: e instanceof Error ? e.name : 'UnknownError',
        detail,
      });
      throw new LlmError(`Erro ao consultar o ADK/Gemini${detail ? `: ${detail}` : ''}`, 'http');
    } finally {
      await this.sessionService.deleteSession({ appName, userId, sessionId });
    }

    if (!text.trim()) throw new LlmError('Resposta vazia do ADK/Gemini', 'parse');
    return { text, citations };
  }
}
