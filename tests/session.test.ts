import { describe, expect, it } from 'vitest';
import { SessionManager } from '../src/session-manager';
import { BackendError } from '../src/shared/backend';
import { deferred, fakeMedia, fakeServices, flush, memoryStore, okResult } from './helpers';

const LONG = 'A inflação caiu em 2023 segundo o governo e isso foi muito importante para as famílias brasileiras que sofreram nos anos anteriores com a alta dos preços dos alimentos, da energia e dos combustíveis em todas as regiões do país. Os analistas também apontaram que a renda média subiu e que o emprego formal cresceu em todos os estados, segundo os dados oficiais divulgados nesta semana pelo instituto de estatística.';

function setup(services = fakeServices(), extra: object = {}) {
  const store = memoryStore();
  const media = fakeMedia();
  let n = 0;
  const m = new SessionManager({ store, media, services: () => services, uuid: () => `sess${++n}`, ...extra });
  return { m, store, media };
}
const target = { tabId: 7, title: 'Globoplay' };

describe('ciclo de vida da sessão', () => {
  it('só inicia captura com start() explícito; restore() não inicia nada', async () => {
    const { m, media } = setup();
    expect(await m.restore()).toBeNull();
    expect(media.calls).toEqual([]);
    const s = await m.start(target, 'grounded');
    expect(s.state).toBe('capturing');
    expect(media.calls).toEqual(['start']);
  });
  it('recusa segunda sessão simultânea', async () => {
    const { m } = setup();
    await m.start(target, 'grounded');
    await expect(m.start(target, 'grounded')).rejects.toThrow(/ativa/);
  });
  it('falha ao capturar encerra a sessão e informa o erro', async () => {
    const { m, media } = setup();
    media.failStart = true;
    await expect(m.start(target, 'grounded')).rejects.toThrow('sem permissão');
    expect(m.session?.state).toBe('ended');
    expect(m.session?.lastError).toBe('sem permissão');
  });
  it('pausa descarta falas; retoma volta a aceitar', async () => {
    const { m, media } = setup();
    const s = await m.start(target, 'grounded');
    await m.pause();
    await m.ingestSegment(s.id, 'fala durante pausa', 1000);
    expect(m.session?.segments).toHaveLength(0);
    await m.resume();
    await m.ingestSegment(s.id, 'fala depois', 2000);
    expect(m.session?.segments).toHaveLength(1);
    expect(media.calls).toEqual(['start', 'pause', 'resume']);
  });
  it('encerrar para a captura, marca encerrada e ignora falas posteriores', async () => {
    const { m, media } = setup();
    const s = await m.start(target, 'grounded');
    await m.end();
    expect(m.session?.state).toBe('ended');
    expect(media.calls).toContain('stop');
    await m.ingestSegment(s.id, 'tarde demais', 1);
    expect(m.session?.segments).toHaveLength(0);
  });
  it('ignora falas de outra sessão', async () => {
    const { m } = setup();
    await m.start(target, 'grounded');
    await m.ingestSegment('outra', 'texto', 1);
    expect(m.session?.segments).toHaveLength(0);
  });
  it('reset limpa o armazenamento', async () => {
    const { m, store } = setup();
    await m.start(target, 'grounded');
    await m.reset();
    expect(store.data).toBeNull();
    expect(m.session).toBeNull();
  });
});

describe('pipeline assíncrono', () => {
  it('transcrição → tópico → afirmação pendente → resultado, sem bloquear novas falas', async () => {
    const gate = deferred<ReturnType<typeof okResult>>();
    const { m } = setup(fakeServices({ check: () => gate.promise }));
    const s = await m.start(target, 'grounded');
    await m.ingestSegment(s.id, LONG, 5000);
    await flush();

    const topic = Object.values(m.session!.topics)[0]!;
    const claim = Object.values(m.session!.claims)[0]!;
    expect(topic.title).toBe('Economia');
    expect(topic.claimIds).toEqual([claim.id]);
    expect(claim.status).toBe('pending'); // ⏳ enquanto a pesquisa roda
    expect(claim.offsetMs).toBe(5000);

    // Nova fala é aceita enquanto a checagem continua pendente.
    await m.ingestSegment(s.id, 'mais uma fala', 9000);
    expect(m.session!.segments).toHaveLength(2);
    expect(m.session!.claims[claim.id]?.status).toBe('pending');

    gate.resolve(okResult('contradicted'));
    await flush();
    expect(m.session!.claims[claim.id]).toMatchObject({ status: 'contradicted', attempts: 1 });
    expect(m.session!.claims[claim.id]?.result?.evidence).toHaveLength(1);
  });
  it('não analisa antes de acumular texto suficiente', async () => {
    const { m } = setup();
    const s = await m.start(target, 'grounded');
    await m.ingestSegment(s.id, 'oi', 1);
    await flush();
    expect(Object.keys(m.session!.claims)).toHaveLength(0);
  });
  it('reutiliza tópico e não duplica afirmação repetida em janelas seguintes', async () => {
    const { m } = setup();
    const s = await m.start(target, 'grounded');
    await m.ingestSegment(s.id, LONG, 1000);
    await flush();
    await m.ingestSegment(s.id, LONG + ' repetindo', 20000);
    await flush();
    expect(Object.keys(m.session!.topics)).toHaveLength(1);
    expect(Object.keys(m.session!.claims)).toHaveLength(1);
  });
  it('opiniões/previsões/promessas não são enviadas à checagem e não recebem veredito', async () => {
    let calls = 0;
    const { m } = setup(fakeServices({
      check: async () => { calls++; return okResult(); },
      claims: (id) => [
        { text: 'Este é o pior governo da história', quote: 'pior', kind: 'opinion', topicId: id },
        { text: 'A economia crescerá quatro por cento', quote: 'crescerá', kind: 'prediction', topicId: id },
        { text: 'Vamos zerar o déficit até 2026', quote: 'zerar', kind: 'promise', topicId: id },
      ],
    }));
    const s = await m.start(target, 'grounded');
    await m.ingestSegment(s.id, LONG, 1);
    await flush();
    const st = Object.values(m.session!.claims).map((c) => c.status);
    expect(st).toEqual(['not_checkable', 'not_checkable', 'not_checkable']);
    expect(calls).toBe(0);
  });
  it('modo manual: nenhum resultado fabricado — status "manual" sem fontes', async () => {
    const { m } = setup();
    const s = await m.start(target, 'manual');
    await m.ingestSegment(s.id, LONG, 1);
    await flush();
    const c = Object.values(m.session!.claims)[0]!;
    expect(c.status).toBe('manual');
    expect(c.result?.evidence).toEqual([]);
    expect(c.aiModeOpenedAt).toBeUndefined();
    await m.markAiModeOpened(c.id);
    expect(m.session!.claims[c.id]?.aiModeOpenedAt).toBeGreaterThan(0);
  });
});

describe('falhas dos provedores', () => {
  it('falha da checagem vira ! (error) sem derrubar a sessão; recheck funciona', async () => {
    let fail = true;
    const { m } = setup(fakeServices({ check: async () => { if (fail) throw new BackendError('backend caiu', 'http', 400); return okResult('supported'); } }));
    const s = await m.start(target, 'grounded');
    await m.ingestSegment(s.id, LONG, 1);
    await flush();
    const c = Object.values(m.session!.claims)[0]!;
    expect(c.status).toBe('error');
    expect(c.result?.summary).toBe('backend caiu');
    expect(m.session!.state).toBe('capturing');
    fail = false;
    await m.recheck(c.id);
    await flush();
    expect(m.session!.claims[c.id]?.status).toBe('supported');
  });
  it('falha transitória tem uma nova tentativa automática', async () => {
    let n = 0;
    const { m } = setup(fakeServices({ check: async () => { if (++n === 1) throw new BackendError('rede', 'network'); return okResult(); } }));
    const s = await m.start(target, 'grounded');
    await m.ingestSegment(s.id, LONG, 1);
    await flush();
    expect(n).toBe(2);
    expect(Object.values(m.session!.claims)[0]?.status).toBe('supported');
  });
  it('falha de classificação registra erro e tenta de novo na próxima fala, sem perder texto', async () => {
    const base = fakeServices();
    let broken = true;
    const services = { ...base, classifier: { classify: async (...a: Parameters<typeof base.classifier.classify>) => { if (broken) throw new BackendError('gemini fora', 'http', 502); return base.classifier.classify(...a); } } };
    const { m } = setup(services);
    const s = await m.start(target, 'grounded');
    await m.ingestSegment(s.id, LONG, 1);
    await flush();
    expect(m.session!.lastError).toContain('gemini fora');
    expect(m.session!.analyzedSeq).toBe(0);
    broken = false;
    await m.ingestSegment(s.id, 'continuação da fala', 2);
    await flush();
    expect(m.session!.lastError).toBeUndefined();
    expect(Object.keys(m.session!.claims)).toHaveLength(1);
  });
  it('respeita o limite de concorrência', async () => {
    let running = 0, peak = 0;
    const gates: (() => void)[] = [];
    const { m } = setup(fakeServices({
      claims: (id) => Array.from({ length: 6 }, (_, i) => ({ text: `Afirmação numérica distinta ${['alfa', 'beta', 'gama', 'delta', 'epsilon', 'zeta'][i]} número ${i * 97}`, quote: 'q', kind: 'factual' as const, topicId: id })),
      check: () => new Promise((res) => { running++; peak = Math.max(peak, running); gates.push(() => { running--; res(okResult()); }); }),
    }), { concurrency: 2 });
    const s = await m.start(target, 'grounded');
    await m.ingestSegment(s.id, LONG, 1);
    await flush();
    expect(peak).toBe(2);
    while (gates.length) { gates.shift()!(); await flush(); }
    expect(Object.values(m.session!.claims).every((c) => c.status === 'supported')).toBe(true);
    expect(peak).toBe(2);
  });
});

describe('cancelamento e persistência', () => {
  it('encerrar cancela checagens em andamento e descarta resultados tardios', async () => {
    let signalSeen: AbortSignal | undefined;
    const gate = deferred<ReturnType<typeof okResult>>();
    const { m } = setup(fakeServices({ check: (_r, signal) => { signalSeen = signal; return gate.promise; } }));
    const s = await m.start(target, 'grounded');
    await m.ingestSegment(s.id, LONG, 1);
    await flush();
    await m.end();
    expect(signalSeen?.aborted).toBe(true);
    expect(Object.values(m.session!.claims)[0]?.status).toBe('error');
    gate.resolve(okResult('supported')); // resultado tardio
    await flush();
    expect(Object.values(m.session!.claims)[0]?.status).toBe('error');
  });
  it('resultado de sessão antiga não contamina a nova', async () => {
    const gate = deferred<ReturnType<typeof okResult>>();
    const { m } = setup(fakeServices({ check: () => gate.promise }));
    const a = await m.start(target, 'grounded');
    await m.ingestSegment(a.id, LONG, 1);
    await flush();
    await m.end();
    await m.start(target, 'grounded');
    gate.resolve(okResult());
    await flush();
    expect(Object.keys(m.session!.claims)).toHaveLength(0);
  });
  it('persiste a cada mudança e restaura retomando checagens pendentes (sem reiniciar captura)', async () => {
    const gate = deferred<ReturnType<typeof okResult>>();
    const first = setup(fakeServices({ check: () => gate.promise }));
    const s = await first.m.start(target, 'grounded');
    await first.m.ingestSegment(s.id, LONG, 1);
    await flush();
    expect(first.store.data?.segments).toHaveLength(1);

    // "Service worker reiniciado": novo manager sobre o mesmo storage.
    const media2 = fakeMedia();
    let checks = 0;
    const m2 = new SessionManager({ store: first.store, media: media2, services: () => fakeServices({ check: async () => { checks++; return okResult(); } }) });
    const restored = await m2.restore();
    await flush();
    expect(restored?.id).toBe(s.id);
    expect(restored?.segments).toHaveLength(1);
    expect(media2.calls).toEqual([]); // não reinicia captura
    expect(checks).toBe(1);
    expect(Object.values(m2.session!.claims)[0]?.status).toBe('supported');
  });
  it('sessão encerrada restaurada não retoma nada', async () => {
    const a = setup();
    await a.m.start(target, 'grounded');
    await a.m.end();
    const m2 = new SessionManager({ store: a.store, media: fakeMedia(), services: () => fakeServices() });
    expect((await m2.restore())?.state).toBe('ended');
  });
});
