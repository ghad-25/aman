/* AMAN barcode scanner: camera or photo -> raw barcode text.
   Uses the browser's built-in BarcodeDetector when it supports EAN-13 and DataMatrix (Android Chrome),
   otherwise ZXing (iPhone Safari and others), loaded only when needed. */
(function () {
  'use strict';
  const NATIVE = ['ean_13', 'ean_8', 'upc_a', 'data_matrix', 'code_128'];
  let stream = null, timer = null, active = false, nativeDet;

  async function native() {
    if (nativeDet !== undefined) return nativeDet;
    nativeDet = null;
    if ('BarcodeDetector' in window) {
      try {
        const f = await window.BarcodeDetector.getSupportedFormats();
        if (f.includes('ean_13') && f.includes('data_matrix')) nativeDet = new window.BarcodeDetector({ formats: NATIVE.filter((x) => f.includes(x)) });
      } catch (e) { nativeDet = null; }
    }
    return nativeDet;
  }
  function loadZXing() {
    if (window.ZXing) return Promise.resolve(window.ZXing);
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = '/assets/zxing.min.js';
      s.onload = () => res(window.ZXing);
      s.onerror = () => rej(new Error('تعذّر تحميل قارئ الباركود.'));
      document.head.appendChild(s);
    });
  }
  function hints(Z) {
    const h = new Map();
    const F = Z.BarcodeFormat;
    h.set(Z.DecodeHintType.POSSIBLE_FORMATS, [F.EAN_13, F.EAN_8, F.UPC_A, F.DATA_MATRIX, F.CODE_128]);
    h.set(Z.DecodeHintType.TRY_HARDER, true);
    return h;
  }
  function stop() {
    active = false;
    clearTimeout(timer);
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  }
  // ZXing on a canvas: full frame first, then the centre (where the frame guide is).
  let zxReader = null;
  const canvas = document.createElement('canvas');
  function zxDecode(Z, src, w, h) {
    if (!zxReader) { zxReader = new Z.MultiFormatReader(); zxReader.setHints(hints(Z)); }
    const max = 1280, k = Math.min(1, max / Math.max(w, h));
    const tries = [[0, 0, w, h], [w * 0.15, h * 0.15, w * 0.7, h * 0.7]];
    for (const [x, y, cw, ch] of tries) {
      canvas.width = Math.round(cw * k); canvas.height = Math.round(ch * k);
      const c = canvas.getContext('2d', { willReadFrequently: true });
      c.drawImage(src, x, y, cw, ch, 0, 0, canvas.width, canvas.height);
      try {
        const bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)));
        return zxReader.decode(bmp).getText();
      } catch (e) { zxReader.reset(); }
    }
    return null;
  }
  async function start(video, onCode) {
    stop();
    active = true;
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('الكاميرا تحتاج رابطًا آمنًا (https). اختر صورة بدلًا من ذلك.');
    }
    const det = await native();
    const Z = det ? null : await loadZXing();
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    video.muted = true;
    await video.play();
    const tick = async () => {
      if (!active) return;
      try {
        let v = null;
        if (det) { const r = await det.detect(video); if (r && r[0]) v = r[0].rawValue; }
        else if (video.videoWidth) v = zxDecode(Z, video, video.videoWidth, video.videoHeight);
        if (v) { stop(); onCode(v); return; }
      } catch (e) { /* frame not ready */ }
      timer = setTimeout(tick, det ? 150 : 220);
    };
    tick();
    return det ? 'native' : 'zxing';
  }
  async function fromFile(file) {
    const det = await native();
    if (det && window.createImageBitmap) {
      try { const bmp = await createImageBitmap(file); const r = await det.detect(bmp); if (r && r[0]) return r[0].rawValue; } catch (e) { /* fall back */ }
    }
    const Z = await loadZXing();
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      return zxDecode(Z, img, img.naturalWidth, img.naturalHeight);
    } catch (e) { return null; } finally { URL.revokeObjectURL(url); }
  }
  // Human-readable summary of a GS1 string, client side (the server does the real parsing).
  function pretty(raw) {
    const s = String(raw || '').replace(/\u001d/g, ' ');
    return s.length > 40 ? s.slice(0, 40) + '…' : s;
  }
  window.AMANScan = { start, stop, fromFile, pretty };
})();
