# Integração com o Google — o que é suportado (pesquisado em 11/10/2026)

## 1. Existe API pública do Google Search AI Mode?

**Não encontrei nenhuma.** A página oficial de ajuda do AI Mode
(<https://support.google.com/websearch/answer/16011537>) descreve apenas pontos de acesso de consumidor
(`google.com/ai`, o botão na busca, o app Google) e **não menciona API nem URL para desenvolvedores**.
A documentação da Gemini API (<https://ai.google.dev>) também não expõe o AI Mode.

As "AI Mode APIs" que aparecem em buscas (SerpApi, Scrapingdog, HasData, SearchApi, extensões "relay"…) são
serviços de terceiros que raspam a interface do Google. Isso é exatamente o que o briefing proíbe
(scraping/automação não autorizada) e **não foi usado**.

Região/idioma: o AI Mode está disponível no Brasil em português (mesma página de ajuda); funciona sem login.

## 2. Alternativas avaliadas

| Opção | Situação | Decisão |
|---|---|---|
| **OpenRouter** (`google/gemini-3.5-flash-lite` + plugin `web`) | API compatível com OpenAI Chat Completions; a busca web vem como `annotations` do tipo `url_citation`. Para modelos Google o motor padrão é "nativo"; a doc **não diz** se isso é o Grounding do Google Search. O modelo é roteado entre Vertex e AI Studio com failover. | **Usada** (escolha do usuário, após erros 503 frequentes na Gemini API direta). |
| Gemini API direta + Grounding with Google Search | Oficial do Google; retornava 503 com frequência no uso do usuário. Exige exibir *Search Suggestions*. | Substituída (código removido). |
| Custom Search JSON API | Fechada para novos clientes; descontinuada em 01/01/2027. | Descartada. |
| AI Mode via URL | `google.com/search?udm=50&q=…` abre o AI Mode. **`udm=50` não é documentado pelo Google** (só observado) e pode mudar. | **Usada** apenas para abrir a consulta para o *usuário* (ação manual). |

**Importante — isto NÃO é o AI Mode.** O provedor automático usa Gemini + busca web do OpenRouter. O resultado é rotulado como
"Gemini via OpenRouter com busca web (não é o Google AI Mode)". Nada é apresentado como resposta do AI Mode.

## 3. Como a extensão usa cada caminho

- `FactCheckProvider` (`src/fact-check-provider`, `server/src/web-search-provider.ts`) é a interface; trocar de mecanismo = nova implementação.
- **Automático (`grounded`, nome interno mantido por compatibilidade com configurações salvas)**: afirmação → backend → OpenRouter (Gemini + plugin `web`) → JSON de veredito.
  - Evidências/links vêm **somente** das citações (`url_citation`) retornadas pela busca, nunca de URLs ditas pelo modelo.
  - Veredito `supported`/`contradicted`/`partial` **sem nenhuma citação é rebaixado para `insufficient`**. Ausência de resultado nunca vira ✕.
  - Cache de 6 h por afirmação normalizada (+ período/região).
- **Manual (`manual`)**: nenhuma pesquisa. O cartão fica "↗ Verificação manual" e o botão
  **Verificar no Google AI Mode** abre `google.com/search?udm=50&q=<consulta contextualizada>` numa nova aba.
  A extensão **não lê** a resposta; mostra "Consulta aberta… a extensão não lê a resposta dele".
- Em ambos os modos o botão "Verificar no Google AI Mode" existe nos detalhes de afirmações factuais.

## 4. Dados enviados a cada provedor

| Destino | O que é enviado | Quando |
|---|---|---|
| Backend local (`127.0.0.1:8787`) | Trechos de áudio de ~12 s (WAV 16 kHz mono, só com fala), transcrições, afirmações. Nada é gravado em disco nem em logs. | Durante o monitoramento |
| OpenRouter (e o provedor do modelo, Google Vertex/AI Studio) | Áudio do trecho (transcrição); janela de texto (até 3.000 caracteres) para assuntos/afirmações; afirmação + contexto (≤ 1.500 caracteres) + assunto/período/região para checagem | Idem |
| Mecanismo de busca do OpenRouter | Consultas geradas a partir da afirmação | Por afirmação factual (modo automático) |
| Google AI Mode (navegador) | Consulta contextualizada | Só quando você clica em "Verificar no Google AI Mode" |

Consulte as políticas de dados do OpenRouter e do provedor do modelo (retenção/treino) antes de usar com conteúdo sensível.

## 5. Pendências conhecidas

- O formato das chamadas (`input_audio` com `format: "wav"`, plugin `web`, `annotations`) segue a documentação do OpenRouter, mas **não foi exercitado
  contra a API real** nesta entrega (sem chave). Ver README, seção "Validação".
- O OpenRouter não documenta WebM; por isso a captura converte para WAV no navegador.
