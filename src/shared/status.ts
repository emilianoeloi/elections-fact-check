import type { VerdictStatus } from './schemas';

export interface StatusMeta {
  icon: string;
  label: string;
  tone: 'green' | 'red' | 'yellow' | 'gray' | 'neutral' | 'blue';
}

export const STATUS_META: Record<VerdictStatus, StatusMeta> = {
  supported: { icon: '✓', label: 'Sustentada pelas evidências', tone: 'green' },
  contradicted: { icon: '✕', label: 'Contradita pelas evidências', tone: 'red' },
  partial: { icon: '◐', label: 'Parcialmente sustentada ou enganosa', tone: 'yellow' },
  pending: { icon: '⏳', label: 'Pesquisa em andamento', tone: 'gray' },
  insufficient: { icon: '?', label: 'Evidências insuficientes', tone: 'gray' },
  error: { icon: '!', label: 'Erro técnico na checagem', tone: 'neutral' },
  not_checkable: { icon: '”', label: 'Opinião, previsão ou promessa (sem veredito factual)', tone: 'blue' },
  manual: { icon: '↗', label: 'Verificação manual no Google AI Mode', tone: 'blue' },
};

export const KIND_LABEL = {
  factual: 'Fato',
  opinion: 'Opinião',
  prediction: 'Previsão',
  promise: 'Promessa',
} as const;
