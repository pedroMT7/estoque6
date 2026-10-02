// Decodificador rápido para a câmera: ZXing-C++ compilado em WebAssembly (bem mais rápido que a versão em JavaScript).
// Usado quando o navegador não tem leitor próprio (iPhone/Safari, Chrome no Windows, Firefox).
// No Android/Chrome usamos o leitor nativo do sistema (BarcodeDetector), que já é muito rápido.
import { readBarcodes, prepareZXingModule } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

// o arquivo .wasm vem do próprio sistema (não depende de site externo)
prepareZXingModule({ overrides: { locateFile: (arq, prefixo) => (arq.endsWith('.wasm') ? wasmUrl : prefixo + arq) }, fireImmediately: true });

// códigos de barras comuns em etiqueta + QR code e Data Matrix
export const FORMATOS_WASM = ['Code128', 'Code39', 'Code93', 'EAN13', 'EAN8', 'UPCA', 'UPCE', 'ITF', 'Codabar', 'QRCode', 'DataMatrix'];
export const FORMATOS_NATIVOS = ['code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'codabar', 'qr_code', 'data_matrix'];

const OPCOES = { formats: FORMATOS_WASM, tryHarder: true, tryRotate: true, tryInvert: false, tryDownscale: true, maxNumberOfSymbols: 1 };

/** Lê de um ImageData. Retorna { texto, formato } ou null. */
export async function lerImagem(imageData) {
  const r = await readBarcodes(imageData, OPCOES);
  const ok = r.find((x) => x.isValid && x.text);
  return ok ? { texto: ok.text, formato: ok.format } : null;
}
/** Lê de um arquivo de foto (Blob). */
export async function lerArquivo(blob) {
  const r = await readBarcodes(blob, { ...OPCOES, tryInvert: true });
  const ok = r.find((x) => x.isValid && x.text);
  return ok ? ok.text : null;
}
/** Formatos sem dígito verificador obrigatório: pedem 2 leituras iguais para evitar código errado */
export const precisaConfirmar = (formato) => /39|codabar|itf/i.test(String(formato || ''));
