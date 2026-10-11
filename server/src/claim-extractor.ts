import { z } from 'zod';
import { ExtractedClaim } from '../../src/shared/schemas';
import { extractJson, type TextGenerator } from './llm';
import { SECURITY_RULES, wrap } from './prompts';

export interface ClaimExtractor {
  extract(text: string, topics: { id: string; title: string }[], signal?: AbortSignal): Promise<ExtractedClaim[]>;
}

const SYSTEM = `Você extrai AFIRMAÇÕES de um trecho de transmissão em português do Brasil.
Para cada afirmação relevante devolva:
- "text": a afirmação reescrita de forma autônoma e inequívoca (sem pronomes soltos), sem alterar o sentido nem acrescentar fatos;
- "quote": o trecho original mais próximo, copiado do texto;
- "kind": "factual" (fato verificável com dados/eventos/números), "opinion", "prediction" ou "promise";
- "topicId": o id de um dos assuntos listados em <topicos>;
- "period" e "region" apenas se mencionados ou claramente implícitos.
Ignore cumprimentos, perguntas e frases sem conteúdo checável. Máximo de 8 afirmações. Pode devolver lista vazia.
Formato (somente JSON): {"claims":[{"text":"","quote":"","kind":"factual","topicId":"","period":"","region":""}]}
${SECURITY_RULES}`;

const Out = z.object({ claims: z.array(z.unknown()).max(20) });

export class LlmClaimExtractor implements ClaimExtractor {
  constructor(private gen: TextGenerator) {}

  async extract(text: string, topics: { id: string; title: string }[], signal?: AbortSignal) {
    const list = topics.map((t) => `${t.id} | ${t.title.replace(/[\n<>]/g, ' ')}`).join('\n');
    const out = await this.gen.generate({
      system: SYSTEM,
      temperature: 0,
      maxTokens: 2000,
      reasoning: 'minimal',
      signal,
      input: `<topicos>\n${list}\n</topicos>\n${wrap('transcricao', text, 6000)}`,
    });
    const raw = Out.parse(extractJson(out.text)).claims;
    const valid: ExtractedClaim[] = [];
    const ids = new Set(topics.map((t) => t.id));
    for (const item of raw) {
      const p = ExtractedClaim.safeParse(item);
      if (!p.success) continue; // item malformado é descartado, não derruba o lote
      valid.push({ ...p.data, topicId: ids.has(p.data.topicId) ? p.data.topicId : (topics[0] as { id: string }).id });
    }
    return valid.slice(0, 8);
  }
}
