const api = {
  async get(url) { const r = await fetch(url); return unwrap(r); },
  async post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
    return unwrap(r);
  },
  async put(url, body) {
    const r = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
    return unwrap(r);
  },
};
async function unwrap(r) {
  const json = await r.json();
  if (!json.ok) throw new Error(json.error || 'request failed');
  return json.data;
}
const el = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const time = (d) => new Date(d).toLocaleTimeString();
function toast(msg, bad) {
  const box = el('toast');
  if (!box) return;
  box.textContent = msg;
  box.style.color = bad ? 'var(--red)' : 'var(--muted)';
  setTimeout(() => { if (box.textContent === msg) box.textContent = ''; }, 4000);
}
