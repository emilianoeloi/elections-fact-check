import type { Claim, Session } from '../shared/schemas';
import { KIND_LABEL, STATUS_META } from '../shared/status';
import { buildAiModeUrl, buildContextualQuery } from '../shared/aimode';
import { formatOffset } from '../shared/text';
import type { useCommand } from './hooks';

export function StatusBadge({ status }: { status: Claim['status'] }) {
  const m = STATUS_META[status];
  return <span className={`badge ${m.tone}`} title={m.label} role="img" aria-label={m.label}>{m.icon}</span>;
}

export function ClaimRow({ claim, onOpen, onRecheck, canRecheck }: { claim: Claim; onOpen: () => void; onRecheck: () => void; canRecheck: boolean }) {
  return (
    <div className="claim">
      <button className="claim-main" onClick={onOpen}>
        <StatusBadge status={claim.status} />
        <span className="claim-text">“{claim.text}”</span>
        {claim.kind !== 'factual' && <span className="kind">{KIND_LABEL[claim.kind]}</span>}
      </button>
      {claim.status === 'error' && canRecheck && <button className="link" onClick={onRecheck}>Tentar novamente</button>}
    </div>
  );
}

export function ClaimDetail({ claim, session, onBack, send }: { claim: Claim; session: Session; onBack: () => void; send: ReturnType<typeof useCommand>['send'] }) {
  const meta = STATUS_META[claim.status];
  const r = claim.result;
  const topic = session.topics[claim.topicId]?.title;
  const query = r?.query ?? buildContextualQuery({ text: claim.text, context: claim.context, topic, period: claim.period, region: claim.region });
  const openAiMode = () => {
    void chrome.tabs.create({ url: buildAiModeUrl(query) });
    void send({ type: 'ai-mode-opened', claimId: claim.id });
  };
  return (
    <main className="detail">
      <button className="link" onClick={onBack}>← Voltar</button>
      <div className={`verdict ${meta.tone}`}><StatusBadge status={claim.status} /> <strong>{meta.label}</strong></div>
      <h2>“{claim.text}”</h2>
      <dl>
        <dt>Assunto</dt><dd>{topic ?? '—'} · {KIND_LABEL[claim.kind]}</dd>
        <dt>Trecho original</dt><dd>“{claim.quote}” <time>({formatOffset(claim.offsetMs)})</time></dd>
        <dt>Contexto da fala</dt><dd className="ctx">{claim.context}</dd>
        {claim.period && (<><dt>Período</dt><dd>{claim.period}</dd></>)}
        {claim.region && (<><dt>Região</dt><dd>{claim.region}</dd></>)}
      </dl>

      {claim.kind !== 'factual' && <p className="note">Opiniões, previsões e promessas não recebem veredito factual.</p>}
      {claim.status === 'pending' && <p className="note">A pesquisa está em andamento. Você pode continuar acompanhando a transmissão.</p>}

      {r && (
        <>
          <h3>Resultado</h3>
          <p>{r.summary}</p>
          <p className="src-line">Fonte do resultado: {r.provider.name}{r.fromCache ? ' · cache' : ''}</p>
          {r.dataDate && <p className="src-line">Data dos dados: {r.dataDate}</p>}
          {r.evidence.length > 0 && (
            <>
              <h3>Evidências e fontes</h3>
              <ul className="evidence">
                {r.evidence.map((e) => (
                  <li key={e.url}>
                    <a href={e.url} target="_blank" rel="noreferrer noopener">{e.title}</a>
                    {e.snippet && <blockquote>{e.snippet}</blockquote>}
                  </li>
                ))}
              </ul>
            </>
          )}
          {r.limitations.length > 0 && (
            <>
              <h3>Limitações da análise</h3>
              <ul>{r.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
            </>
          )}
        </>
      )}

      {claim.kind === 'factual' && (
        <div className="cta">
          <button className="primary" onClick={openAiMode}>Verificar no Google AI Mode</button>
          {claim.aiModeOpenedAt && <small>Consulta aberta no Google AI Mode — a extensão não lê a resposta dele.</small>}
          {claim.status === 'error' && session.state !== 'ended' && <button onClick={() => send({ type: 'recheck', claimId: claim.id })}>Tentar novamente</button>}
        </div>
      )}
    </main>
  );
}
