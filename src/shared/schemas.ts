import { z } from 'zod';

export const ClaimKind = z.enum(['factual', 'opinion', 'prediction', 'promise']);
export type ClaimKind = z.infer<typeof ClaimKind>;

/** Estados de veracidade. `pending`/`manual`/`not_checkable` não são vereditos. */
export const VerdictStatus = z.enum([
  'pending', // ⏳ pesquisa em andamento
  'supported', // ✓ evidências sustentam
  'contradicted', // ✕ evidências contradizem
  'partial', // ◐ parcialmente sustentada / enganosa
  'insufficient', // ? evidências insuficientes
  'error', // ! falha técnica
  'not_checkable', // opinião, previsão ou promessa
  'manual', // consulta manual no Google AI Mode (sem resultado)
]);
export type VerdictStatus = z.infer<typeof VerdictStatus>;

/** Estados que um provedor pode devolver como resultado de uma checagem. */
export const CheckStatus = z.enum(['supported', 'contradicted', 'partial', 'insufficient', 'error', 'manual']);
export type CheckStatus = z.infer<typeof CheckStatus>;

export const Evidence = z.object({
  url: z.string().url(),
  title: z.string(),
  snippet: z.string().optional(),
});
export type Evidence = z.infer<typeof Evidence>;

export const CheckResult = z.object({
  status: CheckStatus,
  summary: z.string(),
  evidence: z.array(Evidence),
  dataDate: z.string().optional(),
  limitations: z.array(z.string()),
  provider: z.object({ id: z.string(), name: z.string() }),
  query: z.string(),
  checkedAt: z.number(),
  fromCache: z.boolean().optional(),
});
export type CheckResult = z.infer<typeof CheckResult>;

export const Claim = z.object({
  id: z.string(),
  sessionId: z.string(),
  segmentId: z.string(),
  topicId: z.string(),
  /** Afirmação reescrita de forma autônoma (usada na checagem). */
  text: z.string(),
  /** Trecho original transcrito. */
  quote: z.string(),
  /** Contexto da fala (janela de transcrição). */
  context: z.string(),
  kind: ClaimKind,
  period: z.string().optional(),
  region: z.string().optional(),
  offsetMs: z.number(),
  createdAt: z.number(),
  status: VerdictStatus,
  result: CheckResult.optional(),
  attempts: z.number().default(0),
  aiModeOpenedAt: z.number().optional(),
});
export type Claim = z.infer<typeof Claim>;

export const Topic = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  firstSeenAt: z.number(),
  lastActiveAt: z.number(),
  claimIds: z.array(z.string()),
});
export type Topic = z.infer<typeof Topic>;

export const Segment = z.object({
  id: z.string(),
  sessionId: z.string(),
  seq: z.number(),
  text: z.string(),
  offsetMs: z.number(),
  at: z.number(),
});
export type Segment = z.infer<typeof Segment>;

export const SessionState = z.enum(['capturing', 'paused', 'ended']);
export type SessionState = z.infer<typeof SessionState>;

export const ProviderMode = z.enum(['grounded', 'manual']);
export type ProviderMode = z.infer<typeof ProviderMode>;

export const Session = z.object({
  id: z.string(),
  state: SessionState,
  tabId: z.number(),
  tabTitle: z.string(),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  segments: z.array(Segment),
  /** Quantidade de segmentos (do início da lista atual) já analisados. */
  analyzedSeq: z.number(),
  topics: z.record(Topic),
  claims: z.record(Claim),
  providerMode: ProviderMode,
  lastError: z.string().optional(),
});
export type Session = z.infer<typeof Session>;

export const Settings = z.object({
  backendUrl: z.string().default('http://127.0.0.1:8787'),
  backendToken: z.string().default(''),
  providerMode: ProviderMode.default('grounded'),
});
export type Settings = z.infer<typeof Settings>;
export const DEFAULT_SETTINGS: Settings = Settings.parse({});

/* ---------- Contratos da API do backend ---------- */

export const TranscribeResponse = z.object({ text: z.string() });

export const TopicSuggestion = z.object({
  existingId: z.string().optional(),
  title: z.string().min(1).max(80),
  description: z.string().max(240).optional(),
});
export type TopicSuggestion = z.infer<typeof TopicSuggestion>;
export const TopicsRequest = z.object({
  text: z.string().min(1).max(6000),
  knownTopics: z.array(z.object({ id: z.string(), title: z.string() })).max(60),
});
export const TopicsResponse = z.object({ topics: z.array(TopicSuggestion).max(4) });

export const ExtractedClaim = z.object({
  text: z.string().min(5).max(400),
  quote: z.string().min(1).max(500),
  kind: ClaimKind,
  topicId: z.string(),
  period: z.string().max(80).optional(),
  region: z.string().max(80).optional(),
});
export type ExtractedClaim = z.infer<typeof ExtractedClaim>;
export const ClaimsRequest = z.object({
  text: z.string().min(1).max(6000),
  topics: z.array(z.object({ id: z.string(), title: z.string() })).min(1).max(8),
});
export const ClaimsResponse = z.object({ claims: z.array(ExtractedClaim).max(12) });

export const CheckRequest = z.object({
  claim: z.string().min(5).max(400),
  context: z.string().max(1500).default(''),
  topic: z.string().max(80).default(''),
  period: z.string().max(80).optional(),
  region: z.string().max(80).optional(),
});
export type CheckRequest = z.infer<typeof CheckRequest>;
export const CheckResponse = z.object({ result: CheckResult });

export const HealthResponse = z.object({
  ok: z.boolean(),
  providers: z.object({ grounded: z.boolean() }),
  model: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
