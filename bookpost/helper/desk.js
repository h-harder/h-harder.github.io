import { CONVERTER, ManualFulfillment, convert } from './conversion.mjs';
import { element, ticketField } from './form.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const send = element('send');
const status = element('status');
const bar = element('progress');
const view = element('view');
const reset = element('reset');
let ticket = null;
let output = null;
let providerFile = null;
let continuation = null;
let phase = 'ready';
let port = null;
let keepalive = null;
let current = null;
let pageVersion = 0;
let seq = 0;
const replies = new Map();
const field = ticketField(file => { ticket = file; });

function label(text) { send.firstChild.nodeValue = text + ' '; }
function showError(text) { element('error').textContent = text; element('error').hidden = !text; }
function progress(text, percent) {
  status.textContent = text;
  bar.hidden = false;
  if (percent === undefined) bar.removeAttribute('value');
  else { bar.max = 100; bar.value = Math.min(100, Math.max(0, percent)); }
}
function stop(message, uncertain = false) {
  phase = uncertain ? 'unknown' : 'retry';
  bar.hidden = true;
  send.hidden = false;
  send.disabled = false;
  reset.hidden = false;
  field.lock(Boolean(output || continuation));
  label(output ? 'Retry delivery' : continuation ? 'Finish & send' : 'Try again');
  status.textContent = uncertain ? 'Check the open Readest tab before retrying delivery.' :
    output ? 'The converted book is still available in this tab.' : 'Review the message before retrying.';
  showError(message);
}
function disconnectRoute() {
  clearInterval(keepalive);
  keepalive = null;
  const old = port;
  port = null;
  if (old) {
    try { old.postMessage({ type: 'detach' }); old.disconnect(); } catch { /* Already closed. */ }
  }
  for (const waiter of replies.values()) waiter.reject(new Error('The handoff was interrupted.'));
  replies.clear();
}
function rpc(packet) {
  const n = ++seq;
  return new Promise((resolve, reject) => {
    if (!port) { reject(new Error('The Readest connection closed.')); return; }
    const timeout = setTimeout(() => {
      replies.delete(n);
      reject(new Error('Readest did not respond. Check its tab before retrying.'));
    }, 18000);
    replies.set(n, {
      resolve: value => { clearTimeout(timeout); resolve(value); },
      reject: error => { clearTimeout(timeout); reject(error); }
    });
    try { port.postMessage({ type: 'packet', seq: n, packet }); }
    catch (error) { replies.get(n)?.reject(error); replies.delete(n); }
  });
}
function openRoute(run) {
  disconnectRoute();
  const channel = chrome.runtime.connect({ name: 'bookpost-desk' });
  port = channel;
  // An open but quiet MV3 port can suspend during a long fulfillment or upload.
  keepalive = setInterval(() => {
    if (port === channel && !['saved', 'retry', 'unknown', 'ready'].includes(phase)) {
      try { channel.postMessage({ type: 'keepalive' }); } catch { /* onDisconnect handles it. */ }
    }
  }, 15000);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Readest could not open a receiver tab.')), 15000);
    channel.onMessage.addListener(message => {
      if (channel !== port || run !== pageVersion) return;
      switch (message.type) {
        case 'opened': clearTimeout(timeout); view.hidden = false; resolve(); break;
        case 'reply':
          replies.get(message.seq)?.resolve(message.result);
          replies.delete(message.seq);
          break;
        case 'result':
          if (message.id !== current) return;
          if (message.state === 'saved') {
            phase = 'saved';
            clearInterval(keepalive);
            channel.postMessage({ type: 'release' });
            output = null;
            ticket = null;
            providerFile = null;
            continuation = null;
            element('receipt-title').textContent = message.detail || 'Book';
            element('receipt').hidden = false;
            status.textContent = 'Readest confirmed the import.';
            send.hidden = true;
            reset.hidden = false;
            bar.hidden = true;
            showError('');
          } else stop(message.detail || 'Readest could not confirm the import.', message.state === 'unconfirmed');
          break;
        case 'receiver-closed':
          view.hidden = true;
          if (phase !== 'saved' && phase !== 'retry' && phase !== 'unknown') {
            const previous = phase;
            // Fulfillment may already have spent a ticket. Let it finish
            // and retain its result even when the receiver has disappeared.
            if (previous === 'converting') {
              status.textContent = 'Readest closed. Keeping the conversion running for another delivery attempt.';
            } else {
              ++pageVersion;
              stop('The Readest tab closed.', previous === 'confirming');
            }
          }
          break;
        case 'route-error': clearTimeout(timeout); reject(new Error(message.message)); break;
      }
    });
    channel.onDisconnect.addListener(() => {
      clearTimeout(timeout);
      if (channel !== port || run !== pageVersion) return;
      port = null;
      clearInterval(keepalive);
      view.hidden = true;
      for (const waiter of replies.values()) waiter.reject(new Error('The helper connection closed.'));
      replies.clear();
      reject(new Error('The helper connection closed.'));
      if (phase === 'confirming') stop('The confirmation connection closed.', true);
    });
    channel.postMessage({ type: 'open' });
  });
}
async function waitForReadest(run) {
  let offeredSignIn = false;
  const deadline = Date.now() + 10 * 60 * 1000;
  while (run === pageVersion && Date.now() < deadline) {
    const reply = await rpc({ type: 'status' });
    if (reply.status === 'error') throw new Error(reply.message);
    if (reply.status === 'ready') {
      if (offeredSignIn) port?.postMessage({ type: 'desk' });
      return;
    }
    if (reply.status === 'signin' && !offeredSignIn) {
      offeredSignIn = true;
      status.textContent = 'Sign in on the Readest tab. This transfer resumes when its Send page opens.';
      port?.postMessage({ type: 'focus' });
      await rpc({ type: 'signin' });
    }
    await delay(1000);
  }
  throw new Error('Readest sign-in did not finish. Open its Send page and retry.');
}
const stages = {
  hydrate: 'Starting the conversion…', activate: 'Preparing the ticket…',
  download: 'Retrieving the book…', prepare: 'Checking the book…', decrypt: 'Finishing the book…'
};
function onConversion(event) {
  if (event.type === 'waiting') progress(event.queue_position ? 'In the conversion queue · position ' + event.queue_position : 'Waiting for the converter…');
  if (event.type === 'queued') progress('The converter received the ticket…');
  if (event.type === 'status' && stages[event.stage]) progress(stages[event.stage]);
  if (event.type === 'bytes') progress('Receiving the finished book…', 100 * event.received / event.total);
}
async function acknowledged(packet, expected) {
  const result = await rpc(packet);
  if (result.status !== expected) throw new Error(result.message || 'Readest lost the transfer. Reopen it and retry delivery.');
  return result;
}
async function deliver(file, run) {
  current = crypto.randomUUID();
  const id = current;
  phase = 'delivering';
  await acknowledged({ type: 'begin', id, name: file.name, size: file.size }, 'ok');
  for (let offset = 0; offset < file.size; offset += BookpostWire.CHUNK) {
    if (run !== pageVersion) return;
    const bytes = new Uint8Array(await file.slice(offset, offset + BookpostWire.CHUNK).arrayBuffer());
    const ack = await acknowledged({ type: 'chunk', id, offset, data: BookpostWire.encode(bytes) }, 'ok');
    if (ack.offset !== offset + bytes.length) throw new Error('Readest did not acknowledge the complete book chunk.');
    progress('Sending the book to Readest…', 100 * ack.offset / file.size);
  }
  if (run !== pageVersion) return;
  phase = 'confirming';
  progress('Readest is importing the book. Waiting for its confirmation…');
  await acknowledged({ type: 'finish', id }, 'submitted');
}
async function start() {
  if (!['ready', 'retry', 'manual', 'unknown', 'pdf'].includes(phase)) return;
  if (!ticket && !output) { element('ticket').click(); return; }
  if (continuation && !providerFile && !output) { element('provider-file').click(); return; }
  const reuseReadyTab = phase === 'pdf' && port && !view.hidden;
  const run = reuseReadyTab ? pageVersion : ++pageVersion;
  phase = 'connecting';
  showError('');
  reset.hidden = true;
  send.disabled = true;
  label('Transfer in progress');
  field.lock(true);
  progress('Opening Readest’s Send page…');
  try {
    if (!reuseReadyTab) await openRoute(run);
    await waitForReadest(run);
    if (run !== pageVersion) return;
    if (!output) {
      phase = 'converting';
      progress('Sending the ticket to ACSM Converter…');
      output = await convert(providerFile || ticket, onConversion, continuation);
      providerFile = null; continuation = null;
      element('provider-file').value = '';
      element('manual').hidden = true;
      if (run !== pageVersion) return;
      if (output.type === 'application/pdf') {
        phase = 'pdf';
        bar.hidden = true;
        send.disabled = false;
        reset.hidden = false;
        label('Send the PDF to Readest');
        status.textContent = 'The publisher supplied a PDF edition. Send it in its original format or choose another ticket.';
        return;
      }
    }
    await deliver(output, run);
  } catch (error) {
    if (run !== pageVersion || phase === 'saved') return;
    if (error instanceof ManualFulfillment) {
      continuation = error.token;
      const link = element('provider');
      link.href = CONVERTER + '/download/' + encodeURIComponent(continuation);
      phase = 'manual';
      element('manual').hidden = false;
      status.textContent = error.message;
      label('Finish & send');
      send.disabled = false;
      reset.hidden = false;
      bar.hidden = true;
    } else stop(error.message, phase === 'confirming');
  }
}
send.addEventListener('click', start);
view.addEventListener('click', () => port?.postMessage({ type: 'focus' }));
element('provider-file').addEventListener('change', event => { providerFile = event.target.files[0] || null; });
reset.addEventListener('click', () => {
  ++pageVersion;
  disconnectRoute();
  current = null; output = null; continuation = null; providerFile = null;
  phase = 'ready';
  field.lock(false);
  field.choose(null);
  element('provider-file').value = '';
  element('provider').removeAttribute('href');
  for (const el of [view, reset, bar, element('manual'), element('receipt')]) el.hidden = true;
  showError('');
  send.hidden = false;
  send.disabled = false;
  label('Convert & send');
  status.textContent = 'Readest will open in another tab for the handoff.';
  element('ticket').focus();
});
window.addEventListener('beforeunload', event => {
  if (phase !== 'ready' && phase !== 'saved' && (output || continuation || phase === 'converting')) {
    event.preventDefault();
    event.returnValue = '';
  }
});
chrome.runtime.sendMessage({ type: 'initial-ticket' }).then(async initial => {
  if (!initial || ticket || phase !== 'ready') return;
  const bytes = Uint8Array.from(atob(initial.data), c => c.charCodeAt(0));
  await field.choose(new File([bytes], initial.name, { type: 'application/vnd.adobe.adept+xml' }));
}).catch(() => {});
