import { backendRequest, type BackendOptions } from '../shared/backend';
import { TopicsResponse, type Topic, type TopicSuggestion } from '../shared/schemas';
import { jaccard, normalizeText, tokenSubset, topicId } from '../shared/text';

export interface TopicClassifier {
  classify(text: string, known: { id: string; title: string }[], signal?: AbortSignal): Promise<TopicSuggestion[]>;
}

export class BackendTopicClassifier implements TopicClassifier {
  constructor(private backend: BackendOptions) {}
  async classify(text: string, known: { id: string; title: string }[], signal?: AbortSignal) {
    const r = await backendRequest(this.backend, '/v1/topics', { body: JSON.stringify({ text, knownTopics: known.slice(-60) }), contentType: 'application/json', signal }, TopicsResponse);
    return r.topics;
  }
}

/**
 * Resolve sugestões do classificador em tópicos da sessão, reutilizando os existentes.
 * Reuso: (1) existingId válido; (2) mesmo título normalizado; (3) títulos muito parecidos.
 */
export function resolveTopics(sessionId: string, topics: Record<string, Topic>, suggestions: TopicSuggestion[], at: number): Topic[] {
  const out: Topic[] = [];
  for (const s of suggestions) {
    let found: Topic | undefined = s.existingId ? topics[s.existingId] : undefined;
    const norm = normalizeText(s.title);
    found ??= Object.values(topics).find((t) => normalizeText(t.title) === norm);
    found ??= Object.values(topics).find((t) => jaccard(t.title, s.title) >= 0.6 || (norm.length > 3 && tokenSubset(t.title, s.title)));
    if (!found) {
      found = { id: topicId(sessionId, s.title), title: s.title.trim(), description: s.description, firstSeenAt: at, lastActiveAt: at, claimIds: [] };
      topics[found.id] = found;
    } else {
      found.lastActiveAt = at;
    }
    if (!out.includes(found)) out.push(found);
  }
  return out;
}
