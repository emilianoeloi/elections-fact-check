# FactCheck Live

![FactCheck Live monitorando uma transmissão no Globoplay, com o painel lateral mostrando a checagem de uma afirmação](images/cover.png)

Extensão para Google Chrome que acompanha o áudio de uma aba (por exemplo, uma transmissão no Globoplay),
transcreve em português, organiza os **assuntos** e verifica as **afirmações** com busca na web, mostrando tudo em um
painel lateral com indicadores de veracidade e links para as fontes.

Funciona com um **backend local** (Node.js) que guarda a sua chave do OpenRouter e conversa com o modelo
`google/gemini-3.5-flash-lite`. A extensão nunca vê a chave.

> **Sobre o Google AI Mode:** o Google não oferece API pública para ele. A checagem automática usa Gemini via OpenRouter
> com busca web (rotulada assim na interface, **não é o AI Mode**). Cada afirmação tem o botão
> **Verificar no Google AI Mode**, que abre a consulta no navegador para você. Detalhes em
> [`docs/google-integration.md`](docs/google-integration.md).

---

## Sumário

1. [Requisitos](#1-requisitos)
2. [Configurar o OpenRouter](#2-configurar-o-openrouter)
3. [Instalar e rodar o backend](#3-instalar-e-rodar-o-backend)
4. [Instalar a extensão no Chrome (unpacked)](#4-instalar-a-extensão-no-chrome-unpacked)
5. [Usar](#5-usar)
6. [Solução de problemas](#6-solução-de-problemas)
7. [Custo e consumo de tokens](#7-custo-e-consumo-de-tokens)
8. [Privacidade e segurança](#8-privacidade-e-segurança)
9. [Como funciona](#9-como-funciona)
10. [Desenvolvimento e testes](#10-desenvolvimento-e-testes)
11. [Estado da entrega e limitações](#11-estado-da-entrega-e-limitações)

---

## 1. Requisitos

| Item | Versão |
|---|---|
| **Node.js** | **22.9 ou superior** (testado com 22.16; o arquivo `.nvmrc` indica 22). O script `npm run server` usa a flag `--env-file-if-exists`, que exige uma versão recente do Node (por isso o mínimo 22.9). |
| npm | 10+ (já vem com o Node 22) |
| Google Chrome | **116 ou superior** (precisa de Side Panel e documento offscreen) |
| Conta no OpenRouter | com créditos (ver abaixo) |

Dica: com [nvm](https://github.com/nvm-sh/nvm), rode `nvm install 22 && nvm use` dentro da pasta do projeto.
Confira com `node -v`.

## 2. Configurar o OpenRouter

1. Crie uma conta em <https://openrouter.ai> e entre.
2. **Adicione créditos** (menu da conta → *Credits*). Os modelos gratuitos têm limites que não servem para uso contínuo,
   e a busca web é cobrada por requisição. Um valor pequeno para testar (poucos dólares) basta.
3. Crie uma **chave de API** em <https://openrouter.ai/keys> → *Create Key*.
   - Dê um nome (ex.: `factcheck-live`).
   - **Recomendado:** defina um *limite de crédito* para a chave, para travar o gasto máximo.
   - Copie a chave (começa com `sk-or-…`). Ela só é mostrada uma vez.
4. Confirme que o modelo está disponível para a sua conta: <https://openrouter.ai/google/gemini-3.5-flash-lite>.
   O modelo precisa aceitar **entrada de áudio** (é o que faz a transcrição).
5. (Opcional) Revise as configurações de privacidade/retenção de dados da sua conta no OpenRouter. O áudio e os textos
   da transmissão passam por ele e pelo provedor do modelo (Google). Veja [Privacidade](#8-privacidade-e-segurança).

Em seguida, coloque a chave no `.env` (próximo passo).

## 3. Instalar e rodar o backend

```bash
# dentro da pasta do projeto
npm install

cp .env.example .env
# edite o .env e preencha:
#   OPENROUTER_API_KEY=sk-or-...
```

Variáveis principais do `.env` (todas as outras têm padrão seguro):

| Variável | Padrão | Para que serve |
|---|---|---|
| `OPENROUTER_API_KEY` | *(vazio)* | **Obrigatória.** Sua chave. Fica só no backend; o `.env` é ignorado pelo git. |
| `OPENROUTER_MODEL` | `google/gemini-3.5-flash-lite` | Modelo usado em tudo (transcrição, assuntos, afirmações, checagem). Precisa aceitar áudio. |
| `OPENROUTER_WEB_ENGINE` | *(vazio)* | Motor da busca web: `native`, `exa`, `firecrawl`, `parallel`, `perplexity`. Vazio = padrão do OpenRouter. |
| `OPENROUTER_WEB_MAX_RESULTS` | `3` | Resultados de busca por checagem (menos = menos tokens). |
| `OPENROUTER_REASONING` | `auto` | `auto` pede raciocínio mínimo por tarefa; `off` nunca envia o parâmetro. |
| `BACKEND_TOKEN` | *(vazio)* | Opcional. Se definido, o backend exige esse token (configure o mesmo no painel). |
| `HOST` / `PORT` | `127.0.0.1` / `8787` | Mantenha `127.0.0.1` para não expor o backend na rede. |

Inicie o backend e **deixe-o rodando** enquanto usar a extensão:

```bash
npm run server
# FactCheck Live backend em http://127.0.0.1:8787 (OpenRouter configurado, modelo google/gemini-3.5-flash-lite)
```

Teste:

```bash
curl http://127.0.0.1:8787/health
# {"ok":true,"providers":{"grounded":true},"model":"google/gemini-3.5-flash-lite"}
```

`"grounded": true` significa "chave do OpenRouter configurada". Se vier `false`, a chave não foi lida:
confira o `.env` e reinicie.

> Alterou o `.env`? Reinicie o backend (`Ctrl+C` e `npm run server`). Para reiniciar sozinho a cada mudança no código, use `npm run dev:server`.

Depois gere a extensão:

```bash
npm run build      # cria a pasta dist/
```

## 4. Instalar a extensão no Chrome (unpacked)

A extensão não está na Chrome Web Store; ela é carregada "sem compactação" a partir da pasta `dist/`.

1. Abra o Chrome e acesse **`chrome://extensions`**.
2. Ative **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** (*Load unpacked*).
4. Selecione a pasta **`dist/`** do projeto (não a raiz do projeto).
   - Se rodar o projeto dentro do WSL, o Chrome do Windows precisa acessar a pasta pelo caminho de rede do WSL
     (`\\wsl$\<nome-da-distro>\<caminho-do-projeto>\dist`). Rode `wslpath -w dist` no terminal para obter o caminho exato.
5. O **FactCheck Live** aparece na lista. Clique no ícone de quebra-cabeça da barra do Chrome e **fixe** (📌) a extensão
   para ter o ícone sempre visível.

**Depois de mudar o código ou atualizar o projeto:** rode `npm run build` e, em `chrome://extensions`, clique no botão
**recarregar** (↻) do card da extensão.

**Erros de carregamento?** No card da extensão, clique em **Erros** (ou em "service worker" → *Inspecionar*) para ver o motivo.
A causa mais comum é ter selecionado a pasta errada (precisa conter o `manifest.json`).

## 5. Usar

1. Com o backend rodando, abra a transmissão em uma aba (Globoplay, YouTube, etc.) e deixe-a tocando.
2. **Clique no ícone da extensão *nessa aba*.** Isso abre o painel lateral e autoriza a captura *daquela* aba.
   (Para monitorar outra aba, abra-a e clique no ícone de novo.)
3. No painel, confira a faixa verde **"Backend conectado e OpenRouter configurado"** e clique em
   **Iniciar monitoramento**. A captura **só começa nesse clique**.
4. Acompanhe: em ~15–30 s aparecem as falas transcritas; depois os assuntos e as afirmações, que entram como ⏳ e
   viram ✓ ✕ ◐ ? conforme a pesquisa termina.
5. Clique numa afirmação para ver trecho original, contexto, explicação, fontes, data dos dados, limitações e o botão
   **Verificar no Google AI Mode**.
6. **Pausar** interrompe gravação e envio (o áudio da aba segue tocando). **Encerrar** para tudo na hora.
   **Nova sessão** limpa os resultados.

Fechar e reabrir o painel não reinicia nada: ele mostra o estado salvo.

Em **Configurações** (na tela inicial) você escolhe entre checagem **Automática** (Gemini via OpenRouter + busca web) e
**Manual** (só abre o Google AI Mode, sem gastar tokens de checagem), além da URL e do token do backend.

### Legenda

| Ícone | Significado |
|---|---|
| ✓ verde | Evidências sustentam a afirmação |
| ✕ vermelho | Há evidências relevantes que a contradizem |
| ◐ amarelo | Parcialmente sustentada ou enganosa |
| ⏳ cinza | Pesquisa em andamento |
| ? cinza | Evidências insuficientes (ausência de resultado **não** é "falso") |
| ! roxo | Erro técnico (use "Tentar novamente") |
| ” azul | Opinião, previsão ou promessa — sem veredito factual |
| ↗ azul | Verificação manual no Google AI Mode |

## 6. Solução de problemas

| Sintoma | Causa provável / o que fazer |
|---|---|
| Painel: **"Backend inacessível"** | O backend não está rodando. Execute `npm run server`. Confira a URL em Configurações (`http://127.0.0.1:8787`). |
| **"chave do OpenRouter não está configurada"** | `OPENROUTER_API_KEY` vazia ou `.env` no lugar errado (deve ficar na raiz do projeto). Reinicie o backend. |
| `OpenRouter respondeu 401` | Chave inválida/revogada. Gere outra em openrouter.ai/keys. |
| `OpenRouter respondeu 402` | Sem créditos (ou limite da chave atingido). Adicione créditos. |
| `OpenRouter respondeu 404: No endpoints found…` | Nome do modelo errado ou sem provedor disponível. Confira `OPENROUTER_MODEL` no site do OpenRouter. |
| `OpenRouter respondeu 400` ao transcrever | O modelo não aceita áudio ou o formato foi rejeitado. Use um modelo com entrada de áudio. |
| `OpenRouter respondeu 429/503` | Limite/sobrecarga momentânea. O backend já tenta de novo 2×; se persistir, aguarde ou troque o modelo. |
| "Token do backend inválido" | `BACKEND_TOKEN` do `.env` difere do token em Configurações do painel. |
| "Não foi possível capturar o áudio da aba" | Clique no ícone da extensão **na própria aba** da transmissão e tente de novo. Abas internas do Chrome (`chrome://`) não podem ser capturadas. |
| Aba sem som após iniciar | Recarregue a extensão e tente de novo. Veja o console do documento offscreen em `chrome://extensions` → *Inspecionar visualizações*. |
| Nenhuma fala transcrita | Só trechos com fala são enviados; confirme que o áudio está tocando. Veja `lastError` na faixa amarela do painel. |
| Transcrição "atrasada" | O backend/modelo não está acompanhando; trechos são descartados para não acumular. |
| `Transcrição: Erro interno` | Falha inesperada no backend. Atualize o projeto, reinicie o backend e veja o terminal onde ele roda. |
| `npm run server` falha com `--env-file-if-exists` | Node antigo. Use Node 22.9+. |
| Globoplay sem áudio capturado | Possível proteção DRM. Não há contorno (limite intencional). |

## 7. Custo e consumo de tokens

O padrão é o modelo leve `google/gemini-3.5-flash-lite` (troque em `OPENROUTER_MODEL`). Para gastar menos:

- **Raciocínio mínimo:** transcrição, assuntos e extração usam `reasoning: minimal`; a checagem, `low`.
  Se o modelo recusar o parâmetro, o backend repete a chamada sem ele.
- **Tetos de saída** (`max_tokens`): transcrição 1.500, assuntos 500, afirmações 2.000, checagem 2.000.
- **Busca web enxuta:** 3 resultados por checagem (o padrão do OpenRouter é 5). Eles entram no prompt, então são o maior custo de entrada.
- **Menos chamadas:** análise a cada ~400 caracteres novos (janela de até 2.000); só afirmações *factuais* são pesquisadas; cache de 6 h.
- A **busca web é cobrada por requisição** além dos tokens (depende do motor escolhido; consulte a página de preços do OpenRouter).
- Para **zerar** o custo de checagem, use o modo **Manual** nas Configurações.
- Defina um **limite de crédito na chave** no OpenRouter.

## 8. Privacidade e segurança

- A captura só começa após clicar em **Iniciar monitoramento**; uma faixa "🔴 Captura de áudio ativa" aparece enquanto grava.
- O áudio fica **só em memória**: cada trecho (~12 s, WAV 16 kHz mono, apenas com fala) é enviado e descartado. Nada é gravado em disco.
- **Para onde os dados vão:** backend local → OpenRouter → provedor do modelo (Google) e o mecanismo de busca usado pelo plugin web.
  Isso inclui áudio, transcrições e as afirmações. Não use com conteúdo sensível sem revisar as políticas de retenção/treino deles.
- A chave do OpenRouter existe **apenas** no backend (`.env`, fora do git). Testes automatizados verificam que `src/` e `dist/` não a contêm.
- O backend escuta só em `127.0.0.1`, tem token opcional (comparação em tempo constante), logs desligados e erros que não vazam detalhes.
- Transcrições e páginas são tratadas como **dados não confiáveis**: sanitizadas, isoladas em blocos delimitados, saída validada com Zod,
  evidências somente de citações reais, links só `http(s)`. Um veredito sem fonte citada é rebaixado para "?".
- O estado da sessão (falas, afirmações, fontes) fica em `chrome.storage.local` até você clicar em **Nova sessão**.

## 9. Como funciona

```
ícone ─► service worker ─► abre o painel (não captura)
"Iniciar" ─► tabCapture.getMediaStreamId ─► documento offscreen
offscreen: áudio da aba ─► AudioContext.destination (você continua ouvindo)
           └► PCM → WAV 16 kHz mono, trechos de 12 s, só com fala ─► POST /v1/transcribe
service worker (SessionManager): fala ─► /v1/topics (reutiliza assuntos) ─► /v1/claims ─► cartão ⏳
                    └► fila (3 em paralelo, timeout, cancelável) ─► /v1/check ─► ✓ ✕ ◐ ? !
painel: lê chrome.storage.local (abre instantâneo; não reinicia nada)
```

Módulos em `src/`: `audio-capture`, `transcription`, `topic-classifier`, `claim-extractor`, `fact-check-provider`,
`session-manager`, `sidepanel`, `shared` (schemas Zod/tipos), além de `background` e `offscreen`.
Backend em `server/src` (Fastify + TypeScript). Cada serviço é uma interface (`Transcriber`, `TopicClassifier`,
`ClaimExtractor`, `FactCheckProvider`) com implementação substituível.

## 10. Desenvolvimento e testes

```bash
npm test             # 108 testes (vitest)
npm run typecheck    # tsc --strict
npm run build        # gera dist/
npm run dev:server   # backend com recarga automática
npm run icons        # regenera os ícones em public/icons
```

Se a API do OpenRouter divergir da documentação (formato de `input_audio`, plugin `web`, `annotations`), os pontos
únicos a ajustar são `server/src/openrouter.ts` (`OpenRouterClient.generate`, `parseChatCompletion`).

## 11. Estado da entrega e limitações

| Parte | Estado |
|---|---|
| Lógica (sessão, pipeline, assuntos, dedupe, vereditos, filas, backend HTTP, segurança) | ✅ 108 testes passando; `tsc --strict` limpo; build ok |
| Servidor Fastify inicia e responde (`/health`, erro sem chave) | ✅ testado manualmente |
| Captura com `chrome.tabCapture` + offscreen + painel lateral no Chrome | ⚠️ **não testada** em navegador real |
| Chamadas reais ao OpenRouter (áudio, busca web) | ⚠️ **não testadas** (sem chave); formato segue a documentação |
| Funcionamento com Globoplay | ⚠️ **não testado** |

Limitações conhecidas:

- **Sem AI Mode automático** (não existe API). A busca web é a do OpenRouter; a documentação não garante que seja o Google Search.
- Latência de ~15–30 s (trechos de 12 s + transcrição + análise + pesquisa). Palavras na fronteira dos trechos podem ser cortadas.
- Transcrição por LLM: pode errar nomes e números (e isso gera checagens erradas); sem separação de falantes.
- O veredito vem de um modelo com busca: pode errar ou citar fontes fracas/datadas. Use como **triagem**, não como verdade final.
- O service worker do Chrome pode ser suspenso; a sessão é persistida e checagens pendentes são retomadas.
- Backend em outro host exige alterar `host_permissions` em `public/manifest.json`. A captura é por aba.
- O parâmetro `udm=50` do botão do AI Mode não é documentado pelo Google e pode deixar de funcionar.
