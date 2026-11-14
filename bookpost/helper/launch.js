(() => {
  if (!/^\/bookpost\/(?:index\.html)?$/.test(location.pathname) || self !== top) return;
  let staged = null;
  let expiry;
  // Only pick up a file from the real chooser in response to a user gesture.
  document.addEventListener('bookpost:launch', () => {
    if (!navigator.userActivation.isActive) return;
    const file = document.querySelector('#ticket')?.files?.[0];
    staged = file && file.size <= 1024 * 1024 && /\.(acsm|ascm)$/i.test(file.name) ? file : null;
    clearTimeout(expiry);
    expiry = setTimeout(() => { staged = null; }, 90000);
    chrome.runtime.sendMessage({ type: 'launch' }).catch(() => {});
  });
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || message.type !== 'take-ticket') return;
    const file = staged;
    staged = null;
    clearTimeout(expiry);
    if (!file) { reply(null); return; }
    file.arrayBuffer().then(buffer => {
      const bytes = new Uint8Array(buffer);
      let text = '';
      for (let i = 0; i < bytes.length; i += 0x4000) {
        text += String.fromCharCode(...bytes.subarray(i, i + 0x4000));
      }
      reply({ name: file.name, data: btoa(text) });
    }).catch(() => reply(null));
    return true;
  });
  document.documentElement.dataset.bookpost = chrome.runtime.getManifest().version;
  document.dispatchEvent(new Event('bookpost:ready'));
})();
