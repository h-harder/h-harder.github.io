(() => {
  if (self !== top) return;
  const sendPath = () => /^\/send\/?$/.test(location.pathname);
  const picker = () => sendPath() ? document.querySelector('input[type=file][multiple]') : null;
  let job = null;
  let observer = null;
  let expiry = null;

  function release() {
    observer?.disconnect();
    observer = null;
    clearTimeout(expiry);
    if (job) job.parts = [];
    job = null;
  }
  function end(state, detail) {
    if (!job) return;
    const id = job.id;
    release();
    chrome.runtime.sendMessage({ type: 'import-result', id, state, detail }).catch(() => {});
  }
  function checkReceipt() {
    if (!job?.submitted) return;
    // The official Send page creates one list row per import. Its status
    // icons carry semantic classes even when Readest uses another language.
    const recent = [...document.querySelectorAll('li')].filter(row => !job.before.has(row));
    if (!job.row) {
      job.row = recent.find(row => row.querySelector('span.truncate')?.textContent === job.name);
      if (!job.row && recent.length === 1 && recent[0].querySelector('span.truncate')) job.row = recent[0];
    }
    if (!job.row) return;
    const detail = job.row.querySelector('span.text-xs')?.textContent?.trim();
    if (job.row.querySelector('svg.text-success')) {
      end('saved', job.row.querySelector('span.truncate')?.textContent?.trim() || job.name);
    } else if (job.row.querySelector('svg.text-error')) {
      end('failed', detail || 'Readest reported an import error.');
    }
  }
  function handle(m) {
    if (m.type === 'status') {
      if (picker()) return { status: 'ready' };
      if (location.pathname.startsWith('/auth')) return { status: 'signin' };
      if (sendPath() && document.querySelector('h1') && document.querySelector('p') &&
          !document.querySelector('input[type=file]')) return { status: 'signin' };
      // Social sign-in can return to the library. Only the assigned tab
      // receives this request, so redirect it back to the import page.
      if (/^\/library\/?$/.test(location.pathname)) location.replace('/send');
      return { status: 'loading' };
    }
    if (m.type === 'signin' && sendPath() && !picker()) {
      setTimeout(() => location.assign('/auth?redirect=%2Fsend'), 50);
      return { status: 'opening' };
    }
    if (!sendPath() || !picker()) throw new Error('Sign in to Readest, then reopen its Send page.');
    if (m.type === 'begin') {
      if (job) throw new Error('Readest is already receiving a book.');
      if (!Number.isSafeInteger(m.size) || m.size <= 0 || !m.name || !/\.(epub|pdf)$/i.test(m.name)) {
        throw new Error('Invalid book transfer.');
      }
      job = { id: m.id, name: m.name, size: m.size, parts: [], offset: 0, submitted: false };
      expiry = setTimeout(release, 10 * 60 * 1000);
      return { status: 'ok' };
    }
    if (!job || m.id !== job.id || job.submitted) throw new Error('The Readest transfer expired.');
    if (m.type === 'chunk') {
      if (m.offset !== job.offset) throw new Error('Book chunks arrived out of order.');
      const bytes = BookpostWire.decode(m.data);
      if (!bytes.length || bytes.length > BookpostWire.CHUNK || job.offset + bytes.length > job.size) {
        throw new Error('Invalid book chunk length.');
      }
      job.parts.push(bytes);
      job.offset += bytes.length;
      return { status: 'ok', offset: job.offset };
    }
    if (m.type === 'finish') {
      if (job.offset !== job.size) throw new Error('The book transfer was incomplete.');
      const file = new File(job.parts, job.name, {
        type: /\.pdf$/i.test(job.name) ? 'application/pdf' : 'application/epub+zip'
      });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const input = picker();
      input.files = transfer.files;
      job.before = new Set(document.querySelectorAll('li'));
      job.submitted = true;
      job.parts = [];
      clearTimeout(expiry);
      observer = new MutationObserver(checkReceipt);
      observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
      expiry = setTimeout(() => end('unconfirmed', 'Readest has the file. Check the result on its Send page.'), 5 * 60 * 1000);
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { status: 'submitted' };
    }
    throw new Error('Unknown transfer step.');
  }

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return;
    try { reply(handle(message)); }
    catch (error) {
      if (!job?.submitted) release();
      reply({ status: 'error', message: error.message });
    }
  });
})();
