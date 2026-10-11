import { sanitizeUntrusted } from './text';

export interface QueryParts {
  text: string;
  context?: string;
  topic?: string;
  period?: string;
  region?: string;
}

/** Monta a consulta contextualizada usada tanto na checagem quanto no AI Mode manual. */
export function buildContextualQuery(p: QueryParts): string {
  const lines = [`Verifique a seguinte afirmação feita em uma transmissão: "${sanitizeUntrusted(p.text, 400)}"`];
  if (p.topic) lines.push(`Assunto: ${sanitizeUntrusted(p.topic, 80)}.`);
  if (p.period) lines.push(`Período mencionado: ${sanitizeUntrusted(p.period, 80)}.`);
  lines.push(`Região: ${p.region ? sanitizeUntrusted(p.region, 80) : 'Brasil'}.`);
  if (p.context) lines.push(`Contexto da fala: "${sanitizeUntrusted(p.context, 500)}"`);
  lines.push('Indique se é verdadeira, falsa ou enganosa, com dados atuais e fontes confiáveis.');
  return lines.join('\n').slice(0, 1500);
}

/**
 * URL do Google AI Mode para consulta manual. O parâmetro `udm=50` NÃO é documentado
 * oficialmente pelo Google (apenas observado); veja docs/google-integration.md.
 */
export function buildAiModeUrl(query: string): string {
  const u = new URL('https://www.google.com/search');
  u.searchParams.set('udm', '50');
  u.searchParams.set('q', query);
  u.searchParams.set('hl', 'pt-BR');
  return u.toString();
}
