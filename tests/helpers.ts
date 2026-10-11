import type { Claim, Session, CheckResult, ExtractedClaim, TopicSuggestion, ProviderMode } from '../src/shared/schemas';
import type { MediaController, Services, SessionStore } from '../src/session-manager';
import type { FactCheckProvider } from '../src/fact-check-provider';
import type { GenerateOptions, LlmOutput, TextGenerator } from '../server/src/llm';

export const memoryStore = (): SessionStore & { data: Session | null } => {
  const st = {
    data: null as Session | null,
    async load() { return st.data ? structuredClone(st.data) : null; },
    async save(s: Session) { st.data = structuredClone(s); },
    async clear() { st.data = null; },
  };
  return st;
};

export const fakeMedia = () => {
  const calls: string[] = [];
  const m: MediaController & { calls: string[]; failStart?: boolean } = {
    calls,
    async start() { if (m.failStart) throw new Error('sem permissão'); calls.push('start'); },
    async pause() { calls.push('pause'); },
    async resume() { calls.push('resume'); },
    async stop() { calls.push('stop'); },
  };
  return m;
};

export const okResult = (status: CheckResult['status'] = 'supported'): CheckResult => ({
  status, summary: 'ok', evidence: [{ url: 'https://ex.com/a', title: 'ex.com' }], limitations: [],
  provider: { id: 'fake', name: 'Fake' }, query: 'q', checkedAt: 1,
});

export interface Deferred<T> { promise: Promise<T>; resolve(v: T): void; reject(e: unknown): void }
export const deferred = <T>(): Deferred<T> => {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

export const flush = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

export function fakeServices(opts: {
  suggestions?: TopicSuggestion[];
  claims?: (topicId: string) => ExtractedClaim[];
  check?: FactCheckProvider['check'];
  manual?: FactCheckProvider['check'];
} = {}): Services {
  return {
    classifier: { classify: async () => opts.suggestions ?? [{ title: 'Economia' }] },
    extractor: { extract: async (_t, topics) => (opts.claims ?? ((id) => [{ text: 'A inflação caiu em 2023', quote: 'a inflação caiu', kind: 'factual', topicId: id }]))((topics[0] as { id: string }).id) },
    providers: {
      grounded: { id: 'g', name: 'G', check: opts.check ?? (async () => okResult()) },
      manual: { id: 'm', name: 'M', check: opts.manual ?? (async () => ({ ...okResult('manual'), evidence: [] })) },
    } as Record<ProviderMode, FactCheckProvider>,
  };
}

export const claimOf = (p: Partial<Claim> = {}): Claim => ({
  id: 'c1', sessionId: 's', segmentId: 's:1', topicId: 't1', text: 'texto', quote: 'q', context: 'c', kind: 'factual',
  offsetMs: 0, createdAt: 0, status: 'pending', attempts: 0, ...p,
});

/** Gerador de texto falso para o backend: devolve respostas enfileiradas e registra chamadas. */
export const fakeGenerator = (...texts: (string | Error | LlmOutput)[]) => {
  const calls: GenerateOptions[] = [];
  const gen: TextGenerator & { calls: GenerateOptions[] } = {
    calls,
    async generate(o: GenerateOptions) {
      calls.push(o);
      const next = texts.length > 1 ? texts.shift() : texts[0];
      if (next instanceof Error) throw next;
      if (typeof next === 'string') return { text: next, citations: [] };
      return next as LlmOutput;
    },
  };
  return gen;
};
