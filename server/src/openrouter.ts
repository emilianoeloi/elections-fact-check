import { LlmError, type Citation, type GenerateOptions, type LlmOutput, type TextGenerator } from './llm';

/**
 * Cliente do OpenRouter (API compatível com OpenAI Chat Completions).
 * Docs: openrouter.ai/docs/features/multimodal/audio e /docs/features/web-search.
 * ATENÇÃO: não foi exercitado contra a API real nesta entrega; ver README.
 */
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('abort')); }, { once: true });
  });

/** Texto de erro do OpenRouter, curto e sem caracteres de controle (nunca o corpo inteiro). */
function errorDetail(body: unknown): string | undefined {
  if (!isObj(body) || !isObj(body.error)) return undefined;
  const m = body.error.message;
  if (typeof m !== 'string') return undefined;
  const clean = m.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
  return clean || undefined;
}

/** Extrai texto e citações de uma resposta de chat completions. */
export function parseChatCompletion(body: unknown): LlmOutput {
  if (isObj(body) && body.error) throw new LlmError(`OpenRouter: ${errorDetail(body) ?? 'erro do provedor'}`, 'http', typeof (body.error as { code?: unknown }).code === 'number' ? ((body.error as { code: number }).code) : 502);
  const msg = isObj(body) && Array.isArray(body.choices) && isObj(body.choices[0]) ? (body.choices[0] as Record<string, unknown>).message : undefined;
  if (!isObj(msg)) throw new LlmError('Resposta inesperada do OpenRouter', 'parse');

  let text = '';
  if (typeof msg.content === 'string') text = msg.content;
  else if (Array.isArray(msg.content)) text = msg.content.map((p) => (isObj(p) && typeof p.text === 'string' ? p.text : '')).join('');
  if (!text.trim()) throw new LlmError('Resposta vazia do OpenRouter', 'parse');

  const citations: Citation[] = [];
  if (Array.isArray(msg.annotations)) {
    for (const a of msg.annotations) {
      if (!isObj(a) || a.type !== 'url_citation' || !isObj(a.url_citation) || typeof a.url_citation.url !== 'string') continue;
      const c = a.url_citation;
      citations.push({
        url: c.url as string,
        title: typeof c.title === 'string' && c.title ? c.title : (c.url as string),
        startIndex: typeof c.start_index === 'number' ? c.start_index : undefined,
        endIndex: typeof c.end_index === 'number' ? c.end_index : undefined,
      });
    }
  }
  return { text, citations };
}

export interface OpenRouterConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
  /** `native`, `exa`, etc.; vazio = padrão do OpenRouter (nativa para modelos Google). */
  webEngine?: string;
  /** Resultados de busca injetados no prompt (padrão do OpenRouter é 5). */
  webMaxResults?: number;
  /** Envia `reasoning.effort` quando a chamada o pede. */
  sendReasoning?: boolean;
  baseUrl?: string;
}

export class OpenRouterClient implements TextGenerator {
  constructor(
    private cfg: OpenRouterConfig,
    private fetchImpl: typeof fetch = fetch,
    private maxRetries = 2,
    private retryDelayMs = 700,
  ) {}

  get configured(): boolean {
    return this.cfg.apiKey.length > 0;
  }

  async generate(opts: GenerateOptions): Promise<LlmOutput> {
    if (!this.configured) throw new LlmError('OPENROUTER_API_KEY não configurada no backend', 'config');

    const userContent =
      typeof opts.input === 'string'
        ? opts.input
        : opts.input.map((p) => (p.type === 'text' ? p : { type: 'input_audio', input_audio: { data: p.data, format: p.format } }));
    const messages: unknown[] = [];
    if (opts.system) messages.push({ role: 'system', content: opts.system });
    messages.push({ role: 'user', content: userContent });

    const body: Record<string, unknown> = { model: this.cfg.model, messages };
    if (opts.temperature !== undefined) body.temperature = opts.temperature;
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;
    if (opts.reasoning && this.cfg.sendReasoning !== false) body.reasoning = { effort: opts.reasoning };
    if (opts.webSearch) {
      body.plugins = [{ id: 'web', ...(this.cfg.webEngine ? { engine: this.cfg.webEngine } : {}), ...(this.cfg.webMaxResults ? { max_results: this.cfg.webMaxResults } : {}) }];
    }

    const timeout = AbortSignal.timeout(this.cfg.timeoutMs);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    const url = `${this.cfg.baseUrl ?? 'https://openrouter.ai/api/v1'}/chat/completions`;

    let res: Response | undefined;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await this.fetchImpl(url, {
          method: 'POST',
          headers: { authorization: `Bearer ${this.cfg.apiKey}`, 'content-type': 'application/json', 'x-title': 'FactCheck Live' },
          body: JSON.stringify(body),
          signal,
        });
      } catch (e) {
        if (timeout.aborted) throw new LlmError('Tempo esgotado ao consultar o OpenRouter', 'timeout');
        if (opts.signal?.aborted) throw e;
        throw new LlmError('Falha de rede ao consultar o OpenRouter', 'http');
      }
      // Alguns modelos rejeitam `reasoning`: repete uma vez sem o parâmetro (não conta como nova tentativa).
      if (res.status === 400 && 'reasoning' in body) {
        const detail = errorDetail(await res.clone().json().catch(() => undefined)) ?? '';
        if (/reason|thinking/i.test(detail)) {
          delete body.reasoning;
          attempt--;
          continue;
        }
      }
      // Sobrecarga/limite momentâneo: tenta de novo com espera crescente.
      if (RETRYABLE.has(res.status) && attempt < this.maxRetries) {
        await sleep(this.retryDelayMs * 2 ** attempt, signal).catch(() => undefined);
        if (signal.aborted) throw new LlmError('Tempo esgotado ao consultar o OpenRouter', 'timeout');
        continue;
      }
      break;
    }

    const json: unknown = await res.json().catch(() => undefined);
    if (!res.ok) {
      const detail = errorDetail(json);
      throw new LlmError(`OpenRouter respondeu ${res.status}${detail ? `: ${detail}` : ''}`, 'http', res.status);
    }
    return parseChatCompletion(json);
  }
}
