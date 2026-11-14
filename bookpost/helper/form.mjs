import { inspectTicket } from './conversion.mjs';

export const element = id => document.getElementById(id);

export function ticketField(onChange) {
  const input = element('ticket');
  const drop = element('drop');
  let version = 0;
  let locked = false;
  async function choose(file) {
    if (locked) return;
    const current = ++version;
    onChange(null);
    element('error').hidden = true;
    element('file-name').textContent = 'Choose an ACSM file';
    element('file-detail').textContent = 'or drop it here';
    if (!file) { input.value = ''; return; }
    try {
      const info = await inspectTicket(file);
      if (version !== current) return;
      // Keep real File objects for dropped or extension-delivered selections.
      if (input.files[0] !== file) {
        const data = new DataTransfer();
        data.items.add(file);
        input.files = data.files;
      }
      element('file-name').textContent = info.title || file.name;
      element('file-detail').textContent = [info.author, file.name, Math.max(1, Math.round(file.size / 1024)) + ' KB'].filter(Boolean).join(' · ');
      onChange(file, info);
    } catch (error) {
      if (version !== current) return;
      input.value = '';
      element('error').textContent = error.message;
      element('error').hidden = false;
    }
  }
  input.addEventListener('change', () => choose(input.files[0]));
  drop.addEventListener('dragover', event => { event.preventDefault(); if (!locked) drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', event => {
    event.preventDefault();
    drop.classList.remove('over');
    if (locked) return;
    if (event.dataTransfer.files.length > 1) {
      element('error').textContent = 'Choose one ticket per transfer.';
      element('error').hidden = false;
      return;
    }
    choose(event.dataTransfer.files[0]);
  });
  window.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
  window.addEventListener('drop', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
  return { choose, lock(value) { locked = value; input.disabled = value; } };
}
