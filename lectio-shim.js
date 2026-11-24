import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js?v=1795528694';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' } });
const $ = id => document.getElementById(id);
const nodb = msg => { const p = document.querySelector('#view-nodb p'); if (p && msg) p.textContent = msg; window.__lectioResolve({}) };
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);

(async () => {
  try { const pdfjs = await import('./lib/pdf.min.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = new URL('./lib/pdf.worker.min.mjs', import.meta.url).href; window.pdfjsLib = pdfjs } catch (e) { console.error(e) }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { nodb('Entrá con tu cuenta en el Cancionero y después tocá 📖 Lectura.'); const b = document.querySelector('#view-nodb .empty-state'); if (b) b.insertAdjacentHTML('beforeend', '<p style="margin-top:1rem"><a class="btn btn-accent" href="./">Ir a entrar</a></p>'); return }
  const { data: ms, error } = await sb.from('miembros').select('rol,grupos(id,nombre)').eq('user_id', session.user.id);
  const grupos = (ms || []).map(m => m.grupos).filter(Boolean);
  if (error || !grupos.length) { nodb('Para usar Lectura tenés que estar en un grupo. Creá uno o unite desde el Cancionero.'); return }
  const q = new URLSearchParams(location.search).get('g');
  let gid = q || localStorage.getItem('cv_lectio_g');
  if (!grupos.some(g => g.id === gid)) gid = grupos[0].id;
  localStorage.setItem('cv_lectio_g', gid);
  const sel = $('lxGrupo');
  if (sel && grupos.length > 1) { sel.innerHTML = grupos.map(g => `<option value="${g.id}">${g.nombre.replace(/</g, '&lt;')}</option>`).join(''); sel.value = gid; sel.hidden = false; sel.onchange = () => { localStorage.setItem('cv_lectio_g', sel.value); location.replace(location.pathname) } }
  const gname = $('lxGName'); if (gname && grupos.length < 2) gname.textContent = grupos.find(g => g.id === gid).nombre;

  const cache = {}, subs = {};
  const snap = (name) => ({ docs: Object.values(cache[name] || {}).map(d => ({ id: d.id, data: () => d })) });
  const fire = (name) => (subs[name] || []).forEach(s => { const sn = snap(name); if (s.order) { const [f, dir] = s.order; sn.docs.sort((a, b) => { const x = a.data()[f] ?? 0, y = b.data()[f] ?? 0; return (x > y ? 1 : x < y ? -1 : 0) * (dir === 'desc' ? -1 : 1) }) } s.cb(sn) });
  async function fetchCol(name) {
    const { data, error } = await sb.from('lectio_docs').select('id,data').eq('grupo_id', gid).eq('coleccion', name);
    if (error) throw error;
    cache[name] = {}; (data || []).forEach(r => cache[name][r.id] = Object.assign({}, r.data, { id: r.id }));
  }
  const loaded = {};
  function collection(name) {
    const listen = (order) => (cb, err) => {
      (subs[name] = subs[name] || []).push({ cb, order });
      (loaded[name] = loaded[name] || fetchCol(name)).then(() => fire(name)).catch(e => err && err(e));
      return () => { };
    };
    return {
      orderBy: (f, dir) => ({ onSnapshot: listen([f, dir || 'asc']) }),
      onSnapshot: listen(null),
      doc: (id) => ({
        async set(d) {
          const data = Object.assign({}, d); delete data.id;
          const { error } = await sb.from('lectio_docs').upsert({ grupo_id: gid, coleccion: name, id, data, updated_at: new Date().toISOString() }, { onConflict: 'grupo_id,coleccion,id' });
          if (error) throw error; (cache[name] = cache[name] || {})[id] = Object.assign({}, data, { id }); fire(name);
        },
        async update(patch) {
          const cur = (cache[name] || {})[id] || {}; const data = Object.assign({}, cur, patch); delete data.id;
          const { error } = await sb.from('lectio_docs').update({ data, updated_at: new Date().toISOString() }).eq('grupo_id', gid).eq('coleccion', name).eq('id', id);
          if (error) throw error; (cache[name] = cache[name] || {})[id] = Object.assign({}, data, { id }); fire(name);
        },
        async delete() {
          const { error } = await sb.from('lectio_docs').delete().eq('grupo_id', gid).eq('coleccion', name).eq('id', id);
          if (error) throw error; if (cache[name]) delete cache[name][id]; fire(name);
        }
      })
    };
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') ['books', 'groups'].forEach(n => { if (loaded[n]) { loaded[n] = fetchCol(n); loaded[n].then(() => fire(n)).catch(() => { }) } }) });

  const assets = {
    async upload(file) {
      if (file.size > 50 * 1024 * 1024) throw { code: 'too_large' };
      const path = `${gid}/${uuid()}.pdf`;
      const { error } = await sb.storage.from('lectio').upload(path, file, { contentType: 'application/pdf' });
      if (error) { const m = String(error.message || ''); throw { code: /size|large/i.test(m) ? 'too_large' : /mime|type/i.test(m) ? 'unsupported_type' : /policy|permission|security/i.test(m) ? 'not_granted' : 'x' } }
      return { id: path };
    },
    async delete(id) { await sb.storage.from('lectio').remove([id]) }
  };
  window.__lectioAssetUrl = async (id) => { const { data, error } = await sb.storage.from('lectio').createSignedUrl(id, 3600); if (error) throw error; return data.signedUrl };
  window.__lectioResolve({ db: { collection }, assets, sample: null });
})().catch(e => { console.error(e); nodb('No pudimos conectar. Revisá tu conexión y recargá la página.') });
