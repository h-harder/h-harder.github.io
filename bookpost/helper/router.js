const ports = new Map();
const SEND_URL = 'https://web.readest.com/send';
const QUEUE_URL = chrome.runtime.getURL('desk.html');

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'launch' || sender.frameId !== 0) return;
  const url = new URL(sender.url);
  if (url.origin !== 'https://h-harder.github.io' || !/^\/bookpost\/(?:index\.html)?$/.test(url.pathname)) return;
  chrome.tabs.create({ url: QUEUE_URL, openerTabId: sender.tab.id });
});

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== 'initial-ticket' || sender.url !== QUEUE_URL || sender.frameId !== 0) return;
  (async () => {
    const { openerTabId } = await chrome.tabs.get(sender.tab.id);
    if (!Number.isInteger(openerTabId)) return null;
    return chrome.tabs.sendMessage(openerTabId, { type: 'take-ticket' }, { frameId: 0 });
  })().then(reply).catch(() => reply(null));
  return true;
});

// Each desk owns a separate port. Only our desk can create a receiver tab and
// only that tab can receive its bytes. Never forward a book to another tab.
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'bookpost-desk' || port.sender?.url !== QUEUE_URL || port.sender.frameId !== 0) return;
  const deskTab = port.sender.tab?.id;
  if (!Number.isInteger(deskTab)) return;
  let readerTab = null;
  let closed = false;
  function tell(message) {
    if (!closed) {
      try { port.postMessage(message); } catch { /* Desk was just closed. */ }
    }
  }
  port.onDisconnect.addListener(() => {
    closed = true;
    if (readerTab !== null) ports.delete(readerTab);
  });
  port.onMessage.addListener(async message => {
    try {
      if (message.type === 'keepalive') {
        tell({ type: 'alive' });
      } else if (message.type === 'open') {
        if (readerTab !== null) ports.delete(readerTab);
        readerTab = null;
        const tab = await chrome.tabs.create({ url: SEND_URL, openerTabId: deskTab, active: false });
        if (closed) return;
        readerTab = tab.id;
        ports.set(readerTab, { tell, clear: () => { readerTab = null; } });
        tell({ type: 'opened' });
      } else if (message.type === 'focus' && readerTab !== null) {
        await chrome.tabs.update(readerTab, { active: true });
      } else if (message.type === 'desk') {
        await chrome.tabs.update(deskTab, { active: true });
      } else if (message.type === 'release' && readerTab !== null) {
        ports.delete(readerTab);
      } else if (message.type === 'detach' && readerTab !== null) {
        ports.delete(readerTab);
        readerTab = null;
      } else if (message.type === 'packet' && readerTab !== null) {
        const result = await chrome.tabs.sendMessage(readerTab, message.packet, { frameId: 0 });
        tell({ type: 'reply', seq: message.seq, result: result ?? { status: 'loading' } });
      } else if (message.type === 'packet') {
        tell({ type: 'reply', seq: message.seq, result: { status: 'error', message: 'The Readest tab closed. Retry delivery to open another.' } });
      }
    } catch {
      if (message.type === 'packet') tell({ type: 'reply', seq: message.seq, result: { status: 'loading' } });
      else tell({ type: 'route-error', message: 'Readest could not open. Start the handoff again.' });
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'import-result' || sender.frameId !== 0 ||
      !sender.url || !/^https:\/\/web\.readest\.com\/send\/?(?:[?#]|$)/.test(sender.url)) return;
  const route = ports.get(sender.tab?.id);
  route?.tell({ type: 'result', id: message.id, state: message.state, detail: message.detail });
});

chrome.tabs.onRemoved.addListener(id => {
  const route = ports.get(id);
  if (!route) return;
  ports.delete(id);
  route.clear();
  route.tell({ type: 'receiver-closed' });
});
