// Zerar dados de teste antes de começar a usar de verdade (somente ADMINISTRADOR).
// O catálogo de produtos, os usuários, as ruas e o registro de auditoria (logs) NUNCA são apagados.
import bcrypt from 'bcryptjs';
import { q, tx } from '../db.js';
import { falha } from '../erros.js';
import { log } from '../auth.js';

// Estoque, movimentações, carregamentos e histórico de leituras andam juntos (são ligados entre si)
const BASE = ['movimentacao_itens', 'ajustes', 'leituras', 'envios_aparelho', 'movimentacoes', 'carregamento_itens', 'carregamentos',
  'expedicao_conferencias', 'expedicoes', 'conferencia_itens', 'conferencias', 'separacoes'];
const MENSAIS = ['pedido_mensal_itens', 'pedidos_mensais'];
const PEDIDOS = ['pedido_itens', 'pedidos', 'importacao_linhas', 'importacoes'];
const CLIENTES = ['cliente_aliases', 'clientes'];

const contar = async (c, tabelas) => {
  const r = {};
  for (const t of tabelas) r[t] = (await c.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n;
  return r;
};

/** Normaliza as opções: apagar clientes exige apagar os pedidos e pedidos mensais deles */
export function opcoesZerar(o = {}) {
  const clientes = !!o.clientes;
  return { estoque: true, mensais: clientes || !!o.mensais, pedidos: clientes || !!o.pedidos, clientes, codigos_bipagem: !!o.codigos_bipagem };
}
const tabelasDe = (op) => [...BASE, ...(op.mensais ? MENSAIS : []), ...(op.pedidos ? PEDIDOS : []), ...(op.clientes ? CLIENTES : [])];

/** Prévia: quantos registros serão apagados */
export async function previaZerar(opcoes) {
  const op = opcoesZerar(opcoes);
  const n = await contar({ query: q }, tabelasDe(op));
  const extras = op.codigos_bipagem ? {
    codigos_bipagem: (await q(`SELECT count(*)::int n FROM produto_codigos WHERE origem='BIPAGEM'`)).rows[0].n,
    produtos_bipagem: (await q(`SELECT count(*)::int n FROM produtos WHERE descricao LIKE '%(cadastrado na bipagem)%'`)).rows[0].n,
  } : {};
  return { opcoes: op, tabelas: n, ...extras };
}

/** Cópia de segurança (JSON) de tudo que será apagado */
export async function copiaZerar(opcoes) {
  const op = opcoesZerar(opcoes);
  const dados = {};
  for (const t of tabelasDe(op)) dados[t] = (await q(`SELECT * FROM ${t}`)).rows;
  if (op.codigos_bipagem) dados.produto_codigos_bipagem = (await q(`SELECT * FROM produto_codigos WHERE origem='BIPAGEM'`)).rows;
  return { gerado_em: new Date().toISOString(), opcoes: op, dados };
}

export async function zerar({ senha, confirmacao, opcoes }, usuario) {
  if (usuario.perfil !== 'ADMIN') falha('Somente o Administrador pode zerar os dados.', { status: 403 });
  if (String(confirmacao || '').trim().toUpperCase() !== 'ZERAR') falha('Digite ZERAR para confirmar.');
  const u = (await q('SELECT * FROM usuarios WHERE id=$1', [usuario.id])).rows[0];
  if (!u || !(await bcrypt.compare(String(senha || ''), u.senha_hash))) falha('Senha incorreta.', { status: 403, codigo: 'SENHA_INVALIDA' });
  const op = opcoesZerar(opcoes);
  return tx(async (c) => {
    const tabelas = tabelasDe(op);
    const antes = await contar(c, tabelas);
    // TRUNCATE não dispara as travas de "histórico imutável" (que bloqueiam apenas alteração/exclusão linha a linha)
    await c.query(`TRUNCATE ${tabelas.join(', ')} RESTART IDENTITY`);
    let codigos = 0, produtos = 0;
    if (op.codigos_bipagem) {
      codigos = (await c.query(`DELETE FROM produto_codigos WHERE origem='BIPAGEM'`)).rowCount;
      produtos = (await c.query(`DELETE FROM produtos p WHERE p.descricao LIKE '%(cadastrado na bipagem)%'
        AND NOT EXISTS (SELECT 1 FROM produto_codigos x WHERE x.produto_id=p.id)
        AND NOT EXISTS (SELECT 1 FROM pedido_itens x WHERE x.produto_id=p.id)
        AND NOT EXISTS (SELECT 1 FROM pedido_mensal_itens x WHERE x.produto_id=p.id)`)).rowCount;
    }
    const versao = (await c.query(`INSERT INTO sistema_config(chave,valor,atualizado_em) VALUES ('base_versao', md5(random()::text), now())
      ON CONFLICT (chave) DO UPDATE SET valor=EXCLUDED.valor, atualizado_em=now() RETURNING valor`)).rows[0].valor;
    const resumo = { opcoes: op, apagados: antes, codigos_bipagem: codigos, produtos_bipagem: produtos };
    await log(usuario.id, 'DADOS_ZERADOS', 'sistema', null, resumo, c);
    return { ok: true, base_versao: versao, ...resumo };
  });
}

export async function versaoBase() {
  try { return (await q(`SELECT valor FROM sistema_config WHERE chave='base_versao'`)).rows[0]?.valor || null; } catch { return null; }
}
