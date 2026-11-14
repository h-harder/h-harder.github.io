import { element, ticketField } from './helper/form.mjs';

const dialog = element('setup');
const send = element('send');
const connected = () => Boolean(document.documentElement.dataset.bookpost);
function render() {
  send.firstChild.nodeValue = connected() ? 'Continue to Readest ' : 'Set up Bookpost ';
  element('status').textContent = connected() ? 'Your helper is connected on this browser.' : 'First time? Add the Chrome helper to connect to Readest.';
}
ticketField(() => {});
send.addEventListener('click', () => {
  if (!connected()) { dialog.showModal(); return; }
  document.dispatchEvent(new Event('bookpost:launch'));
});
element('about').addEventListener('click', () => dialog.showModal());
dialog.addEventListener('click', event => { if (event.target === dialog) {
  const r = dialog.getBoundingClientRect();
  if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
} });
document.addEventListener('bookpost:ready', render);
render();
