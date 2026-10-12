import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdkGenerator } from '../server/src/adk-generator';
import { LlmError } from '../server/src/llm';

const adk = vi.hoisted(() => ({
  googleSearch: { name: 'google-search' },
  sessionService: {
    createSession: vi.fn(),
    deleteSession: vi.fn(),
  },
  Gemini: vi.fn(),
  LlmAgent: vi.fn(),
  Runner: vi.fn(),
  isFinalResponse: vi.fn(),
  stringifyContent: vi.fn(),
  runAsync: vi.fn(),
}));

vi.mock('@google/adk', () => ({
  Gemini: adk.Gemini,
  GOOGLE_SEARCH: adk.googleSearch,
  InMemorySessionService: class {
    createSession = adk.sessionService.createSession;
    deleteSession = adk.sessionService.deleteSession;
  },
  LlmAgent: adk.LlmAgent,
  Runner: adk.Runner,
  isFinalResponse: adk.isFinalResponse,
  stringifyContent: adk.stringifyContent,
}));

const config = { apiKey: 'unit-test-placeholder', model: 'test-model', timeoutMs: 60_000 };

function runAfterModelCallback(response: object): unknown {
  const agentConfig = adk.LlmAgent.mock.calls[0]?.[0] as {
    afterModelCallback?: (params: unknown) => unknown;
  } | undefined;
  return agentConfig?.afterModelCallback?.({ context: {}, response });
}

describe('AdkGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adk.sessionService.createSession.mockResolvedValue({});
    adk.sessionService.deleteSession.mockResolvedValue({});
    adk.Runner.mockImplementation(function () {
      return { runAsync: adk.runAsync };
    });
    adk.isFinalResponse.mockImplementation((event: { final?: boolean }) => event.final === true);
    adk.stringifyContent.mockImplementation((event: { text?: string }) => event.text ?? '');
    adk.runAsync.mockImplementation(async function* () {
      yield { final: true, text: 'generated text' };
    });
  });

  it('maps generation configuration and only enables Google Search when requested', async () => {
    const generator = new AdkGenerator(config);

    await generator.generate({ input: 'plain input', temperature: 0.2, maxTokens: 400 });
    expect(adk.Gemini).toHaveBeenCalledWith({ model: 'test-model', apiKey: config.apiKey });
    expect(adk.LlmAgent).toHaveBeenCalledWith(expect.objectContaining({
      instruction: '',
      tools: [],
      generateContentConfig: { temperature: 0.2, maxOutputTokens: 400 },
    }));

    adk.LlmAgent.mockClear();
    await generator.generate({ input: 'search input', system: 'instructions', webSearch: true });
    expect(adk.LlmAgent).toHaveBeenCalledWith(expect.objectContaining({
      instruction: 'instructions',
      tools: [adk.googleSearch],
    }));
  });

  it('maps text and audio parts and returns citations from final grounded metadata', async () => {
    adk.runAsync.mockImplementationOnce(async function* () {
      yield { final: false, text: 'intermediate' };
      yield {
        final: true,
        text: 'grounded response',
        groundingMetadata: {
          groundingChunks: [
            { web: { uri: 'https://example.com/source', title: 'Example' } },
            { web: { title: 'No URL' } },
          ],
        },
      };
    });

    const generator = new AdkGenerator(config);
    const result = await generator.generate({
      input: [
        { type: 'text', text: 'transcribe this' },
        { type: 'audio', data: 'cmlmZg==', format: 'wav' },
      ],
      webSearch: true,
    });

    expect(adk.Runner).toHaveBeenCalledWith(expect.objectContaining({
      sessionService: expect.objectContaining({
        createSession: adk.sessionService.createSession,
        deleteSession: adk.sessionService.deleteSession,
      }),
    }));
    const runnerOptions = adk.runAsync.mock.calls[0]?.[0] as { newMessage: { parts: unknown[] } };
    expect(runnerOptions.newMessage.parts).toEqual([
      { text: 'transcribe this' },
      { inlineData: { data: 'cmlmZg==', mimeType: 'audio/wav' } },
    ]);
    expect(result).toEqual({
      text: 'grounded response',
      citations: [{ url: 'https://example.com/source', title: 'Example' }],
    });
    expect(adk.stringifyContent).toHaveBeenCalledTimes(1);
    expect(adk.sessionService.createSession).toHaveBeenCalledTimes(1);
    expect(adk.sessionService.deleteSession).toHaveBeenCalledTimes(1);
  });

  it('maps ADK error events to LlmError without exposing the configured key', async () => {
    adk.runAsync.mockImplementationOnce(async function* () {
      yield { errorCode: '429', errorMessage: 'Rejected unit-test-placeholder' };
    });
    const generator = new AdkGenerator(config);
    const result = generator.generate({ input: 'input' }).catch((error: unknown) => error);
    const error = await result;

    expect(error).toBeInstanceOf(LlmError);
    expect(error).toMatchObject({ kind: 'http', status: 429 });
    expect((error as Error).message).not.toContain(config.apiKey);
    expect(adk.sessionService.deleteSession).toHaveBeenCalled();
  });

  it('logs safe request metadata and redacts echoed request content from ADK errors', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const system = 'private system instructions';
    const text = 'private user text';
    const audio = 'cHJpdmF0ZSBhdWRpbw==';
    adk.runAsync.mockImplementationOnce(async function* () {
      yield {
        errorCode: 'MALFORMED_RESPONSE',
        errorMessage: `Failure ${config.apiKey} ${system} ${text} ${audio}`,
      };
    });
    const generator = new AdkGenerator(config);

    const result = generator.generate({
      system,
      input: [
        { type: 'text', text },
        { type: 'audio', data: audio, format: 'wav' },
      ],
    }).catch((error: unknown) => error);
    const error = await result;

    expect(error).toMatchObject({
      kind: 'http',
      message: 'ADK/Gemini retornou MALFORMED_RESPONSE: Failure [redacted] [redacted] [redacted] [redacted]',
    });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[1]).toMatchObject({
      model: config.model,
      input: {
        inputKinds: ['text', 'audio'],
        audioMimeTypes: ['audio/wav'],
        audioByteLengths: [Buffer.from(audio, 'base64').byteLength],
      },
      errorCode: 'MALFORMED_RESPONSE',
    });
    const loggedOutput = JSON.stringify(log.mock.calls);
    expect(loggedOutput).not.toContain(config.apiKey);
    expect(loggedOutput).not.toContain(system);
    expect(loggedOutput).not.toContain(text);
    expect(loggedOutput).not.toContain(audio);
    log.mockRestore();
  });

  it('logs allowlisted metadata from failed model responses without logging response content', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = {
      errorCode: 'MALFORMED_RESPONSE',
      modelVersion: 'gemini-3.5-flash-lite-001',
      finishReason: 'STOP',
      usageMetadata: {
        promptTokenCount: 23,
        candidatesTokenCount: 0,
        totalTokenCount: 23,
      },
      content: { parts: [{ text: 'private model response content' }] },
    };
    adk.runAsync.mockImplementationOnce(async function* () {
      expect(runAfterModelCallback(response)).toBeUndefined();
      yield { errorCode: 'MALFORMED_RESPONSE', errorMessage: 'provider detail' };
    });
    const generator = new AdkGenerator(config);

    await expect(generator.generate({ input: 'input' })).rejects.toMatchObject({ kind: 'http' });

    expect(response.content.parts[0]?.text).toBe('private model response content');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[1]).toMatchObject({
      responseMetadata: {
        modelVersion: 'gemini-3.5-flash-lite-001',
        finishReason: 'STOP',
        promptTokenCount: 23,
        candidatesTokenCount: 0,
        totalTokenCount: 23,
      },
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('private model response content');
    log.mockRestore();
  });

  it('omits unavailable response metadata and does not capture metadata from successful responses', async () => {
    const failureLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    adk.runAsync.mockImplementationOnce(async function* () {
      expect(runAfterModelCallback({ errorCode: 'MALFORMED_RESPONSE', finishReason: 'MALFORMED_RESPONSE' })).toBeUndefined();
      yield { errorCode: 'MALFORMED_RESPONSE', errorMessage: 'MALFORMED_RESPONSE' };
    });
    const generator = new AdkGenerator(config);

    await expect(generator.generate({ input: 'input' })).rejects.toMatchObject({ kind: 'http' });
    expect(failureLog).toHaveBeenCalledTimes(1);
    expect(failureLog.mock.calls[0]?.[1]).not.toHaveProperty('responseMetadata');
    failureLog.mockRestore();

    const successLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    adk.runAsync.mockImplementationOnce(async function* () {
      expect(runAfterModelCallback({
        modelVersion: 'gemini-3.5-flash-lite-001',
        usageMetadata: { promptTokenCount: 23 },
      })).toBeUndefined();
      yield { final: true, text: 'generated text' };
    });

    await expect(generator.generate({ input: 'input' })).resolves.toMatchObject({ text: 'generated text' });
    expect(successLog).not.toHaveBeenCalled();
    successLog.mockRestore();
  });

  it('logs thrown provider errors once and redacts echoed request text', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const text = 'private claim content';
    adk.runAsync.mockImplementationOnce(async function* () {
      throw new Error(`provider failure: ${text}`);
    });
    const generator = new AdkGenerator(config);

    await expect(generator.generate({ input: [{ type: 'text', text }] })).rejects.toMatchObject({
      kind: 'http',
      message: 'Erro ao consultar o ADK/Gemini: provider failure: [redacted]',
    });

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[1]).toMatchObject({
      model: config.model,
      errorName: 'Error',
      detail: 'provider failure: [redacted]',
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(text);
    log.mockRestore();
  });

  it('does not stringify unsupported thrown values into diagnostics', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    adk.runAsync.mockImplementationOnce(async function* () {
      throw { toString: () => 'unsafe thrown value' };
    });
    const generator = new AdkGenerator(config);

    await expect(generator.generate({ input: 'input' })).rejects.toMatchObject({
      kind: 'http',
      message: 'Erro ao consultar o ADK/Gemini',
    });

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[1]).toMatchObject({ errorName: 'UnknownError' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('unsafe thrown value');
    log.mockRestore();
  });

  it('does not repeat an ADK error detail identical to its code', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    adk.runAsync.mockImplementationOnce(async function* () {
      yield { errorCode: 'MALFORMED_RESPONSE', errorMessage: 'MALFORMED_RESPONSE' };
    });
    const generator = new AdkGenerator(config);

    await expect(generator.generate({ input: 'input' })).rejects.toMatchObject({
      message: 'ADK/Gemini retornou MALFORMED_RESPONSE',
    });

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[1]).not.toHaveProperty('detail');
    log.mockRestore();
  });

  it('reports an empty final response as a parse error and deletes the session', async () => {
    adk.stringifyContent.mockReturnValueOnce('   ');
    const generator = new AdkGenerator(config);

    await expect(generator.generate({ input: 'input' })).rejects.toMatchObject({ kind: 'parse' });
    expect(adk.sessionService.deleteSession).toHaveBeenCalledTimes(1);
  });

  it('reports configured timeout and cleans up the temporary session', async () => {
    adk.runAsync.mockImplementationOnce(async function* ({ abortSignal }: { abortSignal: AbortSignal }) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (abortSignal.aborted) throw new Error('aborted');
      yield { final: true, text: 'late response' };
    });
    const generator = new AdkGenerator({ ...config, timeoutMs: 1 });

    await expect(generator.generate({ input: 'input' })).rejects.toMatchObject({ kind: 'timeout' });
    expect(adk.sessionService.deleteSession).toHaveBeenCalledTimes(1);
  });

  it('preserves caller abort rejection and deletes the temporary session', async () => {
    const abortError = new Error('caller aborted');
    adk.runAsync.mockImplementationOnce(async function* ({ abortSignal }: { abortSignal: AbortSignal }) {
      if (abortSignal.aborted) throw abortError;
      yield { final: true, text: 'unexpected response' };
    });
    const abortController = new AbortController();
    abortController.abort();
    const generator = new AdkGenerator(config);

    await expect(generator.generate({ input: 'input', signal: abortController.signal })).rejects.toBe(abortError);
    expect(adk.sessionService.deleteSession).toHaveBeenCalledTimes(1);
  });
});
