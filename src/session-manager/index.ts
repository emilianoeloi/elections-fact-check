import type { Claim, CheckResult, ProviderMode, Session } from '../shared/schemas';
import { claimId, jaccard, segmentId } from '../shared/text';
import { BackendError } from '../shared/backend';
import { buildContextualQuery } from '../shared/aimode';
import type { TopicClassifier } from '../topic-classifier';
import { resolveTopics } from '../topic-classifier';
import type { ClaimExtractor } from '../claim-extractor';
import { findDuplicate } from '../claim-extractor';
import type { FactCheckProvider } from '../fact-check-provider';
import { TaskQueue } from '../fact-check-provider/queue';

export interface SessionStore {
  load(): Promise<Session | null>;
  save(s: Session): Promise<void>;
  clear(): Promise<void>;
}

/** Controla a captura real (offscreen document). */
export interface MediaController {
  start(sessionId: string, tabId: number): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
}

export interface Services {
  classifier: TopicClassifier;
  extractor: ClaimExtractor;
  providers: Record<ProviderMode, FactCheckProvider>;
}

export interface SessionDeps {
  store: SessionStore;
  media: MediaController;
  /** Chamado a cada operação para refletir mudanças de configuração. */
  services: () => Services | Promise<Services>;
  now?: () => number;
  uuid?: () => string;
  /** Mínimo de caracteres novos para disparar uma análise. */
  analyzeMinChars?: number;
  concurrency?: number;
  checkTimeoutMs?: number;
  maxSegments?: number;
}

const WINDOW_MAX_CHARS = 2000;

export class SessionManager {
  private s: Session | null = null;
  private abort = new AbortController();
  private queue: TaskQueue;
  private analysis: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  private readonly uuid: () => string;

  constructor(private deps: SessionDeps) {
    this.now = deps.now ?? Date.now;
    this.uuid = deps.uuid ?? (() => crypto.randomUUID());
    this.queue = this.newQueue();
  }

  get session(): Session | null {
    return this.s;
  }

  private newQueue() {
    return new TaskQueue(this.deps.concurrency ?? 3, this.deps.checkTimeoutMs ?? 60_000);
  }

  private async commit() {
    if (this.s) await this.deps.store.save(structuredClone(this.s));
  }

  /** Recupera a sessão persistida (ex.: service worker reiniciado) e retoma checagens pendentes. */
  async restore(): Promise<Session | null> {
    this.s = await this.deps.store.load();
    if (this.s && this.s.state !== 'ended') {
      for (const c of Object.values(this.s.claims)) if (c.status === 'pending') void this.enqueueCheck(c);
    }
    return this.s;
  }

  async start(target: { tabId: number; title: string }, mode: ProviderMode): Promise<Session> {
    if (this.s && this.s.state !== 'ended') throw new Error('Já existe uma sessão ativa');
    this.abort = new AbortController();
    this.queue = this.newQueue();
    const id = this.uuid();
    this.s = {
      id, state: 'capturing', tabId: target.tabId, tabTitle: target.title, startedAt: this.now(),
      segments: [], analyzedSeq: 0, topics: {}, claims: {}, providerMode: mode,
    };
    await this.commit();
    try {
      await this.deps.media.start(id, target.tabId);
    } catch (e) {
      await this.end();
      this.s.lastError = e instanceof Error ? e.message : 'Falha ao iniciar a captura';
      await this.commit();
      throw e;
    }
    return this.s;
  }

  async pause() {
    if (this.s?.state !== 'capturing') return;
    this.s.state = 'paused';
    await this.deps.media.pause();
    await this.commit();
  }

  async resume() {
    if (this.s?.state !== 'paused') return;
    this.s.state = 'capturing';
    await this.deps.media.resume();
    await this.commit();
  }

  /** Encerra imediatamente: para a captura, cancela análises e checagens em andamento. */
  async end() {
    const s = this.s;
    if (!s || s.state === 'ended') return;
    s.state = 'ended';
    s.endedAt = this.now();
    this.abort.abort();
    this.queue.cancelAll();
    for (const c of Object.values(s.claims)) {
      if (c.status === 'pending') {
        c.status = 'error';
        c.result = this.errorResult(c, 'A checagem foi cancelada ao encerrar a sessão.');
      }
    }
    await this.deps.media.stop().catch(() => undefined);
    await this.commit();
  }

  async reset() {
    if (this.s && this.s.state !== 'ended') await this.end();
    this.s = null;
    await this.deps.store.clear();
  }

  setError(message: string) {
    if (!this.s) return;
    this.s.lastError = message;
    return this.commit();
  }

  /** Recebe uma fala transcrita. Retorna sem esperar análise nem checagens. */
  async ingestSegment(sessionId: string, text: string, offsetMs: number): Promise<void> {
    const s = this.s;
    if (!s || s.id !== sessionId || s.state !== 'capturing') return; // pausada/encerrada: descarta
    const clean = text.trim();
    if (!clean) return;
    const seq = (s.segments.at(-1)?.seq ?? 0) + 1;
    s.segments.push({ id: segmentId(s.id, seq), sessionId: s.id, seq, text: clean, offsetMs, at: this.now() });
    const max = this.deps.maxSegments ?? 300;
    if (s.segments.length > max) s.segments.splice(0, s.segments.length - max);
    await this.commit();
    this.analysis = this.analysis.then(() => this.runAnalysis(s.id)).catch(() => undefined);
  }

  private async runAnalysis(sessionId: string): Promise<void> {
    const s = this.s;
    if (!s || s.id !== sessionId || s.state === 'ended') return;
    const fresh = s.segments.filter((g) => g.seq > s.analyzedSeq);
    if (fresh.reduce((n, g) => n + g.text.length, 0) < (this.deps.analyzeMinChars ?? 400)) return;

    const lastSeq = fresh.at(-1)?.seq ?? s.analyzedSeq;
    const prev = s.segments.filter((g) => g.seq <= s.analyzedSeq).slice(-1);
    const window = [...prev, ...fresh].map((g) => g.text).join(' ').slice(-WINDOW_MAX_CHARS);
    const { classifier, extractor } = await this.deps.services();
    const signal = this.abort.signal;

    try {
      const known = Object.values(s.topics).map((t) => ({ id: t.id, title: t.title }));
      const suggestions = await classifier.classify(window, known, signal);
      if (signal.aborted) return;
      const topics = resolveTopics(s.id, s.topics, suggestions, this.now());
      const extracted = await extractor.extract(window, topics.map((t) => ({ id: t.id, title: t.title })), signal);
      if (signal.aborted) return;

      for (const e of extracted) {
        const dup = findDuplicate(s.id, s.claims, e.text);
        const topic = s.topics[e.topicId] ?? topics[0];
        if (!topic) continue;
        topic.lastActiveAt = this.now();
        if (dup) continue;
        const seg = this.bestSegment(fresh, e.quote);
        const id = claimId(s.id, e.text);
        const factual = e.kind === 'factual';
        const claim: Claim = {
          id, sessionId: s.id, segmentId: seg.id, topicId: topic.id, text: e.text, quote: e.quote,
          context: window.slice(-500), kind: e.kind, period: e.period || undefined, region: e.region || undefined,
          offsetMs: seg.offsetMs, createdAt: this.now(), status: factual ? 'pending' : 'not_checkable', attempts: 0,
        };
        s.claims[id] = claim;
        topic.claimIds.push(id);
      }
      s.analyzedSeq = lastSeq;
      s.lastError = undefined;
      await this.commit();
      for (const c of Object.values(s.claims)) if (c.status === 'pending' && c.attempts === 0 && !this.inFlight.has(c.id)) void this.enqueueCheck(c);
    } catch (e) {
      if (signal.aborted) return;
      s.lastError = e instanceof BackendError ? `Análise de assuntos: ${e.message}` : 'Falha ao analisar a transcrição';
      await this.commit(); // analyzedSeq não avança: tenta de novo com a próxima fala
    }
  }

  private bestSegment(segs: Session['segments'], quote: string) {
    let best = segs[segs.length - 1] as Session['segments'][number];
    let score = -1;
    for (const g of segs) {
      const sc = jaccard(g.text, quote);
      if (sc > score) { score = sc; best = g; }
    }
    return best;
  }

  private inFlight = new Set<string>();

  private errorResult(c: Claim, message: string, providerId = 'n/d'): CheckResult {
    return {
      status: 'error', summary: message, evidence: [], limitations: [],
      provider: { id: providerId, name: providerId }, query: this.queryFor(c), checkedAt: this.now(),
    };
  }

  private queryFor(c: Claim) {
    const topic = this.s?.topics[c.topicId]?.title;
    return buildContextualQuery({ text: c.text, context: c.context, topic, period: c.period, region: c.region });
  }

  /** Executa a checagem em segundo plano; a UI nunca espera por isto. */
  private async enqueueCheck(c: Claim): Promise<void> {
    const s = this.s;
    if (!s || s.state === 'ended' || this.inFlight.has(c.id)) return;
    const sessionId = s.id;
    this.inFlight.add(c.id);
    const queue = this.queue;
    const mode = s.providerMode;
    try {
      const { providers } = await this.deps.services();
      const provider = providers[mode];
      const req = { claim: c.text, context: c.context, topic: s.topics[c.topicId]?.title ?? '', period: c.period, region: c.region };
      let result: CheckResult;
      try {
        result = await queue.run(async (signal) => {
          try {
            return await provider.check(req, signal);
          } catch (e) {
            if (e instanceof BackendError && e.transient && !signal.aborted) return provider.check(req, signal); // 1 nova tentativa
            throw e;
          }
        });
      } catch (e) {
        if (this.s?.id !== sessionId || this.s.state === 'ended') return;
        const msg = e instanceof BackendError ? e.message : e instanceof DOMException ? 'Tempo esgotado ou cancelado' : 'Falha inesperada na checagem';
        result = this.errorResult(c, msg, provider.id);
      }
      const cur = this.s;
      if (!cur || cur.id !== sessionId || cur.state === 'ended') return; // sessão trocada/encerrada: descarta
      const live = cur.claims[c.id];
      if (!live) return;
      live.attempts += 1;
      live.status = result.status;
      live.result = result;
      await this.commit();
    } finally {
      this.inFlight.delete(c.id);
    }
  }

  async recheck(claimId: string) {
    const c = this.s?.claims[claimId];
    if (!this.s || this.s.state === 'ended' || !c || c.kind !== 'factual' || this.inFlight.has(c.id)) return;
    c.status = 'pending';
    c.result = undefined;
    await this.commit();
    void this.enqueueCheck(c);
  }

  async markAiModeOpened(claimId: string) {
    const c = this.s?.claims[claimId];
    if (!c) return;
    c.aiModeOpenedAt = this.now();
    await this.commit();
  }
}
