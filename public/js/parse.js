// Client-side CV text extraction (pdf.js + mammoth) → upload original to the
// private Storage bucket → POST extracted text to /api/parse.
// Raw files never go to AI; only extracted text leaves the browser.
import { supabase, api } from './supabaseClient.js';
import { t } from './i18n.js';
import { icon } from './icons.js';
import { setProfile, setCredits } from './state.js';

const $ = (id) => document.getElementById(id);

class UploadError extends Error {
  constructor(key) {
    super(key);
    this.key = key; // i18n key
  }
}

// ─── UI helpers ───────────────────────────────────────────────────────

function setStatus(text) {
  const el = $('upload-status');
  if (!text) {
    el.className = 'hidden';
    el.innerHTML = '';
    return;
  }
  el.className = 'alert alert-error';
  const span = document.createElement('span');
  span.textContent = text;
  el.innerHTML = icon('alert');
  el.appendChild(span);
}

function setStage(id, stateName) {
  const el = $(`stage-${id}`);
  if (!el) return;
  el.dataset.state = stateName;
  el.querySelector('.stage-mark').innerHTML =
    stateName === 'done' ? icon('check') : stateName === 'error' ? icon('x') : '';
}

function resetStages() {
  ['read', 'parse', 'save'].forEach((s) => setStage(s, 'idle'));
}

function setBusy(busy) {
  const btn = $('upload-button');
  btn.disabled = busy;
  btn.setAttribute('aria-busy', String(busy));
  $('upload-drop').setAttribute('aria-disabled', String(busy));
}

function showSuccess(show) {
  const el = $('upload-success');
  el.classList.toggle('hidden', !show);
  el.classList.toggle('flex', show);
}

// ─── Extraction ───────────────────────────────────────────────────────

const PDFJS_DIST = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174';
const TESSERACT_SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
const OCR_MAX_PAGES = 4;

const meaningfulLength = (text) => (text || '').replace(/\s+/g, '').length;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing?.dataset.loaded) return resolve();
    const el = existing || document.createElement('script');
    el.addEventListener('load', () => {
      el.dataset.loaded = '1';
      resolve();
    });
    el.addEventListener('error', () => reject(new Error(`failed to load ${src}`)));
    if (!existing) {
      el.src = src;
      el.async = true;
      document.head.appendChild(el);
    }
  });
}

// Scanned / designed PDFs (Canva, exported images) carry no text layer —
// render each page to a canvas and OCR it in the browser (en + fr + ar).
async function ocrPdf(pdf) {
  await loadScript(TESSERACT_SRC);
  const worker = await window.Tesseract.createWorker(['eng', 'fra', 'ara']);
  try {
    const pages = [];
    const count = Math.min(pdf.numPages, OCR_MAX_PAGES);
    for (let i = 1; i <= count; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      const { data } = await worker.recognize(canvas);
      pages.push(data.text || '');
    }
    return pages.join('\n\n');
  } finally {
    await worker.terminate();
  }
}

async function extractPdfText(arrayBuffer) {
  const pdfjsLib = window.pdfjsLib;
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const pdf = await pdfjsLib.getDocument({
    data: arrayBuffer,
    // Without CMaps / standard fonts, PDFs using CID fonts (common from Word
    // and Arabic/French documents) yield empty text.
    cMapUrl: `${PDFJS_DIST}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS_DIST}/standard_fonts/`,
  }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).join(' '));
  }
  const text = pages.join('\n\n');
  if (meaningfulLength(text) >= 40) return text;

  try {
    return await ocrPdf(pdf);
  } catch (err) {
    console.warn('OCR fallback failed:', err);
    return text;
  }
}

async function extractDocxText(arrayBuffer) {
  const result = await window.mammoth.extractRawText({ arrayBuffer });
  return result.value || '';
}

function kindOf(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf';
  if (name.endsWith('.docx')) return 'docx';
  if (name.endsWith('.txt') || file.type.startsWith('text/')) return 'txt';
  return null;
}

async function extractText(file) {
  const buffer = await file.arrayBuffer();
  switch (kindOf(file)) {
    case 'pdf':
      return extractPdfText(buffer);
    case 'docx':
      return extractDocxText(buffer);
    case 'txt':
      return new TextDecoder().decode(buffer);
    default:
      throw new UploadError('upload_unsupported');
  }
}

async function uploadOriginal(file) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) return null;

  const safeName = file.name.replace(/[^\w.\-]+/g, '_');
  const path = `${userId}/${Date.now()}_${safeName}`;
  const { error } = await supabase.storage.from('resumes').upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (error) {
    console.warn('resume upload skipped:', error.message);
    return null; // parsing still proceeds — the file copy is a nice-to-have
  }
  return path;
}

// ─── Flow ─────────────────────────────────────────────────────────────

async function handleFile(file) {
  if (!file) return;
  setStatus(null);
  showSuccess(false);
  resetStages();

  if (!kindOf(file)) {
    setStatus(t('upload_unsupported'));
    return;
  }

  setBusy(true);
  let stage = 'read';
  try {
    setStage('read', 'active');
    const [text, storagePath] = await Promise.all([extractText(file), uploadOriginal(file)]);
    if (meaningfulLength(text) < 40) throw new UploadError('upload_empty_text');
    setStage('read', 'done');

    stage = 'parse';
    setStage('parse', 'active');
    const result = await api('/api/parse', {
      method: 'POST',
      body: {
        resume_text: text,
        filename: file.name,
        storage_path: storagePath,
        mime_type: file.type || null,
      },
    });
    if (!result.ok) {
      setStage('parse', 'error');
      setStatus(result.error || t('error_generic'));
      return;
    }
    setStage('parse', 'done');

    // /api/parse persists the profile before responding.
    stage = 'save';
    setStage('save', 'done');
    setCredits(result.credits_remaining);
    setProfile(result.data.profile_id, result.data.profile);
    showSuccess(true);
    $('upload-success').querySelector('a')?.focus({ preventScroll: true });
  } catch (err) {
    console.error(err);
    setStage(stage, 'error');
    setStatus(err instanceof UploadError ? t(err.key) : t('error_generic'));
  } finally {
    setBusy(false);
  }
}

export function initUpload() {
  const input = $('upload-input');
  const drop = $('upload-drop');

  $('upload-button').addEventListener('click', (e) => {
    e.stopPropagation();
    input.click();
  });
  // Mouse users can click anywhere on the zone; keyboard users use the button.
  drop.addEventListener('click', () => input.click());

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    handleFile(file);
  });

  ['dragenter', 'dragover'].forEach((type) =>
    drop.addEventListener(type, (e) => {
      e.preventDefault();
      drop.classList.add('is-over');
    })
  );
  drop.addEventListener('dragleave', (e) => {
    if (!drop.contains(e.relatedTarget)) drop.classList.remove('is-over');
  });
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-over');
    handleFile(e.dataTransfer?.files?.[0]);
  });

  // Stop the browser from navigating to a file dropped outside the zone.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
}
