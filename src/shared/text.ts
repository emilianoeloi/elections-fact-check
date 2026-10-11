/** Normaliza texto para comparação/ID: minúsculas, sem acentos nem pontuação. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9% ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Hash não criptográfico (cyrb53), síncrono, estável entre execuções. */
export function hash53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export const claimId = (sessionId: string, text: string) => `c_${hash53(`${sessionId}|${normalizeText(text)}`).toString(36)}`;
export const topicId = (sessionId: string, title: string) => `t_${hash53(`${sessionId}|${normalizeText(title)}`).toString(36)}`;
export const segmentId = (sessionId: string, seq: number) => `${sessionId}:${seq}`;

const STOP = new Set('a o as os de do da dos das em no na nos nas um uma uns umas e que para por com se foi e ao aos mais ja ha'.split(' '));
const tokens = (s: string) => new Set(normalizeText(s).split(' ').filter((t) => t.length > 1 && !STOP.has(t)));

/** Similaridade de Jaccard entre conjuntos de palavras significativas. */
export function jaccard(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/** Verdadeiro se todas as palavras do menor conjunto estão no maior. */
export function tokenSubset(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return false;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

/** Limpa texto não confiável (transcrição/página): remove controles e limita tamanho. */
export function sanitizeUntrusted(text: string, max: number): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/[<>]/g, (c) => (c === '<' ? '‹' : '›')) // impede fechar/abrir delimitadores
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function formatOffset(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
