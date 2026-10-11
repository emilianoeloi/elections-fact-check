import { TargetTab } from '../audio-capture/messages';

export interface ActionDeps {
  openPanel(tabId: number): Promise<void>;
  saveTarget(t: TargetTab): Promise<void>;
}

/**
 * Clique no ícone: abre o painel lateral e registra a aba-alvo.
 * `openPanel` precisa ser chamado dentro do gesto do usuário, então vem antes de qualquer await.
 * NÃO inicia captura: isso só ocorre quando o usuário aperta "Iniciar" no painel.
 */
export async function handleActionClick(tab: { id?: number; title?: string; url?: string }, d: ActionDeps): Promise<void> {
  if (tab.id === undefined) return;
  const opened = d.openPanel(tab.id);
  const target = TargetTab.parse({ tabId: tab.id, title: tab.title ?? 'Aba sem título', url: tab.url });
  await Promise.all([opened, d.saveTarget(target)]);
}
