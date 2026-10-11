import type { Claim, Session, Topic, VerdictStatus } from '../shared/schemas';

export type Filter = 'all' | 'contradicted' | 'supported' | 'pending' | 'inconclusive';

export const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'contradicted', label: 'Contraditas' },
  { id: 'supported', label: 'Sustentadas' },
  { id: 'pending', label: 'Pendentes' },
  { id: 'inconclusive', label: 'Inconclusivas' },
];

const INCONCLUSIVE: VerdictStatus[] = ['partial', 'insufficient', 'error', 'manual'];

export function matchesFilter(c: Claim, f: Filter): boolean {
  switch (f) {
    case 'all': return true;
    case 'contradicted': return c.status === 'contradicted';
    case 'supported': return c.status === 'supported';
    case 'pending': return c.status === 'pending';
    case 'inconclusive': return INCONCLUSIVE.includes(c.status);
  }
}

/** "Verificadas" = checagem concluída com resultado (inclui parcial/insuficiente, exclui erro e manual). */
export function counts(s: Session) {
  let verified = 0;
  let pending = 0;
  for (const c of Object.values(s.claims)) {
    if (c.status === 'pending') pending++;
    else if (['supported', 'contradicted', 'partial', 'insufficient'].includes(c.status)) verified++;
  }
  return { verified, pending, total: Object.keys(s.claims).length };
}

export interface TopicGroup {
  topic: Topic;
  claims: Claim[];
}

/** Tópicos mais recentes primeiro; afirmações em ordem cronológica; grupos vazios (após filtro) omitidos. */
export function groupByTopic(s: Session, f: Filter): TopicGroup[] {
  return Object.values(s.topics)
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    .map((topic) => ({
      topic,
      claims: topic.claimIds
        .map((id) => s.claims[id])
        .filter((c): c is Claim => !!c && matchesFilter(c, f))
        .sort((a, b) => a.offsetMs - b.offsetMs || a.createdAt - b.createdAt),
    }))
    .filter((g) => g.claims.length > 0);
}
