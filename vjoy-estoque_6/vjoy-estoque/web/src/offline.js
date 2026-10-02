// Funcionamento sem internet no carregamento do caminhão.
// - Cada leitura confirmada sem conexão fica guardada no aparelho (localStorage), com uma chave única.
// - Quando a conexão volta, as leituras são enviadas em ordem. O servidor usa a chave para nunca
//   registrar a mesma leitura duas vezes (mesmo que o envio se repita).
// - O catálogo (código + descrição) fica copiado no aparelho para a tela de confirmação funcionar offline.
import { get, post, semConexao } from './api.js';

const K_FILA = 'vjoy_fila_carregamento';
const K_CAT = 'vjoy_catalogo';
const ler = (k, padrao) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : padrao; } catch { return padrao; } };
const gravar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
const avisar = () => window.dispatchEvent(new Event('vjoy-fila'));
const novaChave = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

// ---------------------------------------------------------------- fila de leituras
export const lerFila = () => ler(K_FILA, []);
const salvarFila = (f) => { const ok = gravar(K_FILA, f); avisar(); return ok; };
export const filaDo = (carregamentoId) => lerFila().filter((x) => x.carregamento_id === +carregamentoId);

// carregamento sem confirmação: peça sem entrada no estoque e acima do pedido do mês são aceitas (e ficam registradas como alerta)
export const ACEITAR_CARREGAMENTO = ['SEM_ESTOQUE', 'ACIMA_PEDIDO'];
export function guardarLeitura({ carregamento_id, codigo, quantidade, produto, produto_codigo }) {
  const item = { chave: novaChave(), base: baseAtual(), carregamento_id: +carregamento_id, codigo, quantidade, produto: produto || null, produto_codigo: produto_codigo || null, lido_em: new Date().toISOString(), estado: 'PENDENTE', confirmar: ACEITAR_CARREGAMENTO };
  if (!salvarFila([...lerFila(), item])) throw new Error('Memória do aparelho cheia: não foi possível guardar a leitura.');
  return item;
}
export function alterarLeitura(chave, mudanca) { salvarFila(lerFila().map((x) => (x.chave === chave ? { ...x, ...mudanca } : x))); }
export function descartarLeitura(chave) { salvarFila(lerFila().filter((x) => x.chave !== chave)); }

let enviando = null;
/** Envia as leituras guardadas, em ordem. Para no primeiro erro de conexão. */
export function sincronizar() {
  if (enviando) return enviando;
  enviando = (async () => {
    let enviadas = 0;
    for (const item of lerFila()) {
      if (item.base && item.base !== baseAtual()) { descartarLeitura(item.chave); continue; } // leitura de uma base que foi zerada
      if (item.estado !== 'PENDENTE') continue;
      try {
        await post(`/carregamentos/${item.carregamento_id}/bipar`, { codigo: item.codigo, quantidade: item.quantidade, confirmar: item.confirmar?.length ? item.confirmar : ACEITAR_CARREGAMENTO, produto_codigo: item.produto_codigo || undefined, chave: item.chave, lido_em: item.lido_em });
        descartarLeitura(item.chave);
        enviadas++;
      } catch (e) {
        if (semConexao(e) || e.status === 401) break; // ainda sem internet (ou precisa entrar de novo): tenta depois
        // o servidor respondeu mas precisa de decisão do operador (sem estoque, acima do pedido, código desconhecido...)
        alterarLeitura(item.chave, { estado: e.codigo === 'CONFIRMAR' ? 'CONFIRMAR' : 'ERRO', tipo: e.dados?.tipo || e.codigo || null, mensagem: e.message });
      }
    }
    return enviadas;
  })().finally(() => { enviando = null; });
  return enviando;
}
let iniciado = false;
export function iniciarSincronizacao() {
  if (iniciado) return; iniciado = true;
  const tentar = () => { if (lerFila().some((x) => x.estado === 'PENDENTE')) sincronizar(); };
  window.addEventListener('online', tentar);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && tentar());
  setInterval(tentar, 8000);
  tentar();
  atualizarCatalogo();
}

// ---------------------------------------------------------------- catálogo no aparelho
let indice = null;
function montarIndice(cat) {
  const porCodigo = new Map(), porBarras = new Map();
  for (const [codigo, descricao, barras] of cat?.itens || []) {
    const p = { codigo, descricao };
    porCodigo.set(codigo, p);
    for (const b of barras || []) porBarras.set(b, p);
  }
  indice = { porCodigo, porBarras, codigos: [...porCodigo.keys()].filter((c) => c.length >= 6) };
}
export async function atualizarCatalogo(forcar = false) {
  const cat = ler(K_CAT, null);
  if (cat && !indice) montarIndice(cat);
  if (!forcar && cat && Date.now() - Date.parse(cat.gerado_em) < 6 * 3600e3) return;
  try {
    const novo = await get('/produtos/offline');
    gravar(K_CAT, novo); montarIndice(novo);
  } catch { /* sem internet: usa a cópia que já existe */ }
}
/** Mesma lógica do servidor, simplificada: Código, código de barras/vinculado, etiqueta que contém o Código */
export function identificarLocal(lido) {
  if (!indice) { const cat = ler(K_CAT, null); if (!cat) return null; montarIndice(cat); }
  const cod = String(lido || '').trim().toUpperCase();
  if (!cod) return null;
  const p = indice.porBarras.get(cod) || indice.porCodigo.get(cod);
  if (p) return p;
  if (cod.length >= 6) {
    const achados = indice.codigos.filter((c) => cod.includes(c)).sort((a, b) => b.length - a.length);
    if (achados.length && (achados.length === 1 || achados[0].length > achados[1].length)) return indice.porCodigo.get(achados[0]);
  }
  return null;
}

// ---------------------------------------------------------------- cópia do carregamento aberto
export const guardarCarregamento = (c) => gravar('vjoy_car_' + c.id, c);
export const carregamentoGuardado = (id) => ler('vjoy_car_' + id, null);
export const aoMudarFila = (fn) => { window.addEventListener('vjoy-fila', fn); return () => window.removeEventListener('vjoy-fila', fn); };

/** Sugestões enquanto o operador digita o código do produto (cópia do catálogo no aparelho) */
export function buscarLocal(texto, limite = 6) {
  if (!indice) { const cat = ler(K_CAT, null); if (!cat) return []; montarIndice(cat); }
  const t = String(texto || '').trim().toUpperCase();
  if (t.length < 2) return [];
  const r = [];
  for (const [cod, p] of indice.porCodigo) { if (cod.startsWith(t)) { r.push(p); if (r.length >= limite) return r; } }
  for (const [cod, p] of indice.porCodigo) { if (!cod.startsWith(t) && cod.includes(t)) { r.push(p); if (r.length >= limite) break; } }
  return r;
}

// ---------------------------------------------------------------- base zerada pelo administrador
export const baseAtual = () => { try { return localStorage.getItem('vjoy_base_versao'); } catch { return null; } };
/** Chamado ao entrar: se a base mudou (dados de teste zerados), descarta tudo que o aparelho guardou da base antiga */
export function conferirBase(versao) {
  if (!versao) return;
  if (baseAtual() === versao) return;
  try {
    for (const k of Object.keys(localStorage)) if (k === K_FILA || k.startsWith('vjoy_car_') || k === 'vjoy_clientes_recentes') localStorage.removeItem(k);
    localStorage.setItem('vjoy_base_versao', versao);
  } catch {}
  avisar();
}
