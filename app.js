import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js?v=1793827843';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' } });

/* ===================== ACORDES Y TRANSPOSICIÓN ===================== */
const AM_S=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const AM_F=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const LA_S=['Do','Do#','Re','Re#','Mi','Fa','Fa#','Sol','Sol#','La','La#','Si'];
const LA_F=['Do','Reb','Re','Mib','Mi','Fa','Solb','Sol','Lab','La','Sib','Si'];
const BASE={C:0,D:2,E:4,F:5,G:7,A:9,B:11,DO:0,RE:2,MI:4,FA:5,SOL:7,LA:9,SI:11};
const ROOT='([Dd][Oo]|[Rr][Ee]|[Mm][Ii]|[Ff][Aa]|[Ss][Oo][Ll]|[Ll][Aa]|[Ss][Ii]|[A-G])';
const CH_RE=new RegExp('^'+ROOT+'([#b]?)([^\\s\\/]*)(?:\\/'+ROOT+'([#b]?))?$');
const QUAL_RE=/^(m|min|maj|dim|aug|sus|add|º|°|\+|\d|\(|\)|#|b)*$/i;
const IGN_RE=/^(\/+|\|+|x?\d+x?|%|\.+|:)$/i;
const SPLIT_RE=/[()\-,.]+/;

function parseChord(tok){
  const m=tok.match(CH_RE); if(!m||!QUAL_RE.test(m[3]))return null;
  return {root:m[1],acc:m[2],q:m[3],broot:m[4],bacc:m[5]};
}
const isChord=t=>!!parseChord(t);
function noteIdx(r,a){return BASE[r.toUpperCase()]+(a==='#'?1:a==='b'?-1:0)}
function noteName(i,like,flat){
  i=((i%12)+12)%12; const latin=like.length>1;
  const n=(latin?(flat?LA_F:LA_S):(flat?AM_F:AM_S))[i];
  if(latin&&like===like.toUpperCase()){const r=n.match(/^(Do|Re|Mi|Fa|Sol|La|Si)(.*)$/);return r[1].toUpperCase()+r[2]}
  return n;
}
function trChord(tok,n,flat){
  const c=parseChord(tok); if(!c||(!n&&flat==null))return tok;
  let s=noteName(noteIdx(c.root,c.acc)+n,c.root,flat)+c.q;
  if(c.broot)s+='/'+noteName(noteIdx(c.broot,c.bacc)+n,c.broot,flat);
  return s;
}
function trToken(tok,n,flat){return tok.replace(/[^()\-,.\s]+/g,p=>parseChord(p)?trChord(p,n,flat):p)}
function tokenKind(t){ // 2 = acorde, 1 = ignorable, 0 = texto
  if(IGN_RE.test(t))return 1;
  const ps=t.split(SPLIT_RE).filter(Boolean); if(!ps.length)return 1;
  let ch=false; for(const p of ps){ if(isChord(p))ch=true; else if(!IGN_RE.test(p))return 0; }
  return ch?2:1;
}
function isChordLine(line){
  const toks=line.trim().split(/\s+/).filter(Boolean); if(!toks.length)return false;
  let n=0; for(const t of toks){const k=tokenKind(t); if(k===0)return false; if(k===2)n++;}
  return n>0;
}
function chordsOf(line){const out=[];const re=/\S+/g;let m;while((m=re.exec(line)))out.push({pos:m.index,c:m[0]});return out}
function bracketLine(line){
  let text='',chords=[];const re=/\[([^\]]+)\]/g;let last=0,m;
  while((m=re.exec(line))){text+=line.slice(last,m.index);chords.push({pos:text.length,c:m[1].trim()});last=re.lastIndex}
  text+=line.slice(last);
  if(!text.trim())return {type:'chords',chords:chords.map((c,i)=>({pos:i*6,c:c.c}))};
  return {type:'pair',chords,text};
}
const LABEL_RE=/^\s*(estribillo|coro|pre[\s-]?coro|estrofa|verso|puente|intro|introducci[oó]n|interludio|instrumental|final|salida|solo|repetir)\b/i;
const LABEL_CH_RE=/^\s*(intro|introducci[oó]n|instrumental|interludio|final|salida|solo)\s*[:\-]\s*(.+)$/i;
const isLabel=l=>{const t=l.trim();return t.length<34&&LABEL_RE.test(t)&&!isChordLine(t)&&!/\[/.test(t)};

function parseSong(txt){
  const blocks=txt.replace(/\r/g,'').split(/\n\s*\n/).map(b=>b.split('\n').filter(l=>l.trim()!=='')).filter(b=>b.length);
  const secs=[];
  for(const lines of blocks){
    let cur={label:'',lines:[]}; const push=()=>{if(cur.lines.length||cur.label)secs.push(cur)};
    for(let i=0;i<lines.length;i++){
      const l=lines[i];
      const lc=l.match(LABEL_CH_RE);
      if(lc&&isChordLine(lc[2])){push();cur={label:lc[1],lines:[{type:'chords',chords:chordsOf(lc[2])}]};continue}
      const bl=l.match(/^\s*\[([^\]]+)\]\s*$/);
      if(bl&&!isChordLine(bl[1])){push();cur={label:bl[1].trim(),lines:[]};continue}
      if(isLabel(l)){push();cur={label:l.trim().replace(/[:\-\s]+$/,''),lines:[]};continue}
      if(/\[[^\]]+\]/.test(l)){cur.lines.push(bracketLine(l));continue}
      if(isChordLine(l)){
        const nx=lines[i+1];
        if(nx!=null&&!isChordLine(nx)&&!/\[[^\]]+\]/.test(nx)&&!isLabel(nx)){cur.lines.push({type:'pair',chords:chordsOf(l),text:nx});i++}
        else cur.lines.push({type:'chords',chords:chordsOf(l)});
      } else cur.lines.push({type:'text',text:l});
    }
    push();
  }
  // Estrofas largas: cortar cada 4 renglones para poder marcar y repetir
  const out=[];
  for(const s of secs){
    if(s.lines.length<=5){out.push(s);continue}
    for(let k=0;k<s.lines.length;k+=4){
      let part=s.lines.slice(k,k+4);
      if(s.lines.length-(k+4)===1){part=s.lines.slice(k);k=s.lines.length}
      out.push({label:k===0?s.label:'',lines:part});
    }
  }
  return out;
}
// Acomoda cada acorde al comienzo de la palabra (los Word suelen estar desalineados)
function snap(chords,text){
  const out=[];let prev=-1;
  for(const c of chords){
    let p=Math.min(c.pos,Math.max(text.length,0));
    if(p<text.length&&/\s/.test(text[p])){let q=p;while(q<text.length&&/\s/.test(text[q]))q++;if(q<text.length)p=q}
    let w=p;while(w>0&&!/\s/.test(text[w-1]))w--;
    if(w>prev)p=w;
    if(p<=prev)p=prev+1;
    out.push({pos:p,c:c.c});prev=p;
  }
  return out;
}
function firstChord(secs){for(const s of secs)for(const l of s.lines)if(l.chords)for(const c of l.chords)for(const p of c.c.split(SPLIT_RE))if(isChord(p))return p;return null}
function usesFlats(secs){for(const s of secs)for(const l of s.lines)if(l.chords)for(const c of l.chords)for(const p of c.c.split(SPLIT_RE)){const x=parseChord(p);if(x&&x.acc==='b')return true}return false}



/* ===================== UTILIDADES ===================== */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const LS = (() => { try { const s = localStorage; s.setItem('_t', '1'); return s } catch (e) { return null } })();
const lsGet = (k, d) => { try { const v = LS && LS.getItem(k); return v ? JSON.parse(v) : d } catch (e) { return d } };
const lsSet = (k, v) => { try { LS && LS.setItem(k, JSON.stringify(v)) } catch (e) { } };
function toast(t) { const e = $('toast'); e.textContent = t; e.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => e.classList.remove('show'), 2400) }
function show(id) { document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === id)); window.scrollTo(0, 0) }
const numOf = t => { const m = String(t).match(/^\s*(\d+)/); return m ? +m[1] : 1e9 };
const bySong = (a, b) => numOf(a.titulo) - numOf(b.titulo) || a.titulo.localeCompare(b.titulo);
function ask(title, bodyHtml, okText = 'Aceptar') {
  return new Promise(res => {
    $('dlgT').textContent = title; $('dlgB').innerHTML = bodyHtml; $('dlgOk').textContent = okText;
    $('dialog').classList.remove('hidden');
    const done = v => { $('dialog').classList.add('hidden'); $('dlgOk').onclick = $('dlgNo').onclick = null; res(v) };
    $('dlgOk').onclick = () => done(true); $('dlgNo').onclick = () => done(false);
    const inp = $('dlgB').querySelector('input'); if (inp) setTimeout(() => inp.focus(), 50);
  });
}
const errMsg = e => (e && (e.message || e.error_description)) || 'Algo salió mal';

const GROUP_ORDER = ['Entrada', 'Perdón', 'Gloria', 'Aleluya', 'Ofertorio', 'Santo', 'Cordero', 'Comunión', 'María', 'Salida', 'Adoración', 'Alabanza y adoración', 'Espíritu Santo'];
const GROUP_COLORS = { 'Entrada': '#7ee0a1', 'Perdón': '#b79cff', 'Gloria': '#ffe08a', 'Aleluya': '#ffd36b', 'Ofertorio': '#ffb37a', 'Santo': '#9fd4ff', 'Cordero': '#c3b5ff', 'Comunión': '#f0c264', 'María': '#8cc8ff', 'Salida': '#7fe3d6', 'Adoración': '#f3a6ff', 'Alabanza': '#ff9f7a', 'Alabanza y adoración': '#ff9f7a', 'Espíritu Santo': '#ff6f61' };
function gColor(g) { if (GROUP_COLORS[g]) return GROUP_COLORS[g]; let h = 0; for (const c of g) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 75% 70%)` }
const chip = g => `<span class="gchip" style="--gc:${gColor(g)}">${esc(g)}</span>`;
const sortGroups = arr => [...new Set(arr)].sort((a, b) => { const ia = GROUP_ORDER.indexOf(a), ib = GROUP_ORDER.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b) });

const parsedCache = {};
function parsedOf(s) { const k = (s.id || '') + '\u0001' + s.texto; return parsedCache[k] || (parsedCache[k] = parseSong(s.texto || '')) }

/* ===================== ESTADO DE LA APP ===================== */
const app = { user: null, perfil: null, grupos: [], grupo: null, rol: null, canciones: [], libros: [], libro: null, items: [], cat: '', publicas: false };
const isAdmin = () => app.rol === 'admin';

/* ===================== AUTENTICACIÓN ===================== */
let signup = false;
function setAuthMode(s) { signup = s; $('authTitle').textContent = s ? 'Crear cuenta' : 'Entrar'; $('btnAuth').textContent = s ? 'Crear cuenta' : 'Entrar'; $('auName').classList.toggle('hidden', !s); $('btnAuthSwitch').textContent = s ? 'Ya tengo cuenta' : 'Crear una cuenta'; $('auMsg').textContent = '' }
$('btnAuthSwitch').onclick = () => setAuthMode(!signup);
const redirectTo = location.origin + location.pathname;
$('btnGoogle').onclick = async () => { const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } }); if (error) $('auMsg').textContent = errMsg(error) };
$('btnAuth').onclick = async () => {
  const email = $('auEmail').value.trim(), password = $('auPass').value;
  if (!email || password.length < 6) { $('auMsg').textContent = 'Poné tu email y una contraseña de 6 o más letras'; return }
  $('btnAuth').disabled = true; $('auMsg').textContent = '';
  try {
    if (signup) {
      const nombre = $('auName').value.trim() || email.split('@')[0];
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { nombre }, emailRedirectTo: redirectTo } });
      if (error) throw error;
      if (!data.session) $('auMsg').textContent = '¡Listo! Te mandamos un email para confirmar la cuenta. Después volvé y entrá.';
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (e) {
    const m = errMsg(e);
    $('auMsg').textContent = /Invalid login/i.test(m) ? 'Email o contraseña incorrectos' : /not confirmed/i.test(m) ? 'Falta confirmar tu email (revisá tu correo)' : /already registered/i.test(m) ? 'Ese email ya tiene cuenta: entrá' : m;
  }
  $('btnAuth').disabled = false;
};
$('btnForgot').onclick = async () => {
  const email = $('auEmail').value.trim(); if (!email) { $('auMsg').textContent = 'Escribí tu email arriba y tocá de nuevo'; return }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
  $('auMsg').textContent = error ? errMsg(error) : 'Te mandamos un email para cambiar la contraseña';
};
$('btnLogout').onclick = async () => { await sb.auth.signOut() };

let lastUid = null;
sb.auth.onAuthStateChange((ev, session) => {
  if (ev === 'PASSWORD_RECOVERY') setTimeout(newPassword, 300);
  const uid = session?.user?.id || null;
  if (uid === lastUid && ev !== 'INITIAL_SESSION') return;
  lastUid = uid; app.user = session?.user || null;
  setTimeout(() => { app.user ? start() : (leaveSala(), show('vLogin')) }, 0);
});
async function newPassword() {
  const ok = await ask('Nueva contraseña', '<input id="npw" type="password" placeholder="Mínimo 6 letras">', 'Guardar');
  if (!ok) return; const pw = $('npw').value;
  const { error } = await sb.auth.updateUser({ password: pw }); toast(error ? errMsg(error) : 'Contraseña cambiada ✓');
}

/* ===================== INICIO Y GRUPOS ===================== */
async function start() {
  const { data: p } = await sb.from('perfiles').select('*').eq('id', app.user.id).maybeSingle();
  app.perfil = p || { nombre: app.user.email };
  $('hName').textContent = (app.perfil.nombre || '').split(' ')[0];
  await loadGrupos();
  const inv = new URLSearchParams(location.search).get('invitacion');
  if (inv) { history.replaceState(null, '', location.pathname); await joinGroup(inv); return }
  const last = lsGet('cv_grupo', null);
  if (last && app.grupos.find(g => g.id === last)) return openGrupo(last);
  show('vHome');
}
async function loadGrupos() {
  const { data, error } = await sb.from('miembros').select('rol, grupos(id,nombre,codigo)').eq('user_id', app.user.id);
  if (error) { toast(errMsg(error)); return }
  app.grupos = (data || []).filter(r => r.grupos).map(r => ({ ...r.grupos, rol: r.rol })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  $('gList').innerHTML = app.grupos.length ? app.grupos.map(g => `<div class="item"><div class="main" data-g="${g.id}"><div class="t">${esc(g.nombre)}</div><div class="s">${g.rol === 'admin' ? 'Director' : 'Músico'}</div></div><button data-g="${g.id}">Abrir ›</button></div>`).join('')
    : '<p class="muted">Todavía no estás en ningún grupo. Creá uno o unite con el código que te pasen.</p>';
}
$('gList').addEventListener('click', e => { const g = e.target.closest('[data-g]')?.dataset.g; if (g) openGrupo(g) });
$('btnGNew').onclick = async () => {
  const n = $('gNew').value.trim(); if (!n) { toast('Escribí el nombre del grupo'); return }
  const { data, error } = await sb.rpc('crear_grupo', { p_nombre: n });
  if (error) { toast(errMsg(error)); return }
  $('gNew').value = ''; await loadGrupos(); openGrupo(data);
};
$('btnGJoin').onclick = () => joinGroup($('gJoin').value);
async function joinGroup(code) {
  code = String(code || '').trim().toUpperCase(); if (!code) { toast('Escribí el código'); return }
  const { data, error } = await sb.rpc('unirse_grupo', { p_codigo: code });
  if (error) { toast(/no existe/i.test(error.message) ? 'Ese código no existe' : errMsg(error)); show('vHome'); return }
  $('gJoin').value = ''; await loadGrupos(); toast('¡Te uniste al grupo!'); openGrupo(data);
}
$('btnJoin').onclick = () => { const c = $('codeIn').value.replace(/\D/g, ''); if (c.length !== 4) { toast('El código de sala tiene 4 números'); return } joinSala(c) };
$('codeIn').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnJoin').click() });

async function openGrupo(id) {
  const g = app.grupos.find(x => x.id === id); if (!g) { show('vHome'); return }
  app.grupo = g; app.rol = g.rol; lsSet('cv_grupo', id);
  $('gName').textContent = g.nombre; $('gRol').textContent = isAdmin() ? 'Director' : 'Músico'; $('gCode').textContent = g.codigo;
  document.body.classList.toggle('esAdmin', isAdmin());
  app.publicas = false; app.cat = '';
  show('vGrupo'); setTab(lsGet('cv_tab', 'canc'));
  await Promise.all([loadCanciones(), loadLibros(), loadMiembros(), loadGrab()]);
}
$('btnGRen').onclick = async () => {
  if (!await ask('Nombre del grupo', `<input id="grn" value="${esc(app.grupo.nombre)}">`, 'Guardar')) return;
  const n = $('grn').value.trim(); if (!n) return;
  const { error } = await sb.from('grupos').update({ nombre: n }).eq('id', app.grupo.id);
  if (error) { toast(errMsg(error)); return } app.grupo.nombre = n; $('gName').textContent = n; loadGrupos();
};
$('btnGBack').onclick = () => { lsSet('cv_grupo', null); loadGrupos(); show('vHome') };
function setTab(t) {
  lsSet('cv_tab', t);
  document.querySelectorAll('#vGrupo .tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('#vGrupo [data-pane]').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== t));
}
document.querySelector('#vGrupo .tabs').addEventListener('click', e => { const t = e.target.closest('button')?.dataset.tab; if (t) setTab(t) });

/* ----- Canciones ----- */
async function loadCanciones() {
  const q = sb.from('canciones').select('id,grupo_id,titulo,texto,categorias,publica');
  const { data, error } = app.publicas ? await q.eq('publica', true).neq('grupo_id', app.grupo.id).limit(500) : await q.eq('grupo_id', app.grupo.id);
  if (error) { toast(errMsg(error)); return }
  app.canciones = (data || []).sort(bySong); drawCanciones();
}
function catsOf(list) { return sortGroups(list.flatMap(s => s.categorias || [])) }
function drawCanciones() {
  const cats = catsOf(app.canciones);
  $('cGroups').innerHTML = ['', ...cats].map(g => `<button data-c="${esc(g)}" class="${g === app.cat ? 'on' : ''}" style="flex:none;border-radius:20px;padding:6px 14px;min-height:36px;font-size:14px;${g ? `--gc:${gColor(g)};color:var(--gc)` : ''}">${g ? esc(g) : 'Todas'}</button>`).join('');
  const q = norm($('cSearch').value);
  const list = app.canciones.filter(s => (!app.cat || (s.categorias || []).includes(app.cat)) && norm(s.titulo + ' ' + s.texto).includes(q));
  $('btnPublicas').textContent = app.publicas ? '‹ Volver a las canciones del grupo' : '🌎 Ver canciones compartidas por otros grupos';
  $('cList').innerHTML = list.map(s => {
    const fc = firstChord(parsedOf(s)); const c0 = (s.categorias || [])[0] || '';
    const act = app.publicas ? (isAdmin() ? `<button data-copy="${s.id}">＋ Copiar</button>` : '') : (isAdmin() ? `<button data-edit="${s.id}">✎</button>` : '');
    return `<div class="item" style="--gc:${gColor(c0)}"><div class="main" data-open="${s.id}"><div class="t">${esc(s.titulo)}</div><div class="s">${(s.categorias || []).map(chip).join('')}${fc ? ' Tono ' + esc(fc) : ''}${s.publica && !app.publicas ? ' · 🌎' : ''}</div></div>${act}</div>`;
  }).join('') || `<p class="muted">${app.canciones.length ? 'No hay resultados' : app.publicas ? 'Todavía no hay canciones compartidas.' : 'Todavía no hay canciones. ' + (isAdmin() ? 'Tocá ＋ Nueva para cargar la primera.' : '')}</p>`;
}
$('cSearch').addEventListener('input', drawCanciones);
$('cGroups').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; app.cat = b.dataset.c; drawCanciones() });
$('btnPublicas').onclick = () => { app.publicas = !app.publicas; app.cat = ''; loadCanciones() };
$('cList').addEventListener('click', async e => {
  const b = e.target.closest('[data-open],[data-edit],[data-copy]'); if (!b) return;
  if (b.dataset.edit) return openEditor(b.dataset.edit);
  if (b.dataset.copy) {
    const s = app.canciones.find(x => x.id === b.dataset.copy);
    const { error } = await sb.from('canciones').insert({ grupo_id: app.grupo.id, titulo: s.titulo, texto: s.texto, categorias: s.categorias || [] });
    toast(error ? errMsg(error) : 'Copiada a tu grupo ✓'); return;
  }
  const s = app.canciones.find(x => x.id === b.dataset.open); if (s) openSolo(s, 0);
});
$('btnCNew').onclick = () => openEditor(null);

/* ----- Editor ----- */
let edId = null, edCats = [], delArm = false;
function openEditor(id) {
  const s = id ? app.canciones.find(x => x.id === id) : null; edId = s ? s.id : null; delArm = false;
  $('edH').textContent = s ? 'Editar canción' : 'Nueva canción';
  $('edTit').value = s ? s.titulo : ''; $('edTxt').value = s ? s.texto : ''; $('edPub').checked = !!(s && s.publica);
  edCats = s ? [...(s.categorias || [])] : (app.cat ? [app.cat] : []);
  $('edDel').classList.toggle('hidden', !s); $('edDel').textContent = 'Borrar'; $('edMsg').textContent = '';
  drawChips(); $('editor').classList.remove('hidden');
}
function drawChips() { const all = sortGroups([...catsOf(app.canciones), ...edCats]); $('edChips').innerHTML = all.map(g => `<button data-g="${esc(g)}" class="${edCats.includes(g) ? 'on' : ''}" style="border-radius:20px;padding:6px 12px;min-height:34px;font-size:14px">${esc(g)}</button>`).join('') }
$('edChips').addEventListener('click', e => { const g = e.target.closest('button')?.dataset.g; if (g == null) return; edCats = edCats.includes(g) ? edCats.filter(x => x !== g) : [...edCats, g]; drawChips() });
$('edAddG').onclick = () => { const g = $('edNewG').value.trim(); if (!g) return; if (!edCats.includes(g)) edCats.push(g); $('edNewG').value = ''; drawChips() };
const closeEd = () => $('editor').classList.add('hidden');
$('edX').onclick = closeEd; $('edCancel').onclick = closeEd;
$('edSave').onclick = async () => {
  const row = { titulo: $('edTit').value.trim(), texto: $('edTxt').value.replace(/\s+$/, ''), categorias: edCats, publica: $('edPub').checked };
  if (!row.titulo) { $('edMsg').textContent = 'Falta el título'; return }
  if (!row.texto.trim()) { $('edMsg').textContent = 'Falta la letra'; return }
  $('edSave').disabled = true; $('edMsg').textContent = '';
  const { error } = edId ? await sb.from('canciones').update(row).eq('id', edId) : await sb.from('canciones').insert({ ...row, grupo_id: app.grupo.id });
  $('edSave').disabled = false;
  if (error) { $('edMsg').textContent = errMsg(error); return }
  closeEd(); toast('Canción guardada ✓'); loadCanciones();
};
$('edDel').onclick = async () => {
  if (!delArm) { delArm = true; $('edDel').textContent = '¿Seguro? Tocá otra vez'; return }
  const { error } = await sb.from('canciones').delete().eq('id', edId);
  if (error) { $('edMsg').textContent = errMsg(error); return }
  closeEd(); toast('Canción borrada'); loadCanciones();
};

/* ----- Cancioneros ----- */
async function loadLibros() {
  const { data, error } = await sb.from('cancioneros').select('id,nombre,cancionero_items(count)').eq('grupo_id', app.grupo.id).order('created_at', { ascending: false });
  if (error) { toast(errMsg(error)); return }
  app.libros = data || [];
  $('lList').innerHTML = app.libros.map(l => `<div class="item"><div class="main" data-l="${l.id}"><div class="t">📖 ${esc(l.nombre)}</div><div class="s">${l.cancionero_items?.[0]?.count || 0} canciones</div></div><button data-l="${l.id}">Abrir ›</button></div>`).join('')
    || `<p class="muted">Un cancionero es una lista de canciones en orden, con el tono que usan ustedes. ${isAdmin() ? 'Creá el primero arriba.' : ''}</p>`;
}
$('btnLNew').onclick = async () => {
  const n = $('lNew').value.trim(); if (!n) { toast('Escribí un nombre'); return }
  const { data, error } = await sb.from('cancioneros').insert({ grupo_id: app.grupo.id, nombre: n }).select().single();
  if (error) { toast(errMsg(error)); return }
  $('lNew').value = ''; await loadLibros(); openLibro(data.id);
};
$('lList').addEventListener('click', e => { const l = e.target.closest('[data-l]')?.dataset.l; if (l) openLibro(l) });
async function openLibro(id) {
  const l = app.libros.find(x => x.id === id); if (!l) return;
  app.libro = l; $('lName').textContent = l.nombre; show('vLibro'); await loadItems();
}
async function loadItems() {
  const { data, error } = await sb.from('cancionero_items').select('id,orden,tono,canciones(id,titulo,texto,categorias)').eq('cancionero_id', app.libro.id).order('orden');
  if (error) { toast(errMsg(error)); return }
  app.items = (data || []).filter(i => i.canciones);
  $('liList').innerHTML = app.items.map((it, k) => {
    const s = it.canciones, fc = firstChord(parsedOf(s)); const key = fc ? trChord(fc, it.tono, null) : '';
    return `<div class="item" style="--gc:${gColor((s.categorias || [])[0] || '')}"><div class="main" data-i="${it.id}"><div class="t">${k + 1}. ${esc(s.titulo.replace(/^\s*\d+\s*\.\s*/, ''))}</div><div class="s">${key ? 'Tono ' + esc(key) : ''}${it.tono ? ` (${it.tono > 0 ? '+' : ''}${it.tono})` : ''}</div></div>
    ${isAdmin() ? `<div class="grp"><button data-t="-1" data-it="${it.id}">−½</button><button data-t="1" data-it="${it.id}">+½</button></div><div style="display:flex;flex-direction:column;gap:2px"><button data-up="${it.id}" style="min-height:28px;padding:0 8px">▲</button><button data-dn="${it.id}" style="min-height:28px;padding:0 8px">▼</button></div><button data-rm="${it.id}">✕</button>` : ''}</div>`;
  }).join('') || `<p class="muted">Este cancionero está vacío. ${isAdmin() ? 'Tocá ＋ Agregar canciones.' : ''}</p>`;
}
$('btnLBack').onclick = () => { show('vGrupo'); loadLibros() };
$('liList').addEventListener('click', async e => {
  const b = e.target.closest('button,[data-i]'); if (!b) return;
  const d = b.dataset;
  if (d.i) { const k = app.items.findIndex(x => x.id === d.i); return openSolo(app.items[k].canciones, app.items[k].tono, app.items.map(x => ({ song: x.canciones, tono: x.tono })), k) }
  if (d.it) { const it = app.items.find(x => x.id === d.it); await sb.from('cancionero_items').update({ tono: Math.max(-11, Math.min(11, it.tono + +d.t)) }).eq('id', it.id); return loadItems() }
  if (d.rm) { await sb.from('cancionero_items').delete().eq('id', d.rm); return loadItems() }
  const id = d.up || d.dn; if (!id) return;
  const k = app.items.findIndex(x => x.id === id), j = d.up ? k - 1 : k + 1; if (j < 0 || j >= app.items.length) return;
  const a = app.items[k], c = app.items[j];
  await sb.from('cancionero_items').update({ orden: c.orden }).eq('id', a.id);
  await sb.from('cancionero_items').update({ orden: a.orden }).eq('id', c.id);
  loadItems();
});
$('btnLiAdd').onclick = () => openPicker('add');
$('btnLRen').onclick = async () => {
  const ok = await ask('Renombrar cancionero', `<input id="lrn" value="${esc(app.libro.nombre)}">`, 'Guardar'); if (!ok) return;
  const n = $('lrn').value.trim(); if (!n) return;
  await sb.from('cancioneros').update({ nombre: n }).eq('id', app.libro.id); app.libro.nombre = n; $('lName').textContent = n;
};
$('btnLDel').onclick = async () => {
  if (!await ask('¿Borrar este cancionero?', '<p class="muted">Las canciones no se borran, siguen en la biblioteca del grupo.</p>', 'Borrar')) return;
  await sb.from('cancioneros').delete().eq('id', app.libro.id); show('vGrupo'); loadLibros();
};

/* ----- Miembros ----- */
async function loadMiembros() {
  const { data, error } = await sb.from('miembros').select('user_id,rol,perfiles(nombre)').eq('grupo_id', app.grupo.id);
  if (error) { $('mList').innerHTML = ''; return }
  $('mList').innerHTML = (data || []).sort((a, b) => (a.rol > b.rol ? 1 : -1)).map(m => {
    const me = m.user_id === app.user.id;
    return `<div class="item"><div class="main"><div class="t" style="font-size:18px">${esc(m.perfiles?.nombre || 'Sin nombre')}${me ? ' (vos)' : ''}</div><div class="s">${m.rol === 'admin' ? '🎤 Director' : '🎸 Músico'}</div></div>
    ${isAdmin() && !me ? `<button data-rol="${m.user_id}" data-cur="${m.rol}">${m.rol === 'admin' ? 'Hacer músico' : 'Hacer director'}</button><button data-kick="${m.user_id}">✕</button>` : ''}</div>`;
  }).join('');
}
$('mList').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.rol) { const { error } = await sb.from('miembros').update({ rol: b.dataset.cur === 'admin' ? 'musico' : 'admin' }).eq('grupo_id', app.grupo.id).eq('user_id', b.dataset.rol); if (error) toast(errMsg(error)); loadMiembros() }
  if (b.dataset.kick) { if (!await ask('¿Sacar a esta persona del grupo?', '', 'Sacar')) return; await sb.from('miembros').delete().eq('grupo_id', app.grupo.id).eq('user_id', b.dataset.kick); loadMiembros() }
});
$('btnCopyCode').onclick = async () => {
  const url = `${redirectTo}?invitacion=${app.grupo.codigo}`;
  const txt = `Sumate a "${app.grupo.nombre}" en el Cancionero en vivo: ${url}\n(o entrá y poné el código ${app.grupo.codigo})`;
  try { if (navigator.share) { await navigator.share({ text: txt }); return } await navigator.clipboard.writeText(txt); toast('Invitación copiada ✓') } catch (e) { toast('Código: ' + app.grupo.codigo) }
};
$('btnLeave').onclick = async () => {
  if (!await ask('¿Salir del grupo?', '<p class="muted">Vas a necesitar el código para volver a entrar.</p>', 'Salir')) return;
  const { error } = await sb.from('miembros').delete().eq('grupo_id', app.grupo.id).eq('user_id', app.user.id);
  if (error) { toast(errMsg(error)); return }
  lsSet('cv_grupo', null); await loadGrupos(); show('vHome');
};

/* ===================== SALA EN VIVO / VISTA CANCIÓN ===================== */
let S = { v: 1, song: null, t: 0, sec: -1, rep: false, playing: false, speed: 30, ts: 0, cola: [], qi: -1 };
let L = Object.assign({ fs: 22, chords: true, extra: 0, follow: true, zoom: 1 }, lsGet('cv_local', {}));
let mode = null, code = null, chan = null, peers = 1, live = false, salaGrupo = null, fromLibro = false;
const songCache = {};
const cacheSongs = list => list.forEach(x => { if (x && x.id) songCache[x.id] = x });
const toQ = (song, tono) => ({ k: Math.random().toString(36).slice(2, 9), id: song.id, titulo: song.titulo, tono: tono || 0 });
async function songById(id) {
  if (songCache[id]) return songCache[id];
  const { data } = await sb.from('canciones').select('id,titulo,texto,categorias').eq('id', id).maybeSingle();
  if (data) songCache[id] = data; return data;
}
async function playQ(i) {
  const q = S.cola[i]; if (!q) return;
  const s = await songById(q.id); if (!s) { toast('No se encontró esa canción'); return }
  setSong(s, q.tono, i);
}

function render() {
  document.documentElement.style.setProperty('--fs', Math.round(L.fs * (L.zoom || 1)) + 'px');
  $('btnZoom').textContent = '🔍 ' + String(L.zoom || 1).replace('.', ',') + '×';
  document.body.classList.toggle('nochords', !L.chords);
  document.body.classList.toggle('dir', mode === 'dir' || mode === 'solo');
  $('mSala').classList.toggle('hidden', mode === 'solo');
  { const nx = nextQ(); $('mNext').innerHTML = nx ? `Sigue: <b>${esc(nx.titulo.replace(/^\s*\d+\s*\.\s*/, ''))}</b>` : ''; $('btnCola').textContent = '📋' + ((S.cola || []).length ? ' ' + S.cola.length : ''); if (!$('cola').classList.contains('hidden')) drawCola() }
  $('btnRecs').classList.toggle('hidden', !(mode !== 'mus' && app.grupo && S.song && S.song.id && !app.publicas)); $('mCode').textContent = code || '—';
  const sg = S.song, secs = sg ? parsedOf(sg) : null;
  const n = S.t + (mode === 'mus' ? L.extra : 0);
  if (!sg) {
    $('songTitle').textContent = mode === 'dir' ? 'Elegí una canción' : 'Esperando al director…';
    $('mKey').textContent = '—'; $('songGroups').innerHTML = '';
    $('song').innerHTML = `<div class="empty">${mode === 'dir' ? `Tocá <b>🎵 Lista</b> para elegir qué cantar.<br><br>Código de la sala: <b style="color:var(--acc);font-size:1.4em">${code}</b>` : 'Cuando el director elija una canción va a aparecer acá.'}</div>`;
    renderBar(); return;
  }
  const fc = firstChord(secs);
  let flat = usesFlats(secs);
  if (fc) { const p = parseChord(fc); const k = ((noteIdx(p.root, p.acc) + n) % 12 + 12) % 12; const minor = /^m(?!aj)/.test(p.q); if (n !== 0) flat = minor ? [0, 2, 5, 7, 10].includes(k) : [5, 10, 3, 8, 1].includes(k) }
  $('songTitle').textContent = sg.titulo;
  $('songGroups').innerHTML = (sg.categorias || []).map(chip).join('');
  $('mKey').textContent = fc ? trChord(fc, n, flat) : '—';
  let h = '<div class="secs">';
  secs.forEach((s, i) => {
    const cls = ['sec']; if (i === S.sec) cls.push('cur'); if (i === S.sec && S.rep) cls.push('rep');
    h += `<div class="${cls.join(' ')}" data-i="${i}">`;
    if (i === S.sec && S.rep) h += '<div class="badge">↻ REPETIR</div>';
    if (s.label) h += `<div class="lbl">${esc(s.label)}</div>`;
    for (const l of s.lines) {
      if (l.type === 'text') { h += `<div class="ln">${esc(l.text)}</div>`; continue }
      if (l.type === 'chords') { let str = ''; for (const c of l.chords) { const t = trToken(c.c, n, flat); const pos = Math.max(c.pos, str.length ? str.length + 1 : 0); str = str.padEnd(pos, ' ') + t } h += `<div class="ln chline">${esc(str)}</div>`; continue }
      const text = l.text, ch = snap(l.chords, l.text);
      if (!ch.length) { h += `<div class="ln">${esc(text)}</div>`; continue }
      const segs = [];
      if (ch[0].pos > 0) segs.push({ c: '', t: text.slice(0, ch[0].pos) });
      ch.forEach((c, j) => { const end = j + 1 < ch.length ? ch[j + 1].pos : text.length; segs.push({ c: trToken(c.c, n, flat), t: text.slice(c.pos, end) || ' ' }) });
      const pieces = [];
      for (const g of segs) { const ws = g.t.match(/\S*\s+|\S+/g) || [' ']; ws.forEach((w, k) => pieces.push({ c: k ? '' : g.c, t: w.replace(/\s{2,}$/, ' ') })) }
      let seg = '', open = false;
      pieces.forEach((pc, k) => { if (k === 0 || /\s$/.test(pieces[k - 1].t)) { if (open) seg += '</span>'; seg += '<span class="wg">'; open = true } seg += `<span class="seg"><span class="c">${esc(pc.c)}</span><span class="x">${esc(pc.t)}</span></span>` });
      if (open) seg += '</span>';
      h += `<div class="ln">${seg}</div>`;
    }
    h += '</div>';
  });
  $('song').innerHTML = h + '</div>';
  renderBar();
}
function renderBar() {
  const b = $('bar');
  if (mode === 'dir' || mode === 'solo') {
    const hasQ = (S.cola || []).length > 0;
    const nav = hasQ ? `<button data-a="sprev">⏮</button>` : '';
    const nav2 = hasQ ? `<button data-a="snext">⏭</button>` : '';
    b.innerHTML = `
    <div class="row">
      <div class="grp"><button data-a="t-">−½</button><span>Tono<b>${S.t > 0 ? '+' : ''}${S.t}</b></span><button data-a="t+">+½</button></div>
      <div class="grp"><button data-a="s-">🐢</button><span>Avance<b>${S.speed}</b></span><button data-a="s+">🐇</button></div>
    </div>
    <div class="row">
      ${mode === 'dir' ? '<button data-a="pick">🎵 Lista</button>' : ''}${nav}
      <button data-a="prev" title="Estrofa anterior">◂</button>
      <button data-a="rep" class="${S.rep ? 'on' : ''}">↻ Repetir</button>
      <button data-a="next" title="Estrofa siguiente">▸</button>${nav2}
      <button data-a="play" class="${S.playing ? 'on' : ''}">${S.playing ? '⏸ Pausa' : '▶ Pasar'}</button>
    </div>`;
  } else {
    b.innerHTML = `
    <div class="row">
      <div class="grp"><button data-a="f-">A−</button><span>Letra</span><button data-a="f+">A+</button></div>
      <div class="grp"><button data-a="e-">−½</button><span>Mi tono<b>${L.extra > 0 ? '+' : ''}${L.extra}</b></span><button data-a="e+">+½</button></div>
    </div>
    <div class="row">
      <button data-a="chords" class="${L.chords ? 'on' : ''}">Acordes</button>
      <button data-a="follow" class="${L.follow ? 'on' : ''}">Seguir director</button>
    </div>`;
  }
}
function nextQ() { return (S.cola || [])[(S.qi ?? -1) + 1] || null }
function drawCola() {
  const ed = mode === 'dir' || mode === 'solo';
  $('qList').innerHTML = (S.cola || []).map((q, i) => {
    const cur = i === S.qi, past = i < S.qi;
    return `<div class="item" style="${cur ? 'border-color:var(--acc);background:rgba(240,194,100,.12)' : past ? 'opacity:.5' : ''}"><div class="main" ${ed ? `data-qp="${i}"` : ''}><div class="t" style="font-size:18px">${cur ? '▶ ' : (i + 1) + '. '}${esc(q.titulo.replace(/^\s*\d+\s*\.\s*/, ''))}</div><div class="s">${cur ? 'Sonando ahora' : i === S.qi + 1 ? 'Sigue' : past ? 'Ya pasó' : 'En espera'}${q.tono ? ` · tono ${q.tono > 0 ? '+' : ''}${q.tono}` : ''}</div></div>
    ${ed ? `<div style="display:flex;flex-direction:column;gap:2px"><button data-qu="${i}" style="min-height:28px;padding:0 8px">▲</button><button data-qd="${i}" style="min-height:28px;padding:0 8px">▼</button></div><button data-qx="${i}">✕</button>` : ''}</div>`;
  }).join('') || `<p class="muted">La cola está vacía. ${ed ? 'Abrí 🎵 Lista y tocá ＋ Cola en las canciones que siguen.' : ''}</p>`;
  $('qAdd').classList.toggle('hidden', !ed || mode === 'solo');
}
$('qList').addEventListener('click', e => {
  if (mode !== 'dir' && mode !== 'solo') return;
  const b = e.target.closest('[data-qp],[data-qu],[data-qd],[data-qx]'); if (!b) return; const d = b.dataset;
  if (d.qp != null) { $('cola').classList.add('hidden'); playQ(+d.qp); return }
  const i = +(d.qu ?? d.qd ?? d.qx);
  if (d.qx != null) { S.cola.splice(i, 1); if (i < S.qi) S.qi--; else if (i === S.qi) S.qi = -1 }
  else { const j = d.qu != null ? i - 1 : i + 1; if (j < 0 || j >= S.cola.length) return; [S.cola[i], S.cola[j]] = [S.cola[j], S.cola[i]]; if (S.qi === i) S.qi = j; else if (S.qi === j) S.qi = i }
  publish(); drawCola();
});
$('btnCola').onclick = () => { drawCola(); $('cola').classList.remove('hidden') };
$('qX').onclick = () => $('cola').classList.add('hidden');
$('qAdd').onclick = () => { $('cola').classList.add('hidden'); openPicker('sala') };
function setConn() { $('mConn').innerHTML = mode === 'solo' ? '' : live ? `<span class="dot live"></span>en vivo · ${peers} conectado${peers === 1 ? '' : 's'}` : '<span class="dot"></span>conectando…' }

let lastSave = 0, saveTimer = null;
function publish() {
  S.ts = Date.now(); render();
  if (mode !== 'dir') return;
  lsSet('cv_dir_' + code, S);
  if (chan) chan.send({ type: 'broadcast', event: 'estado', payload: S }).catch(() => { });
  clearTimeout(saveTimer); saveTimer = setTimeout(saveSala, 400);
}
async function saveSala() { const { error } = await sb.from('salas').update({ estado: S, updated_at: new Date().toISOString() }).eq('codigo', code); if (error) console.log('sala', error) }
function receive(p) {
  if (mode !== 'mus' || !p || p.v !== 1 || !(p.ts > S.ts)) return;
  const songChanged = (p.song && p.song.titulo + p.song.texto) !== (S.song && S.song.titulo + S.song.texto), secChanged = p.sec !== S.sec || p.rep !== S.rep;
  S = Object.assign({}, S, p); render();
  if (!L.follow) return;
  if (songChanged) { window.scrollTo({ top: 0 }); scrollAcc = 0 }
  else if (secChanged && S.sec >= 0) scrollToSec(S.sec);
  if (S.rep && secChanged) toast('↻ Repetir');
}
function scrollToSec(i) { const el = document.querySelector(`.sec[data-i="${i}"]`); if (!el) return; const y = el.getBoundingClientRect().top + window.scrollY - $('top').offsetHeight - 12; window.scrollTo({ top: y, behavior: 'smooth' }) }
function goSec(i) { const secs = S.song && parsedOf(S.song); if (!secs) return; S.sec = Math.max(0, Math.min(secs.length - 1, i)); S.rep = false; publish(); scrollToSec(S.sec) }
function setSong(song, tono, idx) { if (song && song.id) songCache[song.id] = song; S.qi = idx ?? -1; S.song = song ? { id: song.id, titulo: song.titulo, texto: song.texto, categorias: song.categorias || [] } : null; recSong = song && song.id ? song : null; S.t = tono || 0; S.sec = -1; S.rep = false; S.playing = false; window.scrollTo({ top: 0 }); scrollAcc = 0; publish() }

$('bar').addEventListener('click', e => {
  const a = e.target.closest('button')?.dataset.a; if (!a) return;
  if (mode === 'dir' || mode === 'solo') {
    if (a === 't-' || a === 't+') { S.t = Math.max(-11, Math.min(11, S.t + (a === 't+' ? 1 : -1))); if (S.qi >= 0 && S.cola[S.qi]) S.cola[S.qi].tono = S.t; publish() }
    if (a === 's-') { S.speed = Math.max(5, S.speed - 5); publish() }
    if (a === 's+') { S.speed = Math.min(150, S.speed + 5); publish() }
    if (a === 'pick') openPicker('sala');
    if (a === 'prev') goSec(S.sec - 1);
    if (a === 'next') goSec(S.sec + 1);
    if (a === 'sprev' || a === 'snext') { const j = (S.qi ?? -1) + (a === 'snext' ? 1 : -1); if (j >= 0 && j < S.cola.length) playQ(j); else toast(a === 'snext' ? 'No hay más en la cola' : 'Es la primera') }
    if (a === 'rep') { if (S.sec < 0) { toast('Primero tocá una estrofa'); return } S.rep = !S.rep; publish(); if (S.rep) scrollToSec(S.sec) }
    if (a === 'play') { if (!S.song) { toast('Elegí una canción'); return } S.playing = !S.playing; publish() }
  } else {
    if (a === 'f-') L.fs = Math.max(14, L.fs - 2);
    if (a === 'f+') L.fs = Math.min(48, L.fs + 2);
    if (a === 'e-') L.extra = Math.max(-11, L.extra - 1);
    if (a === 'e+') L.extra = Math.min(11, L.extra + 1);
    if (a === 'chords') L.chords = !L.chords;
    if (a === 'follow') { L.follow = !L.follow; if (L.follow && S.sec >= 0) scrollToSec(S.sec) }
    lsSet('cv_local', L); render();
  }
});
$('song').addEventListener('click', e => {
  if (mode !== 'dir' && mode !== 'solo') return; const s = e.target.closest('.sec'); if (!s) return;
  const i = +s.dataset.i; if (i === S.sec) { S.rep = !S.rep; publish(); return } goSec(i);
});

/* Solo (ver una canción sin sala) */
function openSolo(song, tono, list, idx) {
  leaveSala(); mode = 'solo'; code = null; fromLibro = !!list; S = { v: 1, song: null, t: 0, sec: -1, rep: false, playing: false, speed: S.speed || 30, ts: 0, cola: [], qi: -1 }; if (list) { cacheSongs(list.map(x => x.song)); S.cola = list.map(x => toQ(x.song, x.tono)) }
  show('vSala'); setSong(song, tono, idx); setConn();
}

/* Director */
async function startSala(list, grupoId) {
  leaveSala(); mode = 'dir'; salaGrupo = grupoId; fromLibro = !!(list && list.length);
  let c = lsGet('cv_sala_' + grupoId, null), ok = false;
  if (c) { const { data } = await sb.from('salas').select('codigo,director').eq('codigo', c).maybeSingle(); ok = data && data.director === app.user.id }
  for (let i = 0; !ok && i < 8; i++) {
    c = String(Math.floor(1000 + Math.random() * 9000));
    const { error } = await sb.from('salas').insert({ codigo: c, grupo_id: grupoId, director: app.user.id, estado: {} });
    ok = !error; if (error && !/duplicate/i.test(error.message)) { toast(errMsg(error)); return }
  }
  if (!ok) { toast('No se pudo crear la sala, probá de nuevo'); return }
  code = c; lsSet('cv_sala_' + grupoId, c);
  S = { v: 1, song: null, t: 0, sec: -1, rep: false, playing: false, speed: 30, ts: 0, cola: [], qi: -1 };
  show('vSala'); render(); setConn(); connect(c);
  if (list && list.length) { cacheSongs(list.map(x => x.song)); S.cola = list.map(x => toQ(x.song, x.tono)); setSong(list[0].song, list[0].tono, 0) } else publish();
  toast('Sala ' + c + ' abierta: pasá el código');
}
$('btnDirigir').onclick = () => startSala([], app.grupo.id);
$('btnLDirigir').onclick = () => { if (!app.items.length) { toast('El cancionero está vacío'); return } startSala(app.items.map(x => ({ song: x.canciones, tono: x.tono })), app.grupo.id) };

/* Músico */
async function joinSala(c) {
  const { data, error } = await sb.from('salas').select('codigo,estado,director,grupo_id').eq('codigo', c).maybeSingle();
  if (error || !data) { toast('No existe la sala ' + c); return }
  leaveSala(); mode = data.director === app.user.id ? 'dir' : 'mus'; code = c; salaGrupo = data.grupo_id; fromLibro = false;
  S = { v: 1, song: null, t: 0, sec: -1, rep: false, playing: false, speed: 30, ts: 0, cola: [], qi: -1 };
  if (mode === 'mus') { if (data.estado && data.estado.v === 1) S = Object.assign(S, data.estado) }
  else { const prev = lsGet('cv_dir_' + c, null); if (prev) S = Object.assign(S, prev) }
  show('vSala'); render(); setConn(); connect(c); keepAwake();
  if (mode === 'mus' && S.sec >= 0 && L.follow) setTimeout(() => scrollToSec(S.sec), 300);
}
function connect(c) {
  chan = sb.channel('sala-' + c, { config: { broadcast: { self: false }, presence: { key: app.user.id } } });
  chan.on('broadcast', { event: 'estado' }, ({ payload }) => receive(payload));
  chan.on('broadcast', { event: 'pedir' }, () => { if (mode === 'dir' && S.ts) chan.send({ type: 'broadcast', event: 'estado', payload: S }) });
  chan.on('presence', { event: 'sync' }, () => { peers = Object.keys(chan.presenceState()).length || 1; setConn() });
  chan.subscribe(async st => {
    live = st === 'SUBSCRIBED'; setConn();
    if (live) { await chan.track({ rol: mode, nombre: app.perfil?.nombre || '' }); if (mode === 'mus') chan.send({ type: 'broadcast', event: 'pedir', payload: {} }); if (mode === 'dir' && S.ts) chan.send({ type: 'broadcast', event: 'estado', payload: S }) }
  });
}
setInterval(() => { if (mode === 'dir' && chan && live && S.ts) chan.send({ type: 'broadcast', event: 'estado', payload: S }).catch(() => { }) }, 5000);
function leaveSala() { if (chan) { try { sb.removeChannel(chan) } catch (e) { } } chan = null; live = false; S.playing = false; mode = null }
$('btnExit').onclick = () => {
  const wasLibro = fromLibro && app.libro && mode !== 'mus';
  leaveSala();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
  if (wasLibro) { show('vLibro'); return }
  if (app.grupo) { show('vGrupo'); return } show('vHome');
};

/* Selector de canciones (sala y agregar a cancionero) */
let pMode = 'sala', pCat = '', pSel = new Set();
async function openPicker(m) {
  pMode = m; pCat = ''; pSel = new Set(); $('psearch').value = '';
  if (m === 'sala' && salaGrupo && (!app.grupo || app.grupo.id !== salaGrupo || !app.canciones.length)) {
    const { data } = await sb.from('canciones').select('id,titulo,texto,categorias').eq('grupo_id', salaGrupo); app.canciones = (data || []).sort(bySong);
  }
  $('pclose').textContent = m === 'add' ? 'Agregar seleccionadas' : 'Cerrar';
  $('picker').classList.remove('hidden'); fillPicker();
}
function fillPicker() {
  const pool = app.canciones;
  const cats = catsOf(pool);
  $('pgroups').innerHTML = ['', ...cats].map(g => `<button data-g="${esc(g)}" class="${g === pCat ? 'on' : ''}" ${g ? `style="--gc:${gColor(g)}"` : ''}>${g ? esc(g) : 'Todas'}</button>`).join('');
  const q = norm($('psearch').value);
  const list = pool.filter(s => (!pCat || (s.categorias || []).includes(pCat)) && norm(s.titulo + ' ' + s.texto).includes(q));
  $('plist').innerHTML = list.map((s, k) => {
    const fc = firstChord(parsedOf(s)); const sel = pSel.has(s.id);
    return `<div class="item" style="--gc:${gColor((s.categorias || [])[0] || '')}${sel ? ';background:rgba(240,194,100,.15)' : ''}"><div class="main" data-p="${s.id}"><div class="t">${pMode === 'add' ? (sel ? '☑ ' : '☐ ') : ''}${esc(s.titulo)}</div><div class="s">${(s.categorias || []).map(chip).join('')}${fc ? ' Tono ' + esc(fc) : ''}</div></div>${pMode === 'sala' ? `<button data-q="${s.id}" title="Agregar a la cola">＋ Cola</button>` : ''}</div>`;
  }).join('') || '<p class="muted">No hay resultados</p>';
}
$('psearch').addEventListener('input', fillPicker);
$('pgroups').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; pCat = b.dataset.g; fillPicker() });
$('plist').addEventListener('click', e => {
  const qb = e.target.closest('[data-q]');
  if (qb) { const sg = app.canciones.find(x => x.id === qb.dataset.q); if (!sg) return; songCache[sg.id] = sg; S.cola.push(toQ(sg, 0)); publish(); toast(`Agregada a la cola (${S.cola.length - Math.max(S.qi, -1) - 1} en espera)`); return }
  const el = e.target.closest('[data-p]'); if (!el) return;
  if (pMode === 'add') { const id = el.dataset.p; pSel.has(id) ? pSel.delete(id) : pSel.add(id); fillPicker(); return }
  $('picker').classList.add('hidden');
  const sg = app.canciones.find(s => s.id === el.dataset.p); if (!sg) return;
  const at = S.qi + 1; S.cola.splice(at, 0, toQ(sg, 0)); setSong(sg, 0, at);
});
$('pclose').onclick = async () => {
  $('picker').classList.add('hidden');
  if (pMode !== 'add' || !pSel.size) return;
  let orden = app.items.reduce((m, x) => Math.max(m, x.orden), 0);
  const rows = [...pSel].map(id => ({ cancionero_id: app.libro.id, cancion_id: id, orden: ++orden, tono: 0 }));
  const { error } = await sb.from('cancionero_items').insert(rows);
  toast(error ? errMsg(error) : `${rows.length} agregada${rows.length > 1 ? 's' : ''} ✓`); loadItems();
};

/* Avance automático */
let lastT = null, scrollAcc = 0;
function loop(t) {
  if (lastT != null && S.playing && S.song && mode && (mode !== 'mus' || L.follow)) { scrollAcc += S.speed * (t - lastT) / 1000; if (scrollAcc >= 1) { const d = Math.floor(scrollAcc); window.scrollBy(0, d); scrollAcc -= d } }
  lastT = t; requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* Zoom, pantalla completa, pantalla encendida */
let wake = null;
async function keepAwake() { try { if ('wakeLock' in navigator) wake = await navigator.wakeLock.request('screen') } catch (e) { } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && mode) keepAwake() });
const ZOOMS = [1, 1.25, 1.5, 2];
function setZoom(z) { const top = window.scrollY, h = document.body.scrollHeight; L.zoom = z; lsSet('cv_local', L); render(); window.scrollTo({ top: top * document.body.scrollHeight / Math.max(h, 1) }); toast('Zoom ' + String(z).replace('.', ',') + '×') }
$('btnZoom').onclick = () => { const i = ZOOMS.indexOf(L.zoom || 1); setZoom(ZOOMS[(i + 1) % ZOOMS.length]) };
document.addEventListener('fullscreenchange', () => { const on = !!document.fullscreenElement; document.body.classList.toggle('fs', on); document.body.classList.toggle('nobar', on && mode === 'mus'); if (on && (L.zoom || 1) < 1.5) setZoom(1.5) });
$('btnBar').onclick = () => document.body.classList.toggle('nobar');
$('btnFull').onclick = async () => {
  try { if (document.fullscreenElement) { await document.exitFullscreen(); return } await document.documentElement.requestFullscreen(); try { await screen.orientation.lock('landscape') } catch (e) { } }
  catch (e) { toast('Girá el celular y usá el zoom 🔍') }
};

/* ===================== AFINADOR ===================== */
const TUNINGS = [[40, 45, 50, 55, 59, 64], [39, 44, 49, 54, 58, 63], [38, 43, 48, 53, 57, 62], [38, 45, 50, 55, 59, 64]];
let actx = null, tuVoice = null, tuLoop = false, tuA = 440, tuCur = -1, tuTimer = null;
let mic = null, micAn = null, micBuf = null, micRaf = null, smooth = null;
const ctx = () => { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.resume) actx.resume(); return actx };
function drawStrings() { const t = TUNINGS[+$('tuSel').value]; $('tuStrings').innerHTML = t.map((m, i) => `<button data-s="${i}" class="${i === tuCur ? 'on' : ''}">${LA_S[m % 12]}<small>${6 - i}ª · ${AM_S[m % 12]}</small></button>`).join('') }
function stopTone() { if (tuVoice) { const { g, o } = tuVoice; try { g.gain.cancelScheduledValues(actx.currentTime); g.gain.setTargetAtTime(0, actx.currentTime, .05); o.forEach(x => x.stop(actx.currentTime + .3)) } catch (e) { } tuVoice = null } clearTimeout(tuTimer) }
function playTone(i) {
  try { ctx() } catch (e) { toast('No se puede reproducir sonido'); return }
  stopTone(); tuCur = i; drawStrings();
  const m = TUNINGS[+$('tuSel').value][i], f = tuA * Math.pow(2, (m - 69) / 12), t0 = actx.currentTime, dur = tuLoop ? 60 : 4;
  const g = actx.createGain(), lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(4000, f * 8);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(.35, t0 + .01);
  if (tuLoop) g.gain.setTargetAtTime(.18, t0 + .05, .4); else g.gain.setTargetAtTime(0, t0 + .05, 1.1);
  const o = [[1, 'triangle', .7], [2, 'sine', .25], [3, 'sine', .1]].map(([h, type, v]) => { const x = actx.createOscillator(), gg = actx.createGain(); x.type = type; x.frequency.value = f * h; gg.gain.value = v; x.connect(gg).connect(lp); x.start(t0); x.stop(t0 + dur); return x });
  lp.connect(g).connect(actx.destination); tuVoice = { g, o };
  tuTimer = setTimeout(() => { tuCur = -1; tuVoice = null; drawStrings() }, dur * 1000);
}
function detectPitch(buf, sr) {
  let rms = 0; for (const v of buf) rms += v * v; rms = Math.sqrt(rms / buf.length); if (rms < 0.012) return -1;
  const N = buf.length, minLag = Math.floor(sr / 1200), maxLag = Math.floor(sr / 60);
  let best = -1, bestV = 0; const c = new Float32Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1; lag++) { let s = 0, e1 = 0, e2 = 0; for (let i = 0; i < N - lag; i++) { s += buf[i] * buf[i + lag]; e1 += buf[i] * buf[i]; e2 += buf[i + lag] * buf[i + lag] } c[lag] = s / Math.sqrt(e1 * e2 || 1) }
  let mx = 0; for (let lag = minLag; lag <= maxLag; lag++) if (c[lag] > mx) mx = c[lag];
  for (let lag = minLag + 1; lag <= maxLag; lag++) { if (c[lag] > 0.9 * mx && c[lag] >= c[lag - 1] && c[lag] >= c[lag + 1]) { best = lag; bestV = c[lag]; break } }
  if (best < 0 || bestV < 0.5) return -1;
  const a = c[best - 1], b = c[best], d = c[best + 1], sh = (a - d) / (2 * (a - 2 * b + d) || 1);
  return sr / (best + sh);
}
function micLoop() {
  micAn.getFloatTimeDomainData(micBuf);
  const f = detectPitch(micBuf, actx.sampleRate);
  if (f > 0) {
    smooth = smooth ? smooth * 0.7 + f * 0.3 : f;
    const midi = 69 + 12 * Math.log2(smooth / tuA), m = Math.round(midi), cents = Math.round((midi - m) * 100);
    $('tuNote').textContent = LA_S[((m % 12) + 12) % 12]; $('tuNote').classList.toggle('ok', Math.abs(cents) <= 5);
    $('tuInfo').textContent = `${AM_S[((m % 12) + 12) % 12]} · ${smooth.toFixed(1)} Hz · ${cents > 0 ? '+' : ''}${cents} cents ${Math.abs(cents) <= 5 ? '✓ afinada' : cents < 0 ? '↑ subí' : '↓ bajá'}`;
    $('tuNeedle').style.transform = `rotate(${Math.max(-50, Math.min(50, cents)) * 0.9}deg)`;
  } else smooth = null;
  micRaf = requestAnimationFrame(micLoop);
}
async function micStart() {
  try {
    ctx(); mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const src = actx.createMediaStreamSource(mic); micAn = actx.createAnalyser(); micAn.fftSize = 4096; micBuf = new Float32Array(micAn.fftSize); src.connect(micAn);
    $('tuMic').textContent = 'Dejar de escuchar'; $('tuInfo').textContent = 'Pulsá una cuerda…'; micLoop();
  } catch (e) { toast('Necesito permiso para usar el micrófono'); micStop() }
}
function micStop() { cancelAnimationFrame(micRaf); if (mic) mic.getTracks().forEach(t => t.stop()); mic = null; $('tuMic').textContent = 'Empezar a escuchar' }
$('tuMic').onclick = () => mic ? micStop() : micStart();
document.querySelector('#tuner .tabs').addEventListener('click', e => { const t = e.target.closest('button')?.dataset.tt; if (!t) return; document.querySelectorAll('#tuner .tabs button').forEach(b => b.classList.toggle('on', b.dataset.tt === t)); document.querySelectorAll('#tuner [data-tp]').forEach(p => p.classList.toggle('hidden', p.dataset.tp !== t)); if (t === 'ear') micStop(); else stopTone() });
$('btnTuner').onclick = () => { $('tuner').classList.remove('hidden'); drawStrings() };
$('tuX').onclick = () => { stopTone(); micStop(); tuCur = -1; $('tuner').classList.add('hidden') };
$('tuSel').onchange = () => { stopTone(); tuCur = -1; drawStrings() };
$('tuStrings').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const i = +b.dataset.s; if (i === tuCur) { stopTone(); tuCur = -1; drawStrings() } else playTone(i) });
$('tuLoop').onclick = () => { tuLoop = !tuLoop; $('tuLoop').textContent = '🔁 Repetir nota: ' + (tuLoop ? 'sí' : 'no'); $('tuLoop').classList.toggle('on', tuLoop) };
$('tuAm').onclick = () => { tuA = Math.max(430, tuA - 1); $('tuA').textContent = tuA };
$('tuAp').onclick = () => { tuA = Math.min(450, tuA + 1); $('tuA').textContent = tuA };

/* ===================== GRABACIONES ===================== */
let recSong = null, recorder = null, recChunks = [], recStart = 0, recTimer = null;
const fmtDate = d => new Date(d).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
function ytEmbed(u) { const m = String(u).match(/(?:youtu\.be\/|v=|shorts\/)([\w-]{11})/); return m ? m[1] : null }
function recItem(r, withSong) {
  const who = r.perfiles?.nombre ? ' · ' + esc(r.perfiles.nombre) : '';
  const canDel = r.subido_por === app.user.id || isAdmin();
  const name = r.titulo || (r.tipo === 'link' ? (/spotify/i.test(r.url) ? 'Spotify' : /youtu/i.test(r.url) ? 'YouTube' : 'Link') : 'Grabación');
  const song = withSong && r.canciones ? `<div class="s">🎵 ${esc(r.canciones.titulo)}</div>` : '';
  const body = r.tipo === 'link' ? `<a href="${esc(r.url)}" target="_blank" rel="noopener" style="color:var(--acc)">Abrir ${/youtu/i.test(r.url) ? 'en YouTube' : /spotify/i.test(r.url) ? 'en Spotify' : 'link'} ↗</a>`
    : `<button data-play="${esc(r.path)}" style="margin-top:6px">▶ Escuchar</button>`;
  return `<div class="item rec"><div class="top"><div class="main"><div class="t" style="font-size:18px">${r.tipo === 'link' ? '🔗' : '🎙'} ${esc(name)}</div>${song}<div class="s">${fmtDate(r.created_at)}${who}</div></div>${canDel ? `<button data-delrec="${r.id}" data-path="${esc(r.path || '')}">🗑</button>` : ''}</div><div>${body}</div></div>`;
}
async function loadGrab() {
  const { data } = await sb.from('grabaciones').select('*, perfiles(nombre), canciones(titulo)').eq('grupo_id', app.grupo.id).order('created_at', { ascending: false }).limit(200);
  $('grList').innerHTML = (data || []).map(r => recItem(r, true)).join('') || '<p class="muted">Todavía no hay grabaciones.</p>';
}
async function loadRecs() {
  const { data, error } = await sb.from('grabaciones').select('*, perfiles(nombre)').eq('cancion_id', recSong.id).order('created_at', { ascending: false });
  if (error) { $('rcList').innerHTML = `<p class="muted">${esc(errMsg(error))}</p>`; return }
  $('rcList').innerHTML = (data || []).map(r => recItem(r, false)).join('') || '<p class="muted">Todavía no hay grabaciones de esta canción. ¡Grabá el próximo ensayo!</p>';
}
$('btnRecs').onclick = () => { if (!recSong) return; $('rcT').textContent = '🎧 ' + recSong.titulo.replace(/^\s*\d+\s*\.\s*/, ''); $('recs').classList.remove('hidden'); loadRecs() };
$('rcX').onclick = () => { stopRecording(true); document.querySelectorAll('#recs audio').forEach(a => a.pause()); $('recs').classList.add('hidden') };
async function onRecClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.play) {
    b.disabled = true; b.textContent = 'Cargando…';
    const { data, error } = await sb.storage.from('grabaciones').createSignedUrl(b.dataset.play, 3600);
    if (error) { b.textContent = 'No se pudo abrir'; return }
    const a = document.createElement('audio'); a.controls = true; a.src = data.signedUrl; a.preload = 'auto'; b.replaceWith(a); a.play().catch(() => { });
  }
  if (b.dataset.delrec) {
    if (!await ask('¿Borrar esta grabación?', '', 'Borrar')) return;
    if (b.dataset.path) await sb.storage.from('grabaciones').remove([b.dataset.path]);
    const { error } = await sb.from('grabaciones').delete().eq('id', b.dataset.delrec);
    if (error) toast(errMsg(error)); else toast('Borrada');
    if (!$('recs').classList.contains('hidden')) loadRecs(); if (app.grupo) loadGrab();
  }
}
$('rcList').addEventListener('click', onRecClick); $('grList').addEventListener('click', onRecClick);
async function uploadAudio(blob, ext) {
  if (blob.size > 25 * 1024 * 1024) { toast('El archivo es muy grande (máximo 25 MB)'); return }
  const path = `${app.grupo.id}/${crypto.randomUUID()}.${ext}`;
  $('rcRecInfo').classList.remove('hidden'); $('rcRecInfo').textContent = 'Subiendo…';
  const { error } = await sb.storage.from('grabaciones').upload(path, blob, { contentType: blob.type || 'audio/mpeg', upsert: false });
  if (error) { $('rcRecInfo').textContent = 'No se pudo subir: ' + errMsg(error); return }
  const { error: e2 } = await sb.from('grabaciones').insert({ grupo_id: app.grupo.id, cancion_id: recSong.id, titulo: $('rcName').value.trim(), tipo: 'audio', path, subido_por: app.user.id });
  if (e2) { await sb.storage.from('grabaciones').remove([path]); $('rcRecInfo').textContent = errMsg(e2); return }
  $('rcRecInfo').textContent = 'Subida ✓'; $('rcName').value = ''; setTimeout(() => $('rcRecInfo').classList.add('hidden'), 1500); loadRecs(); loadGrab();
}
$('rcUp').onclick = () => $('rcFile').click();
$('rcFile').onchange = () => { const f = $('rcFile').files[0]; $('rcFile').value = ''; if (!f) return; if (!$('rcName').value.trim()) $('rcName').value = f.name.replace(/\.[^.]+$/, ''); uploadAudio(f, (f.name.split('.').pop() || 'mp3').toLowerCase()) };
$('rcAddUrl').onclick = async () => {
  const url = $('rcUrl').value.trim(); if (!/^https?:\/\//i.test(url)) { toast('Pegá un link que empiece con https://'); return }
  const { error } = await sb.from('grabaciones').insert({ grupo_id: app.grupo.id, cancion_id: recSong.id, titulo: $('rcName').value.trim(), tipo: 'link', url, subido_por: app.user.id });
  if (error) { toast(errMsg(error)); return } $('rcUrl').value = ''; $('rcName').value = ''; toast('Link agregado ✓'); loadRecs(); loadGrab();
};
function stopRecording(discard) {
  if (!recorder) return; recorder._discard = !!discard; try { recorder.stop() } catch (e) { }
}
$('rcRec').onclick = async () => {
  if (recorder) { stopRecording(false); return }
  if (!window.MediaRecorder) { toast('Este celular no permite grabar desde la página. Usá ⬆ Subir audio'); return }
  let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } }) } catch (e) { toast('Necesito permiso para usar el micrófono'); return }
  const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg'].find(t => MediaRecorder.isTypeSupported(t)) || '';
  recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined); recChunks = [];
  recorder.ondataavailable = e => { if (e.data.size) recChunks.push(e.data) };
  recorder.onstop = () => {
    stream.getTracks().forEach(t => t.stop()); clearInterval(recTimer); $('rcRec').classList.remove('on'); $('rcRec').textContent = '● Grabar ahora';
    const discard = recorder._discard; const mt = recorder.mimeType || type || 'audio/webm'; recorder = null;
    if (discard || !recChunks.length) { $('rcRecInfo').classList.add('hidden'); return }
    const blob = new Blob(recChunks, { type: mt.split(';')[0] });
    if (!$('rcName').value.trim()) $('rcName').value = 'Ensayo ' + new Date().toLocaleDateString('es-AR');
    uploadAudio(blob, /mp4/.test(mt) ? 'm4a' : /ogg/.test(mt) ? 'ogg' : 'webm');
  };
  recorder.start(1000); recStart = Date.now(); $('rcRec').classList.add('on'); $('rcRec').textContent = '■ Terminar y subir';
  $('rcRecInfo').classList.remove('hidden');
  recTimer = setInterval(() => { const s = Math.floor((Date.now() - recStart) / 1000); $('rcRecInfo').textContent = `Grabando… ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; if (s >= 15 * 60) stopRecording(false) }, 500);
};

window.__app = { app, sb, parseSong, render };
