# Integração Google

## Google AI Mode

O modo automático desta extensão **não é o Google AI Mode**. A extensão não lê nem automatiza a interface do AI Mode.
O botão manual abre uma pesquisa contextualizada no navegador e a extensão não lê a resposta exibida.

## Verificação automática

O backend usa `@google/adk` com Gemini e a ferramenta `GOOGLE_SEARCH` para realizar checagens com Google Search Grounding.
O modelo padrão é `gemini-3.5-flash-lite`; a chave `GOOGLE_API_KEY` é configurada somente no ambiente do backend.
O fact-check executa uma etapa de pesquisa grounded em texto livre e, quando há citações, uma segunda etapa para
estruturar o veredito. Isso evita depender de uma resposta JSON que pode não acionar a busca.

- A afirmação, o contexto relevante e o período/região são enviados ao backend e ao provedor Google para checagem.
- Evidências e links apresentados pelo backend são derivados das citações de grounding, não de URLs inventadas pelo modelo.
- Se não houver citações válidas, um veredito `supported`, `contradicted` ou `partial` é rebaixado para `insufficient`.
- Resultados de checagem usam o cache backend configurado por `CHECK_CACHE_TTL_S`.

## Transcrição e privacidade

Áudio e texto passam pelo backend local e são enviados à API Google conforme necessário para transcrição, classificação,
extração de afirmações e checagem. O backend mantém a chave fora da extensão; não configure a chave nos arquivos da
extensão nem em `src/`.

Revise as políticas de retenção e uso de dados do provedor Google antes de processar conteúdo sensível. O logger
geral de requisições Fastify permanece desligado para evitar registrar transcrições e afirmações.

Em falhas ADK/Gemini, o backend emite no terminal um diagnóstico sanitizado em todos os ambientes onde roda. Ele pode
incluir o modelo, um identificador da operação, tipos de entrada, MIME/tamanho do áudio, código e detalhe do erro
quando for seguro sanitizá-lo. Para respostas de modelo com falha, inclui também a versão do modelo, contagens de uso
e o motivo de término quando distinto do código, se esses campos estiverem disponíveis. Coletores de logs podem
reter essa saída.

O backend não registra áudio, transcrições, prompts, entradas de texto, conteúdo da resposta, credenciais nem objetos
brutos do SDK. Conteúdo conhecido ecoado no detalhe é redigido; se não puder ser sanitizado com segurança, o detalhe é
omitido. O logging verbose do ADK permanece desativado porque pode expor conteúdo de entrada. Esses metadados ajudam
a investigar falhas, mas não provam sua causa.

## Validação da integração

Os testes automatizados cobrem contratos e comportamento do backend usando doubles; eles não substituem a integração
real. O smoke test confirmou `/health`, transcrição de áudio sintético e uma checagem grounded com duas citações usando
`gemini-3.5-flash-lite`. O primeiro fluxo JSON-only não acionou a busca; a estratégia em duas etapas foi validada e
retornou fontes. A chave foi usada apenas pelo backend e não deve ser registrada, copiada para arquivos versionados ou
exibida.
