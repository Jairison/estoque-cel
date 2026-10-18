/* Império Cell — leitor de IMEI pela câmera + foto como comprovante
 * openImeiScanner() abre a câmera traseira e lê o IMEI de duas formas, ao mesmo tempo:
 *   1) código de barras (caixa do iPhone, tela *#06#): BarcodeDetector nativo ou ZXing;
 *   2) números impressos/na tela, sem código de barras ("IMEI 35 201340 264948 4"): OCR com Tesseract.js.
 * Em ambos os casos só aceita IMEI válido (15 dígitos + dígito verificador). Devolve { imei, photo, via }.
 */
'use strict';

const ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.23.0/umd/index.min.js';
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';
const TESSERACT_WORKER = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js';
const TESSERACT_CORE = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0';
const PHOTO_MAX_SIDE = 960;
const PHOTO_MAX_CHARS = 420000; // limite seguro por foto no banco de dados

let zxingLoading = null;
function loadZxing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (!zxingLoading) {
    zxingLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = ZXING_URL;
      s.onload = () => resolve(window.ZXing);
      s.onerror = () => { zxingLoading = null; reject(new Error('Não foi possível carregar o leitor de código de barras. Verifique a internet.')); };
      document.head.append(s);
    });
  }
  return zxingLoading;
}

// ── Leitura dos números (OCR). Carregado só quando a câmera é aberta; o navegador guarda em cache.
let ocrLoading = null;
function loadOcr() {
  if (!ocrLoading) {
    ocrLoading = (async () => {
      if (!window.Tesseract) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = TESSERACT_URL;
          s.onload = resolve;
          s.onerror = () => reject(new Error('Não foi possível carregar o leitor de números.'));
          document.head.append(s);
        });
      }
      const worker = await window.Tesseract.createWorker('eng', 1, { workerPath: TESSERACT_WORKER, corePath: TESSERACT_CORE });
      await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
      return worker;
    })().catch((e) => { ocrLoading = null; throw e; });
  }
  return ocrLoading;
}

// Prepara a imagem para o OCR: tons de cinza, contraste e ampliação
function ocrCanvas(src, w, h, band) {
  const sx = 0, sw = w;
  const sh = band ? Math.round(h * 0.5) : h, sy = band ? Math.round((h - sh) / 2) : 0;
  const scale = Math.min(2, 1800 / sw);
  const c = document.createElement('canvas');
  c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.filter = 'grayscale(1) contrast(1.6)';
  x.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}
async function ocrRead(canvas) {
  const worker = await loadOcr();
  const { data } = await worker.recognize(canvas);
  return imeiFromText(data.text);
}

// Extrai o IMEI do texto lido. Corrige trocas comuns do OCR (O→0, I→1, S→5, B→8…), junta grupos
// separados por espaço ("35 201340 264948 4") e ignora EID, ICCID e outros números longos.
const OCR_FIX = { O: '0', o: '0', Q: '0', D: '0', I: '1', l: '1', '|': '1', i: '1', '!': '1', S: '5', s: '5', B: '8', Z: '2', z: '2', G: '6', g: '9', q: '9' };
function imeiFromText(text) {
  const found = [];
  for (const raw of String(text || '').split(/\n/)) {
    const line = raw.replace(/(IMEI|MEID|IMEl|lMEI|1MEI|IME1|EID|SN|S\/N)\s*2?\s*[:#.]?/gi, ' ').replace(/[:;,()[\]]/g, ' ');
    const toks = line.split(/\s+/).filter(Boolean).map((t) => {
      const real = t.replace(/\D/g, '').length;
      const digits = [...t].map((c) => (/\d/.test(c) ? c : OCR_FIX[c] ?? '')).join('');
      return real >= 1 && digits.length === t.length && t.length <= 15 ? digits : null;
    });
    for (let i = 0; i < toks.length; i++) {
      if (!toks[i]) continue;
      let acc = '';
      for (let j = i; j < toks.length && toks[j]; j++) { acc += toks[j]; if (acc.length >= 15) break; }
      if (acc.length === 15 && imeiLuhnOk(acc) && !found.includes(acc)) found.push(acc);
    }
  }
  return found[0] || '';
}

// IMEI válido: 15 dígitos com dígito verificador (Luhn)
function imeiLuhnOk(s) {
  let sum = 0;
  for (let i = 0; i < s.length; i++) { let d = +s[s.length - 1 - i]; if (i % 2) { d *= 2; if (d > 9) d -= 9; } sum += d; }
  return sum % 10 === 0;
}
function extractImei(text) {
  const digits = String(text || '').replace(/[^\d]/g, ' ');
  for (const m of digits.matchAll(/\d{15,}/g)) {
    const seq = m[0];
    for (let i = 0; i + 15 <= seq.length; i++) { const c = seq.slice(i, i + 15); if (imeiLuhnOk(c)) return c; }
  }
  return '';
}

// Foto comprimida (JPEG) a partir de um canvas/vídeo/imagem
function makePhoto(source, w, h) {
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  for (const q of [0.7, 0.55, 0.4, 0.3]) {
    const url = c.toDataURL('image/jpeg', q);
    if (url.length <= PHOTO_MAX_CHARS) return url;
  }
  c.width = Math.round(c.width * 0.6); c.height = Math.round(c.height * 0.6);
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.4);
}

// Decodificadores
async function makeDecoder() {
  if ('BarcodeDetector' in window) {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const formats = ['code_128', 'code_39', 'ean_13', 'qr_code', 'data_matrix', 'pdf417'].filter((f) => supported.includes(f));
      if (formats.includes('code_128')) {
        const det = new window.BarcodeDetector({ formats });
        return async (canvas) => (await det.detect(canvas)).map((b) => b.rawValue);
      }
    } catch { /* usa ZXing */ }
  }
  const Z = await loadZxing();
  const hints = new Map();
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.QR_CODE, Z.BarcodeFormat.DATA_MATRIX]);
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  const reader = new Z.MultiFormatReader();
  reader.setHints(hints);
  return async (canvas) => {
    try {
      const bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)));
      return [reader.decode(bmp).getText()];
    } catch { return []; } // nenhum código neste quadro
  };
}

// Recorta uma faixa central (onde fica o guia) para leitura mais confiável
function frameCanvas(src, w, h, band) {
  const c = document.createElement('canvas');
  const maxW = 1280;
  const s = Math.min(1, maxW / w);
  if (band) {
    const bh = Math.round(h * 0.42), by = Math.round((h - bh) / 2);
    c.width = Math.round(w * s); c.height = Math.round(bh * s);
    c.getContext('2d').drawImage(src, 0, by, w, bh, 0, 0, c.width, c.height);
  } else {
    c.width = Math.round(w * s); c.height = Math.round(h * s);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  }
  return c;
}

/* Modo contínuo (entrada de estoque): a câmera continua aberta e cada IMEI novo é entregue em onScan.
 * onScan({ imei, photo }) pode devolver um texto de erro para recusar aquele IMEI (ex.: já cadastrado). */
function openImeiScanner({ title = 'Ler IMEI pela câmera', continuous = false, onScan } = {}) {
  return new Promise((resolve) => {
    let stream = null, timer = null, done = false, decoder = null, busy = false, tick = 0, pauseUntil = 0;
    let ocrTimer = null, ocrBusy = false, ocrReady = false, ocrLast = '';
    const seen = new Set();
    const results = [];
    const m = openModal({
      title,
      subtitle: continuous
        ? 'Aponte para o código de barras ou para os números do IMEI de cada aparelho, um de cada vez. A câmera continua aberta para o próximo.'
        : 'Aponte para o código de barras ou para os números do IMEI (caixa do iPhone, tela *#06# ou Ajustes → Sobre).',
      body: `
        <div class="scanner">
          <video playsinline muted autoplay data-video></video>
          <div class="scanner-guide"><span></span></div>
          <div class="scanner-status" data-status>${icon('barcode')}Iniciando a câmera…</div>
          <div class="scanner-ocr" data-ocr>${icon('file')}Leitor de números carregando…</div>
        </div>
        <div class="scanner-actions">
          <button class="btn btn-primary" data-shot disabled>${icon('eye')}Tirar foto agora</button>
          <label class="btn">${icon('download')}Escolher foto<input type="file" accept="image/*" capture="environment" data-file hidden></label>
        </div>
        <div data-result></div>
        ${continuous ? '<div class="scan-list" data-list></div>' : ''}`,
      foot: continuous
        ? `<span class="muted" data-count style="margin-right:auto">Nenhum IMEI lido ainda</span><button class="btn btn-primary" data-close>${icon('check')}Concluir</button>`
        : `<button class="btn" data-close>Cancelar</button>`,
      onClose: () => { stop(); if (!done) { done = true; resolve(continuous ? results : null); } },
    });
    const video = m.$('[data-video]');
    const status = (html, kind = '') => { const el = m.$('[data-status]'); el.className = `scanner-status ${kind}`; el.innerHTML = html; };

    function stop() {
      clearInterval(timer); timer = null;
      clearInterval(ocrTimer); ocrTimer = null;
      stream?.getTracks().forEach((t) => t.stop()); stream = null;
    }
    function finish(imei, photo) {
      ocrLast = '';
      if (continuous) return accept(imei, photo);
      done = true;
      stop();
      navigator.vibrate?.(120);
      resolve({ imei, photo });
      m.close();
    }
    // Modo contínuo: registra o IMEI e segue escaneando o próximo aparelho
    function accept(imei, photo) {
      if (seen.has(imei)) { status(`${icon('check')}IMEI ${imei} já foi lido. Aponte para o próximo aparelho.`, 'ok'); return; }
      const error = onScan?.({ imei, photo });
      if (error) { status(`${icon('alert')}${esc(error)}`, 'warn'); pauseUntil = Date.now() + 1500; return; }
      seen.add(imei);
      results.push({ imei, photo });
      navigator.vibrate?.(120);
      status(`${icon('check')}IMEI ${imei} adicionado. Aponte para o próximo aparelho.`, 'ok');
      pauseUntil = Date.now() + 1200;
      m.$('[data-count]').textContent = `${results.length} IMEI${results.length > 1 ? 's' : ''} lido${results.length > 1 ? 's' : ''}`;
      m.$('[data-list]').insertAdjacentHTML('afterbegin', `<div class="scan-item"><img src="${photo}" alt=""><span class="mono">${esc(imei)}</span>${icon('check')}</div>`);
    }
    function resume() {
      m.$('[data-result]').innerHTML = '';
      if (!stream) start();
      else { if (!timer) timer = setInterval(scanFrame, 350); if (!ocrTimer) ocrTimer = setInterval(ocrFrame, 900); }
    }

    // Foto sem IMEI legível: deixa usar a foto e digitar o IMEI
    function showFallback(photo) {
      stop();
      status(`${icon('alert')}Não encontrei um IMEI válido nesta foto (nem código de barras, nem números).`, 'warn');
      m.$('[data-result]').innerHTML = `
        <div class="scanner-fallback">
          <img src="${photo}" alt="Foto capturada">
          <div style="flex:1;min-width:200px">
            <div class="field"><label>Digite o IMEI que aparece na foto</label>
              <input class="input mono" data-manual inputmode="numeric" maxlength="20" placeholder="15 dígitos"></div>
            <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
              <button class="btn btn-primary btn-sm" data-use>${icon('check')}Usar foto e IMEI</button>
              <button class="btn btn-sm" data-retry>${icon('refresh')}Tentar de novo</button>
            </div>
          </div>
        </div>`;
      m.$('[data-manual]').focus();
      m.$('[data-use]').addEventListener('click', () => {
        const imei = m.$('[data-manual]').value.replace(/\D/g, '');
        if (imei.length !== 15 || !imeiLuhnOk(imei)) return toast('IMEI inválido: confira os 15 dígitos.', 'error');
        finish(imei, photo);
        if (continuous) resume();
      });
      m.$('[data-retry]').addEventListener('click', () => { m.$('[data-result]').innerHTML = ''; start(); });
    }

    async function tryDecode(canvasFull, w, h, srcForPhoto) {
      if (decoder) {
        for (const c of [frameCanvas(srcForPhoto, w, h, true), canvasFull]) {
          const texts = await decoder(c);
          for (const t of texts) { const imei = extractImei(t); if (imei) return imei; }
        }
      }
      // sem código de barras: tenta ler os números impressos
      status(`${icon('file')}Lendo os números do IMEI na foto…`);
      try {
        for (const band of [true, false]) {
          const imei = await ocrRead(ocrCanvas(srcForPhoto, w, h, band));
          if (imei) return imei;
        }
      } catch (e) { console.warn(e); }
      return '';
    }

    // Leitura dos números ao vivo: só aceita quando o mesmo IMEI é lido duas vezes seguidas
    async function ocrFrame() {
      if (!ocrReady || ocrBusy || done || !video.videoWidth || Date.now() < pauseUntil) return;
      ocrBusy = true;
      try {
        const w = video.videoWidth, h = video.videoHeight;
        const imei = await ocrRead(ocrCanvas(video, w, h, true));
        if (done || Date.now() < pauseUntil) return;
        if (imei && imei === ocrLast) { status(`${icon('check')}IMEI ${imei} (números)`, 'ok'); finish(imei, makePhoto(video, w, h)); }
        else if (imei) { ocrLast = imei; status(`${icon('file')}Números lidos: ${imei}. Confirmando… mantenha o celular firme.`); }
      } catch (e) { console.warn(e); } finally { ocrBusy = false; }
    }

    async function scanFrame() {
      if (busy || done || !video.videoWidth || Date.now() < pauseUntil) return;
      busy = true;
      try {
        const w = video.videoWidth, h = video.videoHeight;
        const full = frameCanvas(video, w, h, false);
        tick++;
        // alterna entre a faixa central e o quadro inteiro para economizar processamento
        const texts = await decoder(tick % 2 ? frameCanvas(video, w, h, true) : full);
        for (const t of texts) {
          const imei = extractImei(t);
          if (imei) { status(`${icon('check')}IMEI ${imei}`, 'ok'); return finish(imei, makePhoto(video, w, h)); }
        }
        if (texts.length) status(`${icon('barcode')}Código lido, mas não é um IMEI. Aponte para o código do <b>IMEI</b>.`, 'warn');
      } finally { busy = false; }
    }

    async function start() {
      if (!ocrReady) {
        loadOcr().then(() => {
          ocrReady = true;
          const el = m.$('[data-ocr]');
          if (el) { el.innerHTML = `${icon('check')}Lê código de barras e números`; el.classList.add('ready'); }
        }).catch(() => { const el = m.$('[data-ocr]'); if (el) el.innerHTML = `${icon('alert')}Leitura de números indisponível (sem internet?)`; });
      }
      try {
        decoder ||= await makeDecoder();
      } catch (e) { status(`${icon('alert')}${esc(e.message)}`, 'warn'); return; }
      if (!navigator.mediaDevices?.getUserMedia) {
        status(`${icon('alert')}Este navegador não permite usar a câmera ao vivo. Use “Escolher foto”.`, 'warn');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (done) return stop();
        video.srcObject = stream;
        await video.play().catch(() => {});
        m.$('[data-shot]').disabled = false;
        status(`${icon('barcode')}Procurando o IMEI (código de barras ou números)… mantenha o celular firme.`);
        timer = setInterval(scanFrame, 350);
        ocrTimer = setInterval(ocrFrame, 900);
      } catch (e) {
        const denied = e?.name === 'NotAllowedError' || e?.name === 'SecurityError';
        status(`${icon('alert')}${denied ? 'Permita o acesso à câmera nas configurações do navegador, ou use “Escolher foto”.' : 'Não foi possível abrir a câmera. Use “Escolher foto”.'}`, 'warn');
      }
    }

    // Foto manual do quadro atual
    m.$('[data-shot]').addEventListener('click', async () => {
      if (!video.videoWidth) return;
      const w = video.videoWidth, h = video.videoHeight;
      const photo = makePhoto(video, w, h);
      clearInterval(timer); timer = null;
      clearInterval(ocrTimer); ocrTimer = null;
      status(`${icon('barcode')}Analisando a foto…`);
      const imei = await tryDecode(frameCanvas(video, w, h, false), w, h, video);
      if (imei) { finish(imei, photo); if (continuous) resume(); } else showFallback(photo);
    });

    // Foto da galeria / câmera nativa (funciona mesmo sem câmera ao vivo)
    m.$('[data-file]').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      stop();
      status(`${icon('barcode')}Analisando a foto…`);
      const img = new Image();
      img.src = URL.createObjectURL(file);
      try { await img.decode(); } catch { return status(`${icon('alert')}Não foi possível abrir esta imagem.`, 'warn'); }
      decoder ||= await makeDecoder().catch(() => null);
      const w = img.naturalWidth, h = img.naturalHeight;
      const photo = makePhoto(img, w, h);
      const imei = await tryDecode(frameCanvas(img, w, h, false), w, h, img);
      URL.revokeObjectURL(img.src);
      e.target.value = '';
      if (imei) { finish(imei, photo); if (continuous) resume(); } else showFallback(photo);
    });

    start();
  });
}

// Miniatura clicável para ver a foto em tamanho maior
function openPhotoViewer(src, caption = '') {
  openModal({
    size: 'lg', title: 'Foto do IMEI', subtitle: esc(caption),
    body: `<img src="${src}" alt="Foto do IMEI" style="width:100%;border-radius:14px;display:block">`,
    foot: `<a class="btn" href="${src}" download="imei-${esc(caption.replace(/\D/g, '') || 'foto')}.jpg">${icon('download')}Baixar</a><button class="btn btn-primary" data-close>Fechar</button>`,
  });
}
