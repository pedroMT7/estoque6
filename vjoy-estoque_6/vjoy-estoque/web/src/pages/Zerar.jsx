import { useEffect, useState } from 'react';
import { get, post, qs } from '../api.js';
import { useToast, ErroBox, Carregando } from '../components/ui.jsx';
import { conferirBase } from '../offline.js';

const NOMES = {
  movimentacoes: 'Movimentações de estoque (entradas, saídas, ajustes)', leituras: 'Histórico de bipagens', carregamentos: 'Carregamentos de caminhão',
  carregamento_itens: 'Itens dos caminhões', separacoes: 'Separações', conferencias: 'Conferências', expedicoes: 'Expedições',
  pedidos_mensais: 'Pedidos mensais', pedido_mensal_itens: 'Itens dos pedidos mensais', pedidos: 'Pedidos importados', pedido_itens: 'Itens dos pedidos',
  importacoes: 'Arquivos importados', clientes: 'Clientes',
};

/** Zerar os dados de teste para começar a usar de verdade (somente Administrador) */
export default function Zerar() {
  const toast = useToast();
  const [op, setOp] = useState({ mensais: false, pedidos: false, clientes: false, codigos_bipagem: false });
  const [previa, setPrevia] = useState(null), [erro, setErro] = useState(null);
  const [senha, setSenha] = useState(''), [conf, setConf] = useState('');
  const [baixou, setBaixou] = useState(false), [env, setEnv] = useState(false), [feito, setFeito] = useState(null);
  const efetivo = { ...op, mensais: op.mensais || op.clientes, pedidos: op.pedidos || op.clientes };

  useEffect(() => {
    setPrevia(null); setBaixou(false);
    get('/admin/zerar/previa' + qs(Object.fromEntries(Object.entries(efetivo).map(([k, v]) => [k, v ? '1' : ''])))).then(setPrevia).catch(setErro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [op.mensais, op.pedidos, op.clientes, op.codigos_bipagem]);

  const baixarCopia = async () => {
    try {
      const d = await post('/admin/zerar/copia', { opcoes: efetivo });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 1)], { type: 'application/json' }));
      a.download = `copia-antes-de-zerar-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setBaixou(true);
    } catch (e) { toast(e.message, 'ERRO'); }
  };
  const executar = async () => {
    setEnv(true);
    try {
      const r = await post('/admin/zerar', { senha, confirmacao: conf, opcoes: efetivo });
      conferirBase(r.base_versao); // este aparelho também descarta o que tinha guardado
      setFeito(r); setSenha(''); setConf('');
      toast('Dados de teste zerados');
    } catch (e) { toast(e.message, 'ERRO'); } finally { setEnv(false); }
  };

  if (feito) {
    const total = Object.values(feito.apagados).reduce((a, b) => a + b, 0) + feito.codigos_bipagem + feito.produtos_bipagem;
    return (
      <div className="pagina">
        <h1>🧹 Dados zerados</h1>
        <div className="resultado ok"><div className="resultado-titulo">✓ Pronto para começar a usar de verdade</div>
          <div className="resultado-linha">{total} registros de teste apagados. Estoque, caminhões e histórico começam do zero (o próximo carregamento é o Nº 00001).</div>
          <div className="resultado-linha">Os celulares descartam sozinhos as leituras de teste que tinham guardado, na próxima vez que abrirem o sistema.</div>
        </div>
        <p className="muted pequeno">Ficou registrado no log de auditoria quem zerou e quando.</p>
      </div>
    );
  }
  const n = previa?.tabelas || {};
  const linhas = Object.entries(n).filter(([t]) => NOMES[t]);
  const pode = senha && conf.trim().toUpperCase() === 'ZERAR' && !env;
  return (
    <div className="pagina">
      <h1>🧹 Zerar dados de teste</h1>
      <p>Apaga os dados criados durante os testes para começar a usar o sistema de verdade. <b>Não pode ser desfeito.</b></p>
      <div className="painel">
        <h3 className="sec">Sempre é apagado</h3>
        <ul className="lista-simples">
          <li>✓ <b>Estoque</b>: todas as entradas, saídas e ajustes (o estoque de todos os clientes fica zerado)</li>
          <li>✓ <b>Carregamentos</b> de caminhão e seus romaneios (a numeração volta para 00001)</li>
          <li>✓ Histórico de bipagens, separações, conferências e expedições</li>
        </ul>
        <h3 className="sec">Apagar também (opcional)</h3>
        <label className="check-linha"><input type="checkbox" checked={efetivo.mensais} disabled={op.clientes} onChange={(e) => setOp({ ...op, mensais: e.target.checked })} /> Pedidos mensais dos clientes</label>
        <label className="check-linha"><input type="checkbox" checked={efetivo.pedidos} disabled={op.clientes} onChange={(e) => setOp({ ...op, pedidos: e.target.checked })} /> Pedidos importados (CSV)</label>
        <label className="check-linha"><input type="checkbox" checked={op.clientes} onChange={(e) => setOp({ ...op, clientes: e.target.checked })} /> Clientes (apaga junto os pedidos e pedidos mensais deles)</label>
        <label className="check-linha"><input type="checkbox" checked={op.codigos_bipagem} onChange={(e) => setOp({ ...op, codigos_bipagem: e.target.checked })} /> Etiquetas ligadas a produtos durante a bipagem e produtos cadastrados na bipagem</label>
        <h3 className="sec">Nunca é apagado</h3>
        <p className="muted pequeno">Catálogo de produtos, usuários, ruas e o log de auditoria.</p>
      </div>

      <h3 className="sec">O que será apagado agora</h3>
      <ErroBox erro={erro} />
      {!previa ? <Carregando /> : (
        <div className="tabela-rolagem"><table className="tabela">
          <tbody>
            {linhas.map(([t, q]) => <tr key={t}><td>{NOMES[t]}</td><td className="num"><b>{q}</b></td></tr>)}
            {previa.codigos_bipagem != null && <tr><td>Etiquetas ligadas na bipagem</td><td className="num"><b>{previa.codigos_bipagem}</b></td></tr>}
            {previa.produtos_bipagem != null && <tr><td>Produtos cadastrados na bipagem (se não usados)</td><td className="num"><b>{previa.produtos_bipagem}</b></td></tr>}
          </tbody>
        </table></div>
      )}

      <div className="painel form" style={{ marginTop: '1rem' }}>
        <button className="btn btn-leve btn-bloco" onClick={baixarCopia}>📥 {baixou ? 'Cópia baixada ✓ (baixar de novo)' : 'Baixar uma cópia antes de zerar (recomendado)'}</button>
        <label>Sua senha de Administrador<input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" /></label>
        <label><span>Digite <b>ZERAR</b> para confirmar</span><input value={conf} onChange={(e) => setConf(e.target.value)} autoCapitalize="characters" autoComplete="off" /></label>
        <button className="btn btn-perigo btn-bloco btn-g" disabled={!pode} onClick={executar}>{env ? 'Zerando…' : '🧹 Zerar dados de teste'}</button>
      </div>
    </div>
  );
}
