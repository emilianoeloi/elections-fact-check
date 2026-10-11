import { z } from 'zod';

const Env = z.object({
  OPENROUTER_API_KEY: z.string().default(''),
  OPENROUTER_MODEL: z.string().default('google/gemini-3.5-flash-lite'),
  /** `auto` = esforço de raciocínio mínimo por tarefa; `off` = nunca enviar o parâmetro `reasoning`. */
  OPENROUTER_REASONING: z.enum(['auto', 'off']).default('auto'),
  /** Quantos resultados de busca o OpenRouter injeta no prompt (cada um custa tokens de entrada). */
  OPENROUTER_WEB_MAX_RESULTS: z.coerce.number().int().min(1).max(10).default(3),
  /** Motor do plugin de busca web: native, exa, firecrawl, parallel, perplexity. Vazio = padrão do OpenRouter. */
  OPENROUTER_WEB_ENGINE: z.string().default(''),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().default(8787),
  BACKEND_TOKEN: z.string().default(''),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().default(60000),
  CHECK_CACHE_TTL_S: z.coerce.number().int().default(21600),
});

export type Config = z.infer<typeof Env>;
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => Env.parse(env);
