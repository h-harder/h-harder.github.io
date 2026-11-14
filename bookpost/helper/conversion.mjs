export const CONVERTER = 'https://www.acsm-converter.com';
export const ACSM_LIMIT = 1024 * 1024;

export async function inspectTicket(file) {
  if (!/\.(acsm|ascm)$/i.test(file.name)) throw new Error('Choose the .acsm file supplied by your bookstore or library.');
  if (!file.size || file.size > ACSM_LIMIT) throw new Error('An ACSM ticket must be between 1 byte and 1 MiB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' :
    bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  const xml = new DOMParser().parseFromString(new TextDecoder(encoding).decode(bytes), 'application/xml');
  if (xml.querySelector('parsererror') || xml.doctype ||
      !xml.getElementsByTagNameNS('*', 'fulfillmentToken').length) {
    throw new Error('This file does not contain a readable ACSM fulfillment ticket. Choose the original file from your provider.');
  }
  const field = name => xml.getElementsByTagNameNS('*', name)[0]?.textContent?.trim() || '';
  return { title: field('title'), author: field('creator'), format: field('format') };
}

export class ManualFulfillment extends Error {
  constructor(token) {
    super('The publisher requires a download in your browser. Open the provider link, then choose its book file to finish this same transfer.');
    this.token = token;
  }
}

function bookName(name, type) {
  const clean = String(name || 'Book').split(/[/\\]/).pop()
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069<>:"|?*]/g, '').trim();
  const stem = clean.replace(/\.(epub|pdf)$/i, '').slice(0, 170).trim() || 'Book';
  return stem + (type === 'application/pdf' ? '.pdf' : '.epub');
}

export async function readConversion(response, onProgress = () => {}) {
  if (!response.ok) {
    const message = await response.json().then(x => typeof x.error === 'string' ? x.error : '').catch(() => '');
    if (response.status === 403) throw new Error('ACSM Converter declined this browser request. Open the converter in a tab to check access, then try again.');
    throw new Error(message || 'The converter returned HTTP ' + response.status + '.');
  }
  const mime = response.headers.get('content-type') || '';
  if (!response.body || !mime.toLowerCase().includes('ndjson')) {
    throw new Error('The converter returned a web page or an unsupported response. Check the converter before retrying.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let line = '';
  let meta = null;
  let count = 0;
  let complete = false;
  const chunks = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      let offset = 0;
      while (offset < value.length && !meta) {
        const end = value.indexOf(10, offset);
        const segment = value.subarray(offset, end === -1 ? value.length : end);
        line += decoder.decode(segment, { stream: end === -1 });
        if (line.length > 1024 * 1024) throw new Error('The converter sent an invalid progress record.');
        if (end === -1) { offset = value.length; break; }
        offset = end + 1;
        const raw = line.trim();
        line = '';
        if (!raw) continue;
        const event = JSON.parse(raw);
        if (event.type === 'error') {
          const explanation = [event.title, event.description].filter(Boolean).join(' ');
          throw new Error(explanation || event.error || event.error_code || 'The converter could not fulfill this ticket.');
        }
        if (event.type === 'manual_download') {
          if (typeof event.token !== 'string' || !/^[A-Za-z0-9_-]{12,256}$/.test(event.token)) throw new Error('The provider returned an invalid continuation.');
          throw new ManualFulfillment(event.token);
        }
        if (event.type === 'result') {
          if (!Number.isSafeInteger(event.size) || event.size <= 0) throw new Error('The converter reported an invalid book size.');
          meta = event;
        } else {
          onProgress(event);
        }
      }
      if (meta && offset < value.length) {
        const chunk = value.subarray(offset);
        count += chunk.length;
        if (count > meta.size) throw new Error('The converter sent more bytes than expected.');
        chunks.push(chunk);
        onProgress({ type: 'bytes', received: count, total: meta.size });
      }
    }
    if (!meta || count !== meta.size) throw new Error('The connection ended before the complete book arrived.');
    const blob = new Blob(chunks);
    chunks.length = 0;
    const signature = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
    const pdf = new TextDecoder().decode(signature) === '%PDF-';
    const zip = signature[0] === 0x50 && signature[1] === 0x4b && signature[2] === 3 && signature[3] === 4;
    if (!(pdf || zip)) throw new Error('The converter returned an unrecognized book file.');
    const type = pdf ? 'application/pdf' : 'application/epub+zip';
    if (meta.content_type && meta.content_type !== type) throw new Error('The book contents did not match the converter’s reported format.');
    complete = true;
    return new File([blob], bookName(meta.filename, type), { type });
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function convert(file, onProgress, continuation) {
  const endpoint = new URL(continuation ? '/finish' : '/convert', CONVERTER);
  if (continuation) endpoint.searchParams.set('token', continuation);
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST', body: file, credentials: 'omit', redirect: 'error', cache: 'no-store',
      referrerPolicy: 'no-referrer'
    });
  } catch {
    throw new Error('The connection to ACSM Converter failed. Check your connection before trying again.');
  }
  return readConversion(response, onProgress);
}
