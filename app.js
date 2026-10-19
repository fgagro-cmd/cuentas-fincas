'use strict';
/* Cuentas fincas — cuenta de resultados y presupuestos de mis fincas, en el móvil y en el ordenador.
   Lee las líneas de la «Tabla principal» de la hoja de Gestión fincas (su mismo script) y guarda allí
   los presupuestos y parámetros. Guarda una copia en el aparato para verla sin conexión.
   El código no lleva datos: todo llega de tu hoja de Google. */

const APP_VERSION = '1.0.1';

/* ---------- Utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (n, min = 0, max = 0) => Number(n).toLocaleString('es-ES', { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: 'always' });
const eur = (n) => nf(n, 2, 2) + ' €';
const eur0 = (n) => nf(n, 0, 0) + ' €';
const ok = (n) => n !== null && n !== undefined && isFinite(n);
function parseNum(s) {
  s = String(s ?? '').trim().replace(/\s/g, '').replace(/€/g, '');
  if (!s) return NaN;
  const c = s.lastIndexOf(','), d = s.lastIndexOf('.');
  if (c > -1 && d > -1) s = c > d ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (c > -1) s = s.replace(',', '.');
  return /^-?(\d+\.?\d*|\.\d+)$/.test(s) ? parseFloat(s) : NaN;
}
const fmtIn = (n) => (ok(n) ? String(Math.round(n * 10000) / 10000).replace('.', ',') : '');
const fmtDate = (iso) => String(iso).slice(8, 10) + '/' + String(iso).slice(5, 7) + '/' + String(iso).slice(0, 4);
function ago(iso) {
  if (!iso) return 'nunca';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  if (min < 1440) return `hace ${Math.round(min / 60)} h`;
  return new Date(iso).toLocaleDateString('es-ES');
}
/* Formato de una cifra según su tipo de fila. */
function fmtV(v, tipo) {
  if (!ok(v)) return '—';
  switch (tipo) {
    case 'kg': return nf(v, 0, 0);
    case 'eurkg': return nf(v, 2, 2);
    case 'kgha': return nf(v, 0, 0);
    case 'kgpie': return nf(v, 1, 1);
    case 'eurpie': return nf(v, 2, 2);
    case 'pct': return nf(v * 100, 1, 1) + ' %';
    default: return eur0(v);
  }
}

/* ---------- Almacenamiento en el aparato (IndexedDB) ---------- */
let dbp;
function idb() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('cuentas-fincas', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function dbGet(k) { const db = await idb(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
async function dbSet(k, v) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
const save = (k, v) => dbSet(k, v).catch((e) => toast('No se pudo guardar en este aparato: ' + (e && e.message || e), true));

/* ---------- Estado ---------- */
let conn = { url: '', clave: '' };
let datos = null;                       // lo último leído de la hoja
let pend = { cambios: [], param: null }; // cambios hechos aquí y aún no guardados en la hoja
let net = { running: false, lastError: '' };
const ui = { tab: 'resultados', camp: null, finca: '__all', modo: 'real', pcamp: null, pfinca: null };

/* Derivados de los datos */
let LINEAS = [], FINCAS = [], PRES = {}, PARAM = { moEurH: 8, reglas: {} }, CAMPS = [];
let memo = new Map();
function build() {
  memo = new Map();
  const d = datos || { tabla: [], fincas: [], presupuestos: [], parametros: {} };
  LINEAS = (d.tabla || []).map((r) => ({ fecha: r[0], desc: r[1], campana: Number(r[2]), categoria: r[3], tipo: r[4], tipo2: r[5] || '', finca: r[6], cantidad: Number(r[7]) || 0, precio: Number(r[8]) || 0, importe: Number(r[9]) || 0 }));
  // Fincas: las propias del maestro (con superficie y árboles) y cualquier otra que aparezca en las líneas
  const fs = (d.fincas || []).map((f) => ({ id: f.id, nombre: f.nombre, ha: ok(f.ha) ? f.ha : null, arboles: ok(f.arboles) ? f.arboles : null }));
  const nombres = new Set(fs.map((f) => f.nombre));
  for (const l of LINEAS) if (!nombres.has(l.finca)) { nombres.add(l.finca); fs.push({ id: l.finca, nombre: l.finca, ha: null, arboles: null }); }
  FINCAS = fs.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  // Presupuestos guardados + cambios pendientes de aquí
  PRES = {};
  for (const p of d.presupuestos || []) if (ok(p.valor)) (PRES[p.campana + '|' + p.fincaId] ||= {})[p.concepto] = p.valor;
  for (const c of pend.cambios) {
    const o = (PRES[c.campana + '|' + c.fincaId] ||= {});
    if (c.valor === null) delete o[c.concepto]; else o[c.concepto] = c.valor;
  }
  // Parámetros
  const prm = pend.param ? Object.fromEntries(pend.param.map((x) => [x.clave, x.valor])) : (d.parametros || {});
  PARAM = { moEurH: ok(Number(prm.mo_eur_h)) && prm.mo_eur_h !== '' ? Number(prm.mo_eur_h) : 8, reglas: {} };
  for (const f of FINCAS) PARAM.reglas[f.id] = { pct: Number(prm['arr_pct.' + f.id]) || 0, base: prm['arr_base.' + f.id] || 'ninguno' };
  // Campañas: las que tienen líneas o presupuesto, y la siguiente para poder presupuestarla
  const cs = new Set(LINEAS.map((l) => l.campana));
  for (const k of Object.keys(PRES)) cs.add(Number(k.split('|')[0]));
  const lista = [...cs].filter(ok).sort((a, b) => b - a);
  if (lista.length) lista.unshift(lista[0] + 1); else lista.push(new Date().getFullYear());
  CAMPS = lista;
  const conLineas = [...new Set(LINEAS.map((l) => l.campana))].sort((a, b) => b - a);
  if (!ui.camp || !CAMPS.includes(ui.camp)) ui.camp = conLineas[0] || CAMPS[0];
  if (!ui.pcamp || !CAMPS.includes(ui.pcamp)) ui.pcamp = ui.camp;
  if (ui.finca !== '__all' && !FINCAS.some((f) => f.id === ui.finca)) ui.finca = '__all';
  if (!ui.pfinca || !FINCAS.some((f) => f.id === ui.pfinca)) ui.pfinca = FINCAS[0] ? FINCAS[0].id : null;
}
const fincaById = (id) => FINCAS.find((f) => f.id === id);
const nombreFinca = (id) => (id === '__all' ? 'Explotación completa' : (fincaById(id)?.nombre ?? id));
const sumOk = (xs) => { const v = xs.filter(ok); return v.length ? v.reduce((t, x) => t + x, 0) : null; };
function pf(id) {
  if (id === '__all') return { moEurH: PARAM.moEurH, ha: sumOk(FINCAS.map((f) => f.ha)), arboles: sumOk(FINCAS.map((f) => f.arboles)) };
  const f = fincaById(id) || {};
  return { moEurH: PARAM.moEurH, ha: f.ha, arboles: f.arboles };
}
function realDe(camp, id) {
  const k = 'r|' + camp + '|' + id;
  if (!memo.has(k)) {
    const x = CU.real(LINEAS, camp, id === '__all' ? null : nombreFinca(id), pf(id));
    memo.set(k, x.n ? x : null);
  }
  return memo.get(k);
}
function presDe(camp, id) {
  const k = 'p|' + camp + '|' + id;
  if (!memo.has(k)) {
    let x;
    if (id === '__all') x = CU.sumar(FINCAS.map((f) => presDe(camp, f.id)), pf(id).ha, pf(id).arboles);
    else x = CU.presupuesto(PRES[camp + '|' + id], pf(id), PARAM.reglas[id]);
    memo.set(k, x);
  }
  return memo.get(k);
}

/* ---------- Conexión con la hoja de Gestión fincas ---------- */
async function postScript(url, clave, accion, extra = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 180000);
  try {
    // Sin cabeceras propias: así es una petición simple (text/plain) y Google no exige comprobación previa.
    const res = await fetch(url, { method: 'POST', body: JSON.stringify({ accion, clave, ...extra }), signal: ctrl.signal });
    const txt = await res.text();
    try { return JSON.parse(txt); } catch (_) { throw new Error('La dirección no responde como el script (revisa que esté publicado para «Cualquier usuario»)'); }
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('Tiempo de espera agotado');
    if (e instanceof TypeError) throw new Error('Sin conexión con Google');
    throw e;
  } finally { clearTimeout(t); }
}
const callScript = (accion, extra) => postScript(conn.url, conn.clave, accion, extra);
const errScript = (r, def) => (r.error === 'clave' ? 'La clave no coincide con la del script' : r.error === 'accion desconocida' ? 'El script de la hoja de Gestión fincas es antiguo: pega el nuevo (pasos en el README)' : (r.error || def));
const connOn = () => !!(conn.url && conn.clave);
let syncTimer = null;
function pendingCount() { return pend.cambios.length + (pend.param ? 1 : 0); }
function scheduleSync() { clearTimeout(syncTimer); syncTimer = setTimeout(() => refresh({}), 1500); }

async function refresh({ manual = false, auto = false } = {}) {
  if (!connOn() || net.running) return;
  if (!navigator.onLine) { renderStatus(); if (manual) toast('Sin conexión: verás los datos guardados en este aparato', true); return; }
  if (auto && !pendingCount() && datos && datos.lastFetch && Date.now() - new Date(datos.lastFetch).getTime() < 5 * 60000) return;
  net.running = true; renderStatus();
  try {
    if (pend.cambios.length) {
      const enviados = pend.cambios.slice();
      const r = await callScript('guardarPresupuesto', { cambios: enviados });
      if (!r.ok) throw new Error(errScript(r, 'No se pudo guardar el presupuesto'));
      const sent = new Set(enviados.map((c) => c.campana + '|' + c.fincaId + '|' + c.concepto + '|' + c.ts));
      pend.cambios = pend.cambios.filter((c) => !sent.has(c.campana + '|' + c.fincaId + '|' + c.concepto + '|' + c.ts));
      save('pend', pend);
    }
    if (pend.param) {
      const r = await callScript('guardarParametros', { parametros: pend.param });
      if (!r.ok) throw new Error(errScript(r, 'No se pudieron guardar los parámetros'));
      pend.param = null; save('pend', pend);
    }
    const r = await callScript('cuentas');
    if (!r.ok) throw new Error(errScript(r, 'No se pudieron leer los datos'));
    datos = { tabla: r.tabla || [], fincas: r.fincas || [], avisoFincas: r.avisoFincas || '', presupuestos: r.presupuestos || [], parametros: r.parametros || {}, fecha: r.fecha || '', lastFetch: new Date().toISOString() };
    save('datos', datos);
    net.lastError = '';
    build();
    if (manual) toast(`Datos al día: ${LINEAS.length} líneas`);
  } catch (e) {
    net.lastError = e.message || String(e);
    if (manual) toast(net.lastError, true);
  } finally {
    net.running = false;
    renderAll();
  }
}
function statusText() {
  if (!connOn()) return '';
  const p = pendingCount();
  const pTxt = p ? ` · ${p} ${p === 1 ? 'cambio' : 'cambios'} sin guardar en la hoja` : '';
  if (net.running) return '☁ Leyendo tu hoja de Google…';
  if (net.lastError) return '☁ ' + net.lastError + pTxt;
  if (!datos) return '☁ Todavía sin datos' + pTxt;
  return `☁ Datos ${ago(datos.lastFetch)}${navigator.onLine ? '' : ' · sin conexión'}${pTxt}`;
}
function renderStatus() {
  const el = $('#syncStatus'); if (el) { el.hidden = !connOn(); el.textContent = statusText(); }
  const l = $('#connLine'); if (l) l.textContent = statusText();
}

/* ---------- Interfaz común ---------- */
let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, err ? 4200 : 2200);
}
const sheetRoot = $('#sheetRoot');
let sheetOpen = false;
function openSheet(title, bodyHTML) {
  if (!sheetOpen) history.pushState({ sheet: true }, '');
  sheetOpen = true;
  sheetRoot.innerHTML = `<div class="scrim"></div><section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><h2>${esc(title)}</h2><button class="x" aria-label="Cerrar">✕</button></header><div class="sheet-body">${bodyHTML}</div></section>`;
  $('.scrim', sheetRoot).onclick = closeSheet;
  $('.x', sheetRoot).onclick = closeSheet;
  return $('.sheet-body', sheetRoot);
}
function closeSheet() {
  if (!sheetOpen) return;
  sheetOpen = false; sheetRoot.innerHTML = '';
  if (history.state && history.state.sheet) history.back();
}
window.addEventListener('popstate', () => { if (sheetOpen) { sheetOpen = false; sheetRoot.innerHTML = ''; } });
const reopen = (fn) => { closeSheet(); setTimeout(fn, 40); };

const campOpts = (sel, lista = CAMPS) => lista.map((c) => `<option value="${c}" ${c === sel ? 'selected' : ''}>${c}</option>`).join('');
const fincaOpts = (sel, conTodas) => (conTodas ? `<option value="__all" ${sel === '__all' ? 'selected' : ''}>Explotación completa</option>` : '') + FINCAS.map((f) => `<option value="${esc(f.id)}" ${sel === f.id ? 'selected' : ''}>${esc(f.nombre)}</option>`).join('');
const DRILL = new Set(Object.keys(CU.FILTRO));

/* Encabezado con las cifras clave de la pestaña */
function kpis(x, sub) {
  if (!x) return `<div class="kpis"><div class="k hero"><span>${esc(sub)}</span><strong>—</strong></div></div>`;
  return `<div class="kpis">
    <div class="k hero"><span>Resultado ${esc(sub)}</span><strong class="${x.resultado < 0 ? 'neg' : ''}">${eur0(x.resultado)}</strong></div>
    <div class="k"><span>Ingresos</span><strong>${eur0(x.ingresos)}</strong></div>
    <div class="k"><span>Gastos</span><strong>${eur0(x.gastos)}</strong></div>
    <div class="k"><span>Margen</span><strong class="${ok(x.margen) && x.margen < 0 ? 'neg' : ''}">${ok(x.margen) ? nf(x.margen * 100, 1, 1) + ' %' : '—'}</strong></div>
  </div>`;
}

function avisoSinDatos() {
  if (!connOn()) return `<div class="notice"><b>Conecta la app con tu hoja de Gestión fincas</b><p class="small">Usa la misma dirección y clave de la copia automática de Gestión fincas. Los datos se guardan en este aparato y se ven sin conexión.</p><button class="btn primary" id="goAj">Abrir Ajustes</button></div>`;
  if (!datos) return `<div class="notice"><b>Leyendo tu hoja…</b><p class="small">${esc(net.lastError || 'La primera lectura puede tardar unos segundos.')}</p><button class="btn" id="goRf">Leer ahora</button></div>`;
  if (!LINEAS.length) return `<div class="notice"><b>La Tabla principal está vacía</b><p class="small">Carga el histórico del Excel en Gestión fincas (Ajustes → «Cargar histórico del Excel») y espera a que se copie a la hoja.</p><button class="btn" id="goRf">Leer otra vez</button></div>`;
  return '';
}
function bindAviso() {
  const a = $('#goAj'); if (a) a.onclick = openSettings;
  const r = $('#goRf'); if (r) r.onclick = () => refresh({ manual: true });
}

/* ---------- Pestaña: Resultados (como la pestaña del Excel) ---------- */
function celda(v, tipo, cls, drill) {
  const neg = ok(v) && v < 0 ? ' neg' : '';
  const txt = fmtV(v, tipo);
  if (drill && ok(v)) return `<td class="${cls}${neg}"><button class="cell" data-c="${drill.c}" data-k="${drill.k}" data-f="${esc(drill.f)}">${txt}</button></td>`;
  return `<td class="${cls}${neg}">${txt}</td>`;
}
function renderResultados() {
  const c = ui.camp, id = ui.finca;
  const cols = [
    { h: c - 2, s: 'real', x: realDe(c - 2, id), camp: c - 2 },
    { h: c - 1, s: 'real', x: realDe(c - 1, id), camp: c - 1 },
    { h: 'Presupuesto', sub: c, s: 'pres', x: presDe(c, id) },
    { h: 'Real', sub: c, s: 'real', x: realDe(c, id), camp: c, cls: 'real' },
  ];
  const aviso = avisoSinDatos();
  const r = cols[3].x;
  const ult = LINEAS.filter((l) => l.campana === c && (id === '__all' || l.finca === nombreFinca(id))).map((l) => l.fecha).sort().pop();
  let body = '';
  for (const s of CU.SECCIONES) {
    body += `<tr class="sec"><td colspan="6"><span class="st">${esc(s.titulo)}</span></td></tr>`;
    for (const f of s.filas) {
      const vals = cols.map((col) => (col.x ? col.x[f.k] : null));
      const v = CU.variacion(vals[0], vals[1], vals[3]);
      body += `<tr class="${f.total ? 'tot' : ''}"><td class="lbl">${esc(f.label)}${f.nota ? `<small>${esc(f.nota)}</small>` : ''}</td>`
        + cols.map((col, i) => celda(vals[i], f.tipo, (col.s === 'pres' ? 'pres' : '') + (col.cls ? ' ' + col.cls : ''), col.s === 'real' && DRILL.has(f.k) ? { c: col.camp, k: f.k, f: id } : null)).join('')
        + `<td class="var">${ok(v) ? nf(v * 100, 1, 1) + ' %' : ''}</td></tr>`;
    }
  }
  $('#view').innerHTML = `
    <div class="sel">
      <select id="rCamp" aria-label="Campaña">${campOpts(c)}</select>
      <select id="rFinca" aria-label="Finca">${fincaOpts(id, true)}</select>
    </div>
    ${aviso}
    <p class="meta">${r ? `Real ${c}: ${nf(r.n)} líneas${ult ? ` · la última del ${fmtDate(ult)}` : ''}` : `Sin líneas en la campaña ${c}`}${cols[2].x ? '' : ` · sin presupuesto ${c}`}</p>
    <div class="tbl-wrap"><table class="cr">
      <thead><tr><th class="lbl">${esc(nombreFinca(id))}</th><th>${c - 2}<small>real</small></th><th>${c - 1}<small>real</small></th><th class="pres">Presup.<small>${c}</small></th><th>Real<small>${c}</small></th><th>% var.<small>vs media</small></th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>
    <p class="legend">Toca una cifra subrayada para ver las líneas que la forman. % var. = 1 − media de las dos campañas anteriores ÷ real (como en tu Excel). Mano de obra propia a ${nf(PARAM.moEurH, 0, 2)} €/h.</p>`;
  $('#rCamp').onchange = (e) => { ui.camp = Number(e.target.value); saveUi(); renderAll(); };
  $('#rFinca').onchange = (e) => { ui.finca = e.target.value; saveUi(); renderAll(); };
  $('#view .tbl-wrap').onclick = onDrill;
  bindAviso();
}
function headResultados() { return kpis(realDe(ui.camp, ui.finca), `real ${ui.camp}`) + presLine(presDe(ui.camp, ui.finca), ui.camp); }
function presLine(p, c) { return p ? `<p class="sync" style="opacity:.85">Presupuesto ${c}: resultado ${eur0(p.resultado)} · ingresos ${eur0(p.ingresos)} · gastos ${eur0(p.gastos)}</p>` : ''; }

/* Detalle de una cifra: las líneas de la Tabla principal que la forman */
function onDrill(e) {
  const b = e.target.closest('button.cell'); if (!b) return;
  const camp = Number(b.dataset.c), k = b.dataset.k, id = b.dataset.f;
  const fila = CU.FILAS.find((f) => f.k === k);
  const ls = CU.lineasConcepto(LINEAS, camp, id === '__all' ? null : nombreFinca(id), k).sort((a, b2) => b2.fecha.localeCompare(a.fecha));
  const esKg = k === 'kg';
  const tot = ls.reduce((t, l) => t + (esKg ? l.cantidad : l.importe), 0);
  const horas = k === 'mo_propia' || k === 'amortizacion' ? ls.reduce((t, l) => t + l.cantidad, 0) : null;
  const max = 400;
  const body = openSheet(`${fila ? fila.label : k} · ${camp}`, `
    <div class="box">
      <div><span>${esc(nombreFinca(id))}</span><b>${ls.length} líneas</b></div>
      <div><span>${esKg ? 'Kilos' : 'Importe de las líneas'}</span><b>${esKg ? nf(tot, 0, 0) + ' kg' : eur(tot)}</b></div>
      ${horas !== null ? `<div><span>Horas propias (con y sin maquinaria)</span><b>${nf(horas, 0, 2)} h × ${nf(PARAM.moEurH, 0, 2)} € = ${eur(horas * PARAM.moEurH)}</b></div>` : ''}
    </div>
    ${k === 'amortizacion' ? '<p class="hint">Amortización = importe de las tareas propias − mano de obra propia (horas × €/h).</p>' : ''}
    ${k === 'precio' ? '<p class="hint">Precio medio = importe de la cosecha ÷ kilos.</p>' : ''}
    <ul class="list lines">${ls.slice(0, max).map((l) => `<li><div class="row"><div class="main"><div class="name">${esc(l.desc)}</div><div class="sub">${fmtDate(l.fecha)} · ${esc(l.finca)} · ${esc(l.tipo)}${l.tipo2 ? ' · ' + esc(l.tipo2) : ''}</div></div><div class="side"><div class="big">${esKg ? nf(l.cantidad, 0, 0) + ' kg' : eur(l.importe)}</div><div class="sub">${nf(l.cantidad, 0, 3)} × ${nf(l.precio, 2, 4)}</div></div></div></li>`).join('')}</ul>
    ${ls.length > max ? `<p class="small">Se muestran las ${max} más recientes de ${ls.length}.</p>` : ''}`);
  void body;
}

/* ---------- Pestaña: Fincas (comparar en una campaña) ---------- */
function renderFincas() {
  const c = ui.camp, modo = ui.modo;
  const ids = [...FINCAS.map((f) => f.id), '__all'];
  const xs = ids.map((id) => (modo === 'real' ? realDe(c, id) : presDe(c, id)));
  let body = '';
  for (const s of CU.SECCIONES) {
    body += `<tr class="sec"><td colspan="${ids.length + 1}"><span class="st">${esc(s.titulo)}</span></td></tr>`;
    for (const f of s.filas) {
      body += `<tr class="${f.total ? 'tot' : ''}"><td class="lbl">${esc(f.label)}</td>`
        + ids.map((id, i) => celda(xs[i] ? xs[i][f.k] : null, f.tipo, id === '__all' ? 'real' : '', modo === 'real' && DRILL.has(f.k) ? { c, k: f.k, f: id } : null)).join('') + '</tr>';
    }
  }
  $('#view').innerHTML = `
    <div class="sel">
      <select id="fCamp" aria-label="Campaña">${campOpts(c)}</select>
      <div class="seg" id="fModo" style="margin:0"><button data-m="real" aria-pressed="${modo === 'real'}">Real</button><button data-m="pres" aria-pressed="${modo === 'pres'}">Presupuesto</button></div>
    </div>
    ${avisoSinDatos()}
    <div class="tbl-wrap"><table class="cr">
      <thead><tr><th class="lbl">${modo === 'real' ? 'Real' : 'Presupuesto'} ${c}</th>${ids.map((id) => `<th>${esc(id === '__all' ? 'Explotación' : nombreFinca(id))}</th>`).join('')}</tr></thead>
      <tbody>${body}</tbody>
    </table></div>
    <p class="legend">${modo === 'real' ? 'Toca una cifra subrayada para ver sus líneas.' : 'Las fincas sin presupuesto salen con «—» y no suman en la explotación.'}</p>`;
  $('#fCamp').onchange = (e) => { ui.camp = Number(e.target.value); saveUi(); renderAll(); };
  $('#fModo').onclick = (e) => { const b = e.target.closest('[data-m]'); if (b) { ui.modo = b.dataset.m; saveUi(); renderAll(); } };
  $('#view .tbl-wrap').onclick = onDrill;
  bindAviso();
}
function headFincas() { return ui.modo === 'real' ? kpis(realDe(ui.camp, '__all'), `real ${ui.camp} · explotación`) : kpis(presDe(ui.camp, '__all'), `presupuesto ${ui.camp} · explotación`); }

/* ---------- Pestaña: Presupuesto (por finca y campaña) ---------- */
function renderPresupuesto() {
  const c = ui.pcamp, id = ui.pfinca;
  if (!id) { $('#view').innerHTML = avisoSinDatos() || '<div class="empty">No hay fincas.</div>'; bindAviso(); return; }
  const b = PRES[c + '|' + id] || {};
  const prevReal = realDe(c - 1, id), prevPres = presDe(c - 1, id);
  const regla = PARAM.reglas[id] || { pct: 0, base: 'ninguno' };
  const x = CU.presupuesto(Object.keys(b).length ? b : { kg: 0 }, pf(id), regla);
  const ref = (k) => {
    const partes = [];
    if (prevReal && ok(prevReal[k])) partes.push(`real ${c - 1}: ${fmtV(prevReal[k], k === 'kg' ? 'kg' : k === 'precio' ? 'eurkg' : '')}`);
    if (prevPres && ok(prevPres[k]) && b !== null) partes.push(`presup. ${c - 1}: ${fmtV(prevPres[k], k === 'kg' ? 'kg' : k === 'precio' ? 'eurkg' : '')}`);
    return partes.join(' · ');
  };
  const reglaTxt = regla.pct > 0 && CU.BASES[regla.base] ? `${nf(regla.pct, 0, 2)} ${CU.BASES[regla.base].label}` : 'sin arrendamiento';
  const filas = CU.ENTRADAS.filter((e) => e.k !== 'arrendamiento').map((e) => `
    <label class="pfila"><span class="t">${esc(e.label)}<small>${esc(ref(e.k)) || '&nbsp;'}</small></span>
      <input type="text" inputmode="decimal" data-k="${e.k}" value="${esc(fmtIn(b[e.k]))}" placeholder="0" autocomplete="off"></label>`).join('');
  const manual = ok(b.arrendamiento);
  $('#view').innerHTML = `
    <div class="sel">
      <select id="pCamp" aria-label="Campaña">${campOpts(c)}</select>
      <select id="pFinca" aria-label="Finca">${fincaOpts(id, false)}</select>
    </div>
    ${avisoSinDatos()}
    <p class="meta">Se guarda solo al cambiar cada cifra, en tu hoja de Google: lo verás en todos tus aparatos.</p>
    <div class="actions two" style="margin:0 0 10px">
      <button class="btn" id="pFillReal" ${prevReal ? '' : 'disabled'}>Rellenar con lo real ${c - 1}</button>
      <button class="btn" id="pFillPres" ${prevPres ? '' : 'disabled'}>Copiar presupuesto ${c - 1}</button>
    </div>
    <div class="pform">${filas}
      <label class="pfila arr"><span class="t">Arrendamiento<small>Estimado: <span id="pArrEstV">${eur0(x.arrendamiento_estimado)}</span> (${esc(reglaTxt)})${manual ? ' · escrito a mano · <button type="button" class="linkbtn" id="pArrEst">usar el estimado</button>' : ''}</small></span>
        <input type="text" inputmode="decimal" data-k="arrendamiento" value="${esc(fmtIn(b.arrendamiento))}" placeholder="${esc(fmtIn(Math.round(x.arrendamiento_estimado)))}" autocomplete="off"></label>
    </div>
    <div class="psum"><div class="box" style="margin:0" id="pSum"></div></div>`;
  drawPSum();
  $('#pCamp').onchange = (e) => { ui.pcamp = Number(e.target.value); saveUi(); renderAll(); };
  $('#pFinca').onchange = (e) => { ui.pfinca = e.target.value; saveUi(); renderAll(); };
  $('#view .pform').addEventListener('change', (e) => {
    const inp = e.target.closest('input[data-k]'); if (!inp) return;
    const raw = inp.value.trim();
    const v = raw === '' ? null : parseNum(raw);
    if (raw !== '' && !ok(v)) { toast('Escribe un número (por ejemplo 1.250,50)', true); inp.value = fmtIn(b[inp.dataset.k]); return; }
    setPres(c, id, { [inp.dataset.k]: v }, false); // sin redibujar: no se pierde la casilla en la que estás
    $('#head').innerHTML = headPresupuesto(); drawPSum();
    toast('Guardado');
  });
  $('#view .pform').addEventListener('input', drawPSum);
  const est = $('#pArrEst'); if (est) est.onclick = (e) => { e.preventDefault(); setPres(c, id, { arrendamiento: null }); toast('Arrendamiento estimado con la regla'); };
  $('#pFillReal').onclick = () => fillFrom(c, id, prevReal, 'lo real');
  $('#pFillPres').onclick = () => fillFrom(c, id, prevPres, 'el presupuesto');
  bindAviso();
}
/* Resumen en vivo con lo que hay escrito en el formulario */
function drawPSum() {
  const box = $('#pSum'); if (!box) return;
  const b = {};
  document.querySelectorAll('.pform input[data-k]').forEach((i) => { const v = parseNum(i.value); if (ok(v)) b[i.dataset.k] = v; });
  const x = CU.presupuesto(Object.keys(b).length ? b : { kg: 0 }, pf(ui.pfinca), PARAM.reglas[ui.pfinca]);
  const est = $('#pArrEstV'); if (est) est.textContent = eur0(x.arrendamiento_estimado);
  const ia = $('.pform input[data-k="arrendamiento"]'); if (ia) ia.placeholder = fmtIn(Math.round(x.arrendamiento_estimado));
  box.innerHTML = `<div><span>Ingresos</span><b>${eur0(x.ingresos)}</b></div><div><span>Gastos</span><b>${eur0(x.gastos)}</b></div>
    <div><span><b>Resultado</b></span><b class="${x.resultado < 0 ? 'neg' : ''}">${eur0(x.resultado)}${ok(x.margen) ? ` · ${nf(x.margen * 100, 1, 1)} %` : ''}</b></div>`;
}
const DESC = Object.fromEntries(CU.ENTRADAS.map((e) => [e.k, e.label]));
function setPres(camp, id, valores, redibujar = true) {
  const ts = new Date().toISOString();
  const actual = PRES[camp + '|' + id] || {};
  for (const [k, v] of Object.entries(valores)) {
    if ((v === null && !ok(actual[k])) || (ok(v) && actual[k] === v)) continue;
    pend.cambios = pend.cambios.filter((x) => !(x.campana === camp && x.fincaId === id && x.concepto === k));
    pend.cambios.push({ campana: camp, fincaId: id, finca: nombreFinca(id), concepto: k, descripcion: DESC[k] || k, valor: v, ts });
  }
  save('pend', pend); build(); if (redibujar) renderAll(); else renderStatus(); scheduleSync();
}
function fillFrom(camp, id, x, que) {
  if (!x) return;
  const actual = PRES[camp + '|' + id] || {};
  const vals = {};
  for (const e of CU.ENTRADAS) {
    if (e.k === 'arrendamiento' || ok(actual[e.k])) continue; // solo rellena lo que está vacío
    let v = x[e.k];
    if (e.k === 'precio') v = ok(x.precio) ? Math.round(x.precio * 1000) / 1000 : null;
    else if (ok(v)) v = Math.round(v);
    if (ok(v)) vals[e.k] = v;
  }
  if (!Object.keys(vals).length) return toast('No hay casillas vacías que rellenar');
  setPres(camp, id, vals);
  toast(`Rellenadas ${Object.keys(vals).length} casillas con ${que} de ${camp - 1}`);
}
function headPresupuesto() { return ui.pfinca ? kpis(presDe(ui.pcamp, ui.pfinca), `presupuesto ${ui.pcamp} · ${nombreFinca(ui.pfinca)}`) : ''; }

/* ---------- Ajustes ---------- */
function openSettings() {
  const body = openSheet('Ajustes', `
    <h3 style="margin-top:4px">Hoja de Gestión fincas</h3>
    <div id="connBox"></div>
    <div class="sep"></div>
    <h3>Parámetros</h3>
    <div id="paramBox"></div>
    <div class="sep"></div>
    <h3>Fincas</h3>
    <div id="fincaBox"></div>
    <div class="sep"></div>
    <p class="small">Cuentas fincas v${APP_VERSION}. La app no lleva datos dentro: todo llega de tu hoja de Google y se guarda una copia en este aparato.</p>`);
  drawConn($('#connBox', body));
  drawParam($('#paramBox', body));
  drawFincas($('#fincaBox', body));
}
function drawConn(box) {
  if (connOn()) {
    box.innerHTML = `
      <p class="small" id="connLine">${esc(statusText())}</p>
      <p class="small">Lee la Tabla principal (${nf(LINEAS.length)} líneas) y guarda los presupuestos en las pestañas «Presupuestos» y «Parámetros» de esa misma hoja.</p>
      <div class="actions"><button class="btn primary" id="cNow">Actualizar ahora</button><button class="btn danger" id="cOff">Desconectar</button></div>`;
    $('#cNow', box).onclick = () => refresh({ manual: true });
    $('#cOff', box).onclick = () => {
      if (pendingCount() && !confirm('Hay cambios sin guardar en la hoja. Si desconectas se quedan en este aparato hasta que vuelvas a conectar. ¿Desconectar?')) return;
      conn = { url: '', clave: '' }; save('conn', conn); renderAll(); drawConn(box); toast('Desconectada (los datos guardados se mantienen)');
    };
  } else {
    box.innerHTML = `
      <p class="small">Pega la dirección y la clave del script de la hoja de Gestión fincas: son las mismas que usa la copia automática de esa app.</p>
      <label class="fld"><span>Dirección del script (termina en /exec)</span><input id="cU" type="url" value="${esc(conn.url)}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"></label>
      <label class="fld"><span>Clave</span><input id="cK" type="password" value="${esc(conn.clave)}" autocomplete="off"></label>
      <div class="actions"><button class="btn primary" id="cOn">Probar y conectar</button></div>`;
    $('#cOn', box).onclick = async () => {
      const url = $('#cU', box).value.trim(), clave = $('#cK', box).value.trim();
      if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/\s]+\/exec\/?$/.test(url)) return toast('La dirección debe ser la de la aplicación web del script y terminar en /exec', true);
      if (!clave) return toast('Escribe la clave', true);
      try {
        const r = await postScript(url, clave, 'ping');
        if (!r.ok) throw new Error(errScript(r, 'El script no responde'));
        conn = { url, clave }; save('conn', conn);
        toast('Conectada. Leyendo tus datos…'); drawConn(box);
        await refresh({ manual: true });
        drawConn(box); drawParam($('#paramBox')); drawFincas($('#fincaBox'));
      } catch (e) { toast(e.message || 'No se pudo conectar', true); }
    };
  }
}
function drawParam(box) {
  if (!box) return;
  if (!FINCAS.length) { box.innerHTML = '<p class="small">Aparecerán al leer tus datos.</p>'; return; }
  const bases = Object.entries(CU.BASES);
  box.innerHTML = `
    <label class="fld"><span>Mano de obra propia (€/h)</span><input id="pMo" type="text" inputmode="decimal" value="${esc(fmtIn(PARAM.moEurH))}"></label>
    <p class="hint">Las horas propias (tareas con y sin maquinaria) se valoran a este precio; lo que pagas de más por esas horas cuenta como maquinaria.</p>
    <p class="small" style="margin:0 0 8px"><b>Arrendamiento estimado en los presupuestos</b> (en cada presupuesto puedes escribir la cifra a mano)</p>
    ${FINCAS.map((f) => { const r = PARAM.reglas[f.id] || { pct: 0, base: 'ninguno' }; return `
      <div class="box"><div><span><b>${esc(f.nombre)}</b></span><span></span></div>
        <div class="grid2" style="display:grid;margin-top:6px">
          <label class="fld" style="margin:0"><span>%</span><input type="text" inputmode="decimal" data-pct="${esc(f.id)}" value="${esc(fmtIn(r.pct))}"></label>
          <label class="fld" style="margin:0"><span>Base</span><select data-base="${esc(f.id)}">${bases.map(([k, b]) => `<option value="${k}" ${r.base === k ? 'selected' : ''}>${esc(b.label.replace('% de ', ''))}</option>`).join('')}</select></label>
        </div></div>`; }).join('')}
    <div class="actions"><button class="btn primary" id="pSave">Guardar parámetros</button></div>`;
  $('#pSave', box).onclick = () => {
    const mo = parseNum($('#pMo', box).value);
    if (!(mo >= 0)) return toast('Revisa el precio de la mano de obra', true);
    const rows = [{ clave: 'mo_eur_h', valor: mo, descripcion: 'Mano de obra propia (€/h)' }];
    for (const f of FINCAS) {
      const pct = parseNum(box.querySelector(`[data-pct="${CSS.escape(f.id)}"]`).value || '0');
      if (!(pct >= 0 && pct <= 100)) return toast(`Revisa el % de ${f.nombre}`, true);
      const base = box.querySelector(`[data-base="${CSS.escape(f.id)}"]`).value;
      rows.push({ clave: 'arr_pct.' + f.id, valor: pct, descripcion: `${f.nombre} · arrendamiento (%)` });
      rows.push({ clave: 'arr_base.' + f.id, valor: pct > 0 ? base : 'ninguno', descripcion: `${f.nombre} · base del arrendamiento` });
    }
    pend.param = rows; save('pend', pend); build(); renderAll(); scheduleSync(); toast('Parámetros guardados');
  };
}
function drawFincas(box) {
  if (!box) return;
  const aviso = datos && datos.avisoFincas ? `<p class="hint warn">${esc(datos.avisoFincas)}</p>` : '';
  box.innerHTML = `${aviso}<div class="box">${FINCAS.map((f) => `<div><span>${esc(f.nombre)}</span><b>${ok(f.ha) ? nf(f.ha, 0, 2) + ' ha' : '— ha'} · ${ok(f.arboles) ? nf(f.arboles) + ' árboles' : '— árboles'}</b></div>`).join('') || '<div><span>Sin fincas todavía</span></div>'}</div>
    <p class="hint">Superficie y árboles salen del Maestro de fincas (Drive › Apps › Maestros). Para cambiarlos, cámbialos allí y pulsa «Actualizar ahora».</p>`;
}

/* ---------- Render general ---------- */
const TABS = {
  resultados: { title: 'Cuenta de resultados', head: headResultados, render: renderResultados },
  fincas: { title: 'Comparar fincas', head: headFincas, render: renderFincas },
  presupuesto: { title: 'Presupuesto', head: headPresupuesto, render: renderPresupuesto },
};
function renderAll() {
  const t = TABS[ui.tab];
  $('#topTitle').textContent = t.title;
  $('#head').innerHTML = datos ? t.head() : '';
  document.querySelectorAll('.tab').forEach((b) => { if (b.dataset.tab === ui.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  renderStatus();
  t.render();
}
function saveUi() { save('ui', { tab: ui.tab, camp: ui.camp, finca: ui.finca, modo: ui.modo, pcamp: ui.pcamp, pfinca: ui.pfinca }); }

async function init() {
  document.querySelectorAll('.tab').forEach((b) => b.onclick = () => { ui.tab = b.dataset.tab; saveUi(); window.scrollTo(0, 0); renderAll(); });
  $('#btnSettings').onclick = openSettings;
  $('#syncStatus').onclick = openSettings;
  try {
    const [c, d, p, u] = await Promise.all([dbGet('conn'), dbGet('datos'), dbGet('pend'), dbGet('ui')]);
    if (c) conn = { ...conn, ...c };
    if (d) datos = d;
    if (p) pend = { cambios: Array.isArray(p.cambios) ? p.cambios : [], param: p.param || null };
    if (u) Object.assign(ui, u);
  } catch (_) { toast('Este navegador no deja guardar datos: no funcionará sin conexión', true); }
  build();
  renderAll();
  window.addEventListener('online', () => refresh({ auto: true }));
  window.addEventListener('offline', renderStatus);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh({ auto: true }); });
  setInterval(renderStatus, 60000);
  if (connOn()) setTimeout(() => refresh({ auto: !!datos }), 400);
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
init();
