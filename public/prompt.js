const cancel = document.getElementById('cancel');
const confirm = document.getElementById('confirm');
const copy = document.getElementById('copy');
let answered = false;

window.spotPrompt.content(value => {
  for (const key of ['title', 'message', 'detail', 'confirm']) document.getElementById(key).textContent = value[key];
  document.title = value.title;
  document.body.classList.add('ready');
  cancel.focus({ preventScroll: true });
});

function reply(value) {
  if (answered) return;
  answered = true;
  cancel.disabled = true;
  confirm.disabled = true;
  window.spotPrompt.reply(value);
}

cancel.addEventListener('click', () => reply(false));
confirm.addEventListener('click', () => reply(true));

// Text remains keyboard-scrollable when display scaling makes the copy overflow.
const overflowObserver = new ResizeObserver(() => {
  if (copy.scrollHeight > copy.clientHeight + 1) copy.tabIndex = 0;
  else copy.removeAttribute('tabindex');
});
for (const element of [copy, document.getElementById('title'), document.getElementById('message'), document.getElementById('detail')]) overflowObserver.observe(element);

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); reply(false); }
  if (event.key !== 'Tab' || answered) return;
  const focusable = copy.tabIndex === 0 ? [copy, cancel, confirm] : [cancel, confirm];
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
