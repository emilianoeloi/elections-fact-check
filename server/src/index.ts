import { loadConfig } from './config';
import { AdkGenerator } from './adk-generator';
import { LlmTranscriber } from './transcriber';
import { LlmTopicClassifier } from './topic-classifier';
import { LlmClaimExtractor } from './claim-extractor';
import { AdkFactCheckProvider } from './adk-fact-check-provider';
import { buildPipeline } from './adk-pipeline';
import type { FactCheckProvider } from './web-search-provider';
import { buildApp } from './app';

const cfg = loadConfig();
const adk = new AdkGenerator({
  apiKey: cfg.GOOGLE_API_KEY,
  model: cfg.GEMINI_MODEL,
  timeoutMs: cfg.REQUEST_TIMEOUT_MS,
});

let provider: FactCheckProvider;
let configured: boolean;

if (cfg.ADK_PIPELINE) {
  const pipeline = buildPipeline(cfg);
  configured = pipeline.configured;
  provider = {
    id: 'adk-workflow-pipeline',
    name: 'Gemini via ADK Workflow (multi-agent)',
    check: (req, signal) => pipeline.runPipeline(req, signal).then((results) => {
      const first = results[0];
      if (!first) throw new Error('Pipeline retornou lista vazia');
      return first;
    }),
  };
} else {
  configured = adk.configured;
  provider = new AdkFactCheckProvider(adk, cfg.CHECK_CACHE_TTL_S * 1000);
}

const app = buildApp({
  token: cfg.BACKEND_TOKEN,
  model: cfg.GEMINI_MODEL,
  configured,
  transcriber: new LlmTranscriber(adk),
  classifier: new LlmTopicClassifier(adk),
  extractor: new LlmClaimExtractor(adk),
  provider,
});

const mode = cfg.ADK_PIPELINE ? 'ADK Workflow (multi-agent)' : 'ADK (referência)';
app.listen({ host: cfg.HOST, port: cfg.PORT }).then(() => {
  console.log(`FactCheck Live backend em http://${cfg.HOST}:${cfg.PORT} (${mode}, ${configured ? 'configurado' : 'NÃO configurado'}, modelo ${cfg.GEMINI_MODEL})`);
});
