import { loadConfig } from './config';
import { OpenRouterClient } from './openrouter';
import { LlmTranscriber } from './transcriber';
import { LlmTopicClassifier } from './topic-classifier';
import { LlmClaimExtractor } from './claim-extractor';
import { WebSearchProvider } from './web-search-provider';
import { buildApp } from './app';

const cfg = loadConfig();
const llm = new OpenRouterClient({
  apiKey: cfg.OPENROUTER_API_KEY,
  model: cfg.OPENROUTER_MODEL,
  timeoutMs: cfg.REQUEST_TIMEOUT_MS,
  webEngine: cfg.OPENROUTER_WEB_ENGINE || undefined,
  webMaxResults: cfg.OPENROUTER_WEB_MAX_RESULTS,
  sendReasoning: cfg.OPENROUTER_REASONING === 'auto',
});

const app = buildApp({
  token: cfg.BACKEND_TOKEN,
  model: cfg.OPENROUTER_MODEL,
  configured: llm.configured,
  transcriber: new LlmTranscriber(llm),
  classifier: new LlmTopicClassifier(llm),
  extractor: new LlmClaimExtractor(llm),
  provider: new WebSearchProvider(llm, cfg.CHECK_CACHE_TTL_S * 1000),
});

app.listen({ host: cfg.HOST, port: cfg.PORT }).then(() => {
  console.log(`FactCheck Live backend em http://${cfg.HOST}:${cfg.PORT} (OpenRouter ${llm.configured ? 'configurado' : 'NÃO configurado'}, modelo ${cfg.OPENROUTER_MODEL})`);
});
