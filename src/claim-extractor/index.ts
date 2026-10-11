import { backendRequest, type BackendOptions } from '../shared/backend';
import { ClaimsResponse, type Claim, type ExtractedClaim } from '../shared/schemas';
import { claimId, jaccard, tokenSubset } from '../shared/text';

export interface ClaimExtractor {
  extract(text: string, topics: { id: string; title: string }[], signal?: AbortSignal): Promise<ExtractedClaim[]>;
}

export class BackendClaimExtractor implements ClaimExtractor {
  constructor(private backend: BackendOptions) {}
  async extract(text: string, topics: { id: string; title: string }[], signal?: AbortSignal) {
    const r = await backendRequest(this.backend, '/v1/claims', { body: JSON.stringify({ text, topics }), contentType: 'application/json', signal }, ClaimsResponse);
    return r.claims;
  }
}

/**
 * Deduplicação: ID estável (hash do texto normalizado) + quase-duplicata por similaridade,
 * porque a mesma afirmação costuma reaparecer reformulada em janelas sobrepostas.
 */
export function findDuplicate(sessionId: string, existing: Record<string, Claim>, text: string, threshold = 0.8): string | undefined {
  const id = claimId(sessionId, text);
  if (existing[id]) return id;
  return Object.values(existing).find((c) => {
    const j = jaccard(c.text, text);
    return j >= threshold || (j >= 0.7 && tokenSubset(c.text, text)); // mesma afirmação com complemento
  })?.id;
}
