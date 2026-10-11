import { z } from 'zod';
import { TopicSuggestion, type TopicSuggestion as TS } from '../../src/shared/schemas';
import { extractJson, type TextGenerator } from './llm';
import { SECURITY_RULES, wrap } from './prompts';

export interface TopicClassifier {
  classify(text: string, known: { id: string; title: string }[], signal?: AbortSignal): Promise<TS[]>;
}

const SYSTEM = `Você identifica os ASSUNTOS discutidos em um trecho de transmissão em português do Brasil.
Devolva de 1 a 3 assuntos reais do trecho (não use uma lista fixa), com título curto (máx. 5 palavras) em português.
Se o trecho tratar de um assunto já listado em <topicos_existentes>, reutilize-o devolvendo "existingId" com o id exato e o mesmo título.
Só crie um novo assunto quando nenhum existente servir. Não crie assunto por frase.
Formato (somente JSON): {"topics":[{"existingId":"opcional","title":"...","description":"opcional, até 1 frase"}]}
${SECURITY_RULES}`;

const Out = z.object({ topics: z.array(TopicSuggestion).min(1).max(4) });

export class LlmTopicClassifier implements TopicClassifier {
  constructor(private gen: TextGenerator) {}

  async classify(text: string, known: { id: string; title: string }[], signal?: AbortSignal) {
    const list = known.map((t) => `${t.id} | ${t.title.replace(/[\n<>]/g, ' ')}`).join('\n') || '(nenhum)';
    const out = await this.gen.generate({
      system: SYSTEM,
      temperature: 0,
      maxTokens: 500,
      reasoning: 'minimal',
      signal,
      input: `<topicos_existentes>\n${list}\n</topicos_existentes>\n${wrap('transcricao', text, 6000)}`,
    });
    const parsed = Out.parse(extractJson(out.text));
    const ids = new Set(known.map((k) => k.id));
    // Um existingId inventado pelo modelo é descartado (vira novo assunto).
    return parsed.topics.map((t) => (t.existingId && !ids.has(t.existingId) ? { ...t, existingId: undefined } : t));
  }
}
