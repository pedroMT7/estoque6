// Versão de teste: PostgreSQL rodando dentro do navegador (PGlite / WebAssembly).
// Substitui server/db.js no build de teste. As regras de negócio (server/services) são as mesmas.
import { PGlite } from '@electric-sql/pglite';
// todas as migrações do servidor, em ordem (novas entram sozinhas)
const MIGRACOES = Object.entries(import.meta.glob('../../../server/migrations/*.sql', { query: '?raw', import: 'default', eager: true }))
  .map(([caminho, sql]) => [caminho.split('/').pop(), sql]).sort(([a], [b]) => a.localeCompare(b));

let db = null;
export let modoArmazenamento = 'navegador';
export const NOME_BANCO = 'vjoy-teste';

const parsers = { 20: (v) => parseInt(v, 10), 1700: (v) => parseFloat(v), 1082: (v) => v };
const mapear = (r) => ({ rows: r.rows, rowCount: r.affectedRows ?? r.rows.length });

export async function iniciarBanco() {
  try {
    db = await PGlite.create(`idb://${NOME_BANCO}`, { parsers });
  } catch (e) {
    console.warn('IndexedDB indisponível, usando memória', e);
    db = await PGlite.create({ parsers });
    modoArmazenamento = 'memoria';
  }
  await migrar();
}

export const q = async (text, params) => mapear(await db.query(text, params));
export const pool = { query: q };

// Conexão única: as requisições são enfileiradas pelo servidor local, então BEGIN/COMMIT é seguro.
export async function tx(fn) {
  await db.query('BEGIN');
  try {
    const r = await fn({ query: q });
    await db.query('COMMIT');
    return r;
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw e;
  }
}

export async function migrar() {
  await db.exec(`CREATE TABLE IF NOT EXISTS _migracoes (nome TEXT PRIMARY KEY, aplicado_em TIMESTAMPTZ DEFAULT now())`);
  const feitas = new Set((await q('SELECT nome FROM _migracoes')).rows.map((r) => r.nome));
  for (const [nome, sql] of MIGRACOES) {
    if (!feitas.has(nome)) await db.exec('BEGIN;\n' + sql + `\nINSERT INTO _migracoes(nome) VALUES ('${nome}');\nCOMMIT;`);
  }
}

export async function fecharBanco() { try { await db?.close(); } catch {} }
