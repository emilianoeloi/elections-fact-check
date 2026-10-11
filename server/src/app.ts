import Fastify, { type FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import {
  CheckRequest,
  ClaimsRequest,
  TopicsRequest,
  type HealthResponse,
} from '../../src/shared/schemas';
import type { Transcriber } from './transcriber';
import type { TopicClassifier } from './topic-classifier';
import type { ClaimExtractor } from './claim-extractor';
import { ProviderError, type FactCheckProvider } from './web-search-provider';
import { LlmError } from './llm';

export interface AppDeps {
  token: string;
  model: string;
  configured: boolean;
  transcriber: Transcriber;
  classifier: TopicClassifier;
  extractor: ClaimExtractor;
  provider: FactCheckProvider;
}

const safeEqual = (a: string, b: string) => {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
};

const publicError = (e: unknown): { status: number; message: string } => {
  if (e instanceof ProviderError || e instanceof LlmError) {
    const status = e.kind === 'timeout' ? 504 : e.kind === 'config' ? 503 : 502;
    return { status, message: e.message };
  }
  return { status: 500, message: 'Erro interno' }; // nunca vaza detalhes/segredos
};

export function buildApp(deps: AppDeps): FastifyInstance {
  // logger desligado por padrão: transcrições e afirmações não devem ir para logs.
  const app = Fastify({ logger: false, bodyLimit: 8 * 1024 * 1024 });

  app.addContentTypeParser(/^audio\//, { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health' || !deps.token) return;
    const given = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!safeEqual(given, deps.token)) return reply.code(401).send({ error: 'Não autorizado' });
  });

  app.get('/health', async (): Promise<HealthResponse> => ({ ok: true, providers: { grounded: deps.configured }, model: deps.model }));

  // Cancela o trabalho só se o cliente desconectar ANTES de a resposta terminar.
  // (O 'close' da requisição dispara também em requisições normais, por isso observamos a resposta.)
  const abortOnClose = (reply: { raw: import('node:http').ServerResponse }) => {
    const ac = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) ac.abort();
    });
    return ac.signal;
  };

  app.post('/v1/transcribe', async (req, reply) => {
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) return reply.code(400).send({ error: 'Áudio ausente' });
    try {
      const text = await deps.transcriber.transcribe(body, String(req.headers['content-type'] ?? 'audio/webm'), abortOnClose(reply));
      return { text };
    } catch (e) {
      const { status, message } = publicError(e);
      return reply.code(status).send({ error: message });
    }
  });

  app.post('/v1/topics', async (req, reply) => {
    const p = TopicsRequest.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'Requisição inválida' });
    try {
      return { topics: await deps.classifier.classify(p.data.text, p.data.knownTopics, abortOnClose(reply)) };
    } catch (e) {
      const { status, message } = publicError(e);
      return reply.code(status).send({ error: message });
    }
  });

  app.post('/v1/claims', async (req, reply) => {
    const p = ClaimsRequest.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'Requisição inválida' });
    try {
      return { claims: await deps.extractor.extract(p.data.text, p.data.topics, abortOnClose(reply)) };
    } catch (e) {
      const { status, message } = publicError(e);
      return reply.code(status).send({ error: message });
    }
  });

  app.post('/v1/check', async (req, reply) => {
    const p = CheckRequest.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'Requisição inválida' });
    try {
      return { result: await deps.provider.check(p.data, abortOnClose(reply)) };
    } catch (e) {
      const { status, message } = publicError(e);
      return reply.code(status).send({ error: message });
    }
  });

  return app;
}
