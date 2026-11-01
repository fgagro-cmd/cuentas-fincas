'use strict';
/* Cuentas fincas — cuenta de resultados y presupuestos de mis fincas, en el móvil y en el ordenador.
   Lee las líneas de la «Tabla principal» de la hoja de Gestión fincas (su mismo script) y guarda allí
   los presupuestos y parámetros. Guarda una copia en el aparato para verla sin conexión.
   El código no lleva datos: todo llega de tu hoja de Google. */

const APP_VERSION = '1.2.0';

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
const ui = { tab: 'dashboard', camp: null, finca: '__all', modo: 'real', pcamp: null, pfinca: null, rmet: 'resultado' };
let ultimoAjuste = null;               // { camp, fecha, items: [{ fincaId, concepto, previo }] } para «Deshacer»

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
  // Si no se pudo leer el maestro, el código de cada finca (F008…) se saca de los presupuestos guardados
  const idPorNombre = new Map((d.presupuestos || []).map((p) => [p.finca, p.fincaId]));
  for (const l of LINEAS) if (!nombres.has(l.finca)) { nombres.add(l.finca); fs.push({ id: idPorNombre.get(l.finca) || l.finca, nombre: l.finca, ha: null, arboles: null, sinMaestro: true }); }
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
    const fincasOk = (r.fincas && r.fincas.length) ? r.fincas : ((datos && datos.fincas) || []);
    datos = { tabla: r.tabla || [], fincas: fincasOk, avisoFincas: r.avisoFincas || '', presupuestos: r.presupuestos || [], parametros: r.parametros || {}, fecha: r.fecha || '', lastFetch: new Date().toISOString() };
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

/* ---------- Gráficos (SVG hecho a mano: sin librerías, funciona sin conexión) ---------- */
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const kE = (v) => (Math.abs(v) >= 1000 ? nf(v / 1000, 0, Math.abs(v) < 10000 ? 1 : 0) + ' k' : nf(v, 0, 0));
function ticks(min, max, n = 4) {
  if (min === max) { max = min + 1; }
  const paso0 = (max - min) / n, pot = Math.pow(10, Math.floor(Math.log10(paso0)));
  const paso = [1, 2, 2.5, 5, 10].map((m) => m * pot).find((p) => p >= paso0) || 10 * pot;
  const a = Math.floor(min / paso) * paso, z = Math.ceil(max / paso) * paso, t = [];
  for (let v = a; v <= z + paso / 2; v += paso) t.push(Math.round(v * 1e6) / 1e6);
  return t;
}
const tipAttr = (txt) => ` data-tip="${esc(txt)}"`;
/* Líneas acumuladas por mes. series: [{ nombre, vals (null = sin dato), cls }] · ref: { v, txt } línea discontinua */
function svgLineas(W, { etiquetas, series, ref, marca, fmt = eur0, ax = kE }) {
  const H = 200, L = 46, R = 12, T = 12, B = 26;
  const todos = series.flatMap((s) => s.vals.filter(ok)).concat(ref && ok(ref.v) ? [ref.v] : []);
  const tk = ticks(Math.min(0, ...todos), Math.max(1, ...todos));
  const y0 = tk[0], y1 = tk[tk.length - 1], n = etiquetas.length;
  const X = (i) => L + (n === 1 ? 0 : (i * (W - L - R)) / (n - 1)), Y = (v) => T + (H - T - B) * (1 - (v - y0) / (y1 - y0));
  let g = tk.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${L - 6}" y="${Y(v) + 3.5}" text-anchor="end">${ax(v)}</text>`).join('');
  const cada = Math.ceil(n / Math.max(3, Math.floor((W - L - R) / 54)));
  g += etiquetas.map((e, i) => (i % cada === 0 ? `<text class="ax" x="${X(i)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : X(i) > W - R - 20 ? 'end' : 'middle'}">${esc(e)}</text>` : '')).join('');
  if (ref && ok(ref.v)) g += `<line class="ref" x1="${L}" x2="${W - R}" y1="${Y(ref.v)}" y2="${Y(ref.v)}"/><text class="ax reft" x="${W - R}" y="${Y(ref.v) - 5}" text-anchor="end">${esc(ref.txt)}</text>`;
  for (const s of series) {
    let d = '', last = null;
    s.vals.forEach((v, i) => { if (!ok(v)) return; d += (last === null || last !== i - 1 ? 'M' : 'L') + X(i).toFixed(1) + ',' + Y(v).toFixed(1); last = i; });
    if (d) g += `<path class="ln ${s.cls}" d="${d}"/>`;
    if (last !== null) g += `<circle class="pt ${s.cls}" cx="${X(last)}" cy="${Y(s.vals[last])}" r="4.5"/>`;
  }
  if (marca && ok(marca.i) && ok(marca.v)) g += `<circle class="pt ${marca.cls} hollow" cx="${X(marca.i)}" cy="${Y(marca.v)}" r="4.5"/>`;
  // Columnas para el cursor: al pasar o tocar, línea vertical y valores del mes
  const w = n > 1 ? (W - L - R) / (n - 1) : W - L - R;
  g += etiquetas.map((e, i) => `<g class="col"${tipAttr(`${e}\n` + series.map((s) => `${s.nombre}: ${ok(s.vals[i]) ? fmt(s.vals[i]) : '—'}`).join('\n'))}><line class="xh" x1="${X(i)}" x2="${X(i)}" y1="${T}" y2="${H - B}"/><rect class="hit" x="${X(i) - w / 2}" y="${T}" width="${w}" height="${H - T - B}"/></g>`).join('');
  return `<svg class="viz" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
}
/* Barras verticales por categoría, una o varias series. fantasma: { i, vals[] } contorno del presupuesto */
function svgBarras(W, { cats, series, fmt = eur0, fantasma, destacar, etiquetar }) {
  const H = 210, L = 46, R = 8, T = 16, B = 26;
  const todos = series.flatMap((s) => s.vals.filter(ok)).concat(fantasma ? fantasma.vals.filter(ok) : []);
  const tk = ticks(Math.min(0, ...todos), Math.max(0, ...todos, 1));
  const y0 = tk[0], y1 = tk[tk.length - 1];
  const Y = (v) => T + (H - T - B) * (1 - (v - y0) / (y1 - y0));
  const banda = (W - L - R) / cats.length, ns = series.length;
  const bw = Math.max(4, Math.min(34, (banda * 0.72 - (ns - 1) * 2) / ns));
  let g = tk.map((v) => `<line class="grid${v === 0 ? ' zero' : ''}" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${L - 6}" y="${Y(v) + 3.5}" text-anchor="end">${kE(v)}</text>`).join('');
  cats.forEach((c, ci) => {
    const x0 = L + ci * banda + (banda - (ns * bw + (ns - 1) * 2)) / 2;
    g += `<text class="ax${destacar === ci ? ' strong' : ''}" x="${L + ci * banda + banda / 2}" y="${H - 8}" text-anchor="middle">${esc(c)}</text>`;
    series.forEach((s, si) => {
      const v = s.vals[ci], x = x0 + si * (bw + 2);
      if (fantasma && fantasma.i === ci && ok(fantasma.vals[si])) {
        const fv = fantasma.vals[si];
        g += `<rect class="ghost ${s.cls}" x="${x}" y="${Math.min(Y(fv), Y(0))}" width="${bw}" height="${Math.abs(Y(fv) - Y(0))}" rx="3"/>`;
      }
      if (!ok(v)) return;
      const neg = v < 0, cls = s.signo && neg ? 'negb' : s.cls;
      const yT = Math.min(Y(v), Y(0)), h = Math.max(1, Math.abs(Y(v) - Y(0)));
      g += `<rect class="bar ${cls}" x="${x}" y="${yT}" width="${bw}" height="${h}" rx="3"/>`;
      if (etiquetar && ns === 1 && bw >= 22) g += `<text class="ax val" x="${x + bw / 2}" y="${neg ? yT + h + 11 : yT - 4}" text-anchor="middle">${kE(v)}</text>`;
    });
    const tip = `${c}\n` + series.map((s, si) => `${s.nombre}: ${ok(s.vals[ci]) ? fmt(s.vals[ci]) : '—'}${fantasma && fantasma.i === ci && ok(fantasma.vals[si]) ? ` (presupuesto ${fmt(fantasma.vals[si])})` : ''}`).join('\n');
    g += `<rect class="hit"${tipAttr(tip)} x="${L + ci * banda}" y="${T}" width="${banda}" height="${H - T - B}"/>`;
  });
  return `<svg class="viz" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
}
/* Barras horizontales (ranking). filas: [{ nombre, v, sub, marcada }] */
function svgRanking(W, filas, fmt) {
  const fh = 30, H = filas.length * fh + 6, lw = Math.min(150, W * 0.36), vw = 74;
  const vals = filas.map((f) => f.v).filter(ok);
  const min = Math.min(0, ...vals), max = Math.max(0, ...vals, 0.0001);
  const X = (v) => lw + ((v - min) / (max - min || 1)) * (W - lw - vw);
  let g = '';
  filas.forEach((f, i) => {
    const y = i * fh + 4;
    g += `<text class="ax rk${f.marcada ? ' strong' : ''}" x="0" y="${y + 18}">${esc(f.nombre.length > 22 ? f.nombre.slice(0, 21) + '…' : f.nombre)}</text>`;
    if (ok(f.v)) {
      const x = Math.min(X(0), X(f.v)), w = Math.max(2, Math.abs(X(f.v) - X(0)));
      g += `<rect class="bar ${f.v < 0 ? 'negb' : 's1'}${f.marcada ? '' : ' soft'}" x="${x}" y="${y + 6}" width="${w}" height="16" rx="3"/>`;
      g += `<text class="ax val${f.v < 0 ? ' negt' : ''}" x="${W}" y="${y + 18}" text-anchor="end">${esc(fmt(f.v))}</text>`;
    } else g += `<text class="ax" x="${W}" y="${y + 18}" text-anchor="end">${esc(f.sub || 'sin datos')}</text>`;
    g += `<rect class="hit"${tipAttr(`${f.nombre}\n${ok(f.v) ? fmt(f.v) : f.sub || 'sin datos'}`)} x="0" y="${y}" width="${W}" height="${fh}"/>`;
  });
  if (min < 0) g += `<line class="grid zero" x1="${X(0)}" x2="${X(0)}" y1="0" y2="${H}"/>`;
  return `<svg class="viz" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
}
const leyenda = (items) => `<div class="leg">${items.map(([cls, txt]) => `<span><i class="sw ${cls}"></i>${esc(txt)}</span>`).join('')}</div>`;
/* Tooltip común a todos los gráficos */
function onTip(e) {
  const tip = $('#vizTip'); if (!tip) return;
  const h = e.target.closest && e.target.closest('[data-tip]');
  document.querySelectorAll('.viz .col.on').forEach((c) => { if (c !== h) c.classList.remove('on'); });
  if (!h || !h.closest('.viz')) { tip.hidden = true; return; }
  if (h.classList.contains('col')) h.classList.add('on');
  const [t0, ...rest] = h.dataset.tip.split('\n');
  tip.innerHTML = `<b>${esc(t0)}</b>${rest.map((r) => `<div>${esc(r)}</div>`).join('')}`;
  tip.hidden = false;
  const vw = document.documentElement.clientWidth, tw = tip.offsetWidth, th = tip.offsetHeight;
  let x = e.clientX + 12, y = e.clientY - th - 12;
  if (x + tw > vw - 8) x = e.clientX - tw - 12;
  if (x < 8) x = 8;
  if (y < 8) y = e.clientY + 16;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}

/* ---------- Pestaña: Dashboard ---------- */
const RMET = {
  resultado: { label: 'Resultado', f: (x) => x.resultado, fmt: eur0, desc: true },
  margen: { label: 'Margen', f: (x) => x.margen, fmt: (v) => nf(v * 100, 1, 1) + ' %', desc: true },
  res_ha: { label: '€/ha', f: (x, f) => (ok(f.ha) && f.ha > 0 ? x.resultado / f.ha : null), fmt: (v) => eur0(v) + '/ha', desc: true, sub: 'falta la superficie' },
  coste: { label: 'Coste €/kg', f: (x) => (x.kg > 0 ? x.coste_prod : null), fmt: (v) => nf(v, 3, 3) + ' €/kg', desc: false, sub: 'sin cosecha' },
  kg_ha: { label: 'kg/ha', f: (x) => (x.kg > 0 ? x.kg_ha : null), fmt: (v) => nf(v, 0, 0) + ' kg/ha', desc: true, sub: 'sin cosecha' },
};
const etiquetaMes = (c, off) => { const m = c * 12 + off, y = Math.floor(m / 12), mm = ((m % 12) + 12) % 12; return MESES[mm] + ' ' + String(y).slice(2); };
const pctTxt = (a, b) => (b ? (a >= b ? '+' : '−') + nf(Math.abs(a / b - 1) * 100, 0, 0) + ' %' : '');
let dashCharts = [];
function renderDashboard() {
  const c = ui.camp, id = ui.finca, finca = id === '__all' ? null : nombreFinca(id);
  const aviso = avisoSinDatos();
  if (!LINEAS.length) { $('#view').innerHTML = aviso; bindAviso(); return; }
  const hoy = hoyISO();
  const pres = presDe(c, id);
  dashCharts = [];
  // 1 · Ritmo de la campaña
  const bloqueRitmo = (cual, titulo, nota, presV) => {
    const r = CU.ritmo(LINEAS, c, finca, cual, hoy);
    const et = r.meses.map((o) => etiquetaMes(c, o));
    const ref = ok(presV) && presV > 0 ? { v: presV, txt: `presupuesto ${eur0(presV)}` } : null;
    const marcaI = r.abierta ? r.meses.indexOf(r.hoyOff) : -1;
    const idc = 'ch' + dashCharts.length;
    dashCharts.push({ id: idc, f: (W) => svgLineas(W, { etiquetas: et, series: [{ nombre: String(c - 1), vals: r.prev, cls: 'sp' }, { nombre: String(c), vals: r.cur, cls: 's1' }], ref, marca: marcaI >= 0 && r.abierta ? { i: marcaI, v: r.prevMisma, cls: 'sp' } : null }) });
    const comp = r.abierta
      ? `${eur0(r.curTot)} <span class="${cual === 'ingresos' ? '' : r.curTot > r.prevMisma ? 'up' : ''}">${pctTxt(r.curTot, r.prevMisma)}</span> frente a ${c - 1} a la misma fecha (${eur0(r.prevMisma)}; acabó en ${eur0(r.prevTotal)})`
      : `${eur0(r.curTot)} · ${c - 1}: ${eur0(r.prevTotal)} <span>${pctTxt(r.curTot, r.prevTotal)}</span>`;
    const pp = ref ? ` · ${nf((r.curTot / presV) * 100, 0, 0)} % del presupuesto` : '';
    return `<section class="vcard"><h3>${esc(titulo)}</h3><p class="vsub">${esc(nota)}</p>
      <p class="vstat">${comp}${pp}</p>
      <div class="chart" id="${idc}"></div>
      ${leyenda([['s1', `${c}${r.abierta ? ' (hasta hoy)' : ''}`], ['sp', `${c - 1}`], ...(ref ? [['ref', 'Presupuesto ' + c]] : [])])}</section>`;
  };
  const presCultivo = pres ? pres.gastos - pres.arrendamiento - pres.recoleccion : null;
  // 2 · Evolución por campaña
  const camps = [...new Set(LINEAS.map((l) => l.campana))].filter(ok).sort((a, b) => a - b);
  const xs = camps.map((cc) => realDe(cc, id));
  const enCurso = (cc) => CU.campanaAbierta(cc, hoy) && hoy >= (cc - 1) + '-11-01';
  const iAbierta = camps.map(enCurso).lastIndexOf(true);
  const presAb = iAbierta >= 0 ? presDe(camps[iAbierta], id) : null;
  const etC = camps.map((cc) => String(cc));
  const dest = camps.indexOf(c);
  const ch = (f) => { const idc = 'ch' + dashCharts.length; dashCharts.push({ id: idc, f }); return `<div class="chart" id="${idc}"></div>`; };
  const evo = `<section class="vcard"><h3>Evolución por campaña</h3><p class="vsub">${esc(nombreFinca(id))} · lo real de cada campaña${presAb ? `; ${camps[iAbierta]} va en curso y su contorno es el presupuesto` : ''}</p>
      ${ch((W) => svgBarras(W, { cats: etC, destacar: dest, series: [{ nombre: 'Ingresos', vals: xs.map((x) => (x ? x.ingresos : null)), cls: 's1' }, { nombre: 'Gastos', vals: xs.map((x) => (x ? x.gastos : null)), cls: 's2' }], fantasma: presAb ? { i: iAbierta, vals: [presAb.ingresos, presAb.gastos] } : null }))}
      ${leyenda([['s1', 'Ingresos'], ['s2', 'Gastos']])}
      <h4>Resultado</h4>
      ${ch((W) => svgBarras(W, { cats: etC, destacar: dest, etiquetar: true, series: [{ nombre: 'Resultado', vals: xs.map((x) => (x ? x.resultado : null)), cls: 's1', signo: true }], fantasma: presAb ? { i: iAbierta, vals: [presAb.resultado] } : null }))}
      <h4>Precio de venta y coste de producción (€/kg)</h4>
      ${ch((W) => svgLineas(W, { etiquetas: etC, fmt: (v) => nf(v, 3, 3) + ' €/kg', series: [{ nombre: 'Precio medio', vals: xs.map((x, i) => (x && x.kg > 0 && i !== iAbierta ? x.precio : null)), cls: 's1' }, { nombre: 'Coste sin arrendamiento', vals: xs.map((x, i) => (x && x.kg > 0 && i !== iAbierta ? x.coste_prod : null)), cls: 's2' }], ax: (v) => nf(v, 2, 2) }))}
      ${leyenda([['s1', 'Precio medio'], ['s2', 'Coste de producción sin arrendamiento']])}
      ${iAbierta >= 0 ? `<p class="small" style="margin:2px 0 0">Sin ${camps[iAbierta]}: hasta que entre la cosecha el €/kg no es comparable.</p>` : ''}
      <h4>Producción (kg/ha)</h4>
      ${ok(pf(id).ha) ? ch((W) => svgBarras(W, { cats: etC, destacar: dest, etiquetar: true, fmt: (v) => nf(v, 0, 0) + ' kg/ha', series: [{ nombre: 'kg/ha', vals: xs.map((x) => (x && x.kg > 0 ? x.kg_ha : null)), cls: 's1' }], fantasma: presAb && ok(presAb.kg_ha) ? { i: iAbierta, vals: [presAb.kg_ha] } : null })) : '<p class="small">Falta la superficie en el Maestro de fincas.</p>'}
    </section>`;
  // 3 · Ranking de fincas
  const m = RMET[ui.rmet] || RMET.resultado;
  const filas = FINCAS.map((f) => { const x = ui.modo === 'real' ? realDe(c, f.id) : presDe(c, f.id); return { nombre: f.nombre, v: x ? m.f(x, f) : null, sub: x ? m.sub : (ui.modo === 'real' ? 'sin líneas' : 'sin presupuesto'), marcada: id === '__all' || id === f.id }; });
  filas.sort((a, b) => (ok(a.v) ? (ok(b.v) ? (m.desc ? b.v - a.v : a.v - b.v) : -1) : ok(b.v) ? 1 : 0));
  const rank = `<section class="vcard"><h3>Ranking de fincas · ${c}</h3><p class="vsub">De mejor a peor${m.desc ? '' : ' (menos coste es mejor)'}${ui.modo === 'real' && CU.campanaAbierta(c, hoy) ? ' · campaña en curso: lo real hasta hoy' : ''}</p>
      <div class="seg" id="dModo"><button data-m="real" aria-pressed="${ui.modo === 'real'}">Real</button><button data-m="pres" aria-pressed="${ui.modo === 'pres'}">Presupuesto</button></div>
      <div class="chips" id="dMet">${Object.entries(RMET).map(([k, r]) => `<button class="chip" data-r="${k}" aria-pressed="${ui.rmet === k}">${esc(r.label)}</button>`).join('')}</div>
      ${ch((W) => svgRanking(W, filas, m.fmt))}</section>`;
  $('#view').innerHTML = `
    <div class="sel">
      <select id="dCamp" aria-label="Campaña">${campOpts(c)}</select>
      <select id="dFinca" aria-label="Finca">${fincaOpts(id, true)}</select>
    </div>
    ${aviso}
    <div class="dgrid">
      ${bloqueRitmo('cultivo', `Gasto de cultivo · ${c}`, 'Gastos y tareas sin arrendamiento ni recolección, acumulado mes a mes', presCultivo)}
      ${bloqueRitmo('ingresos', `Ingresos · ${c}`, 'Cosecha, subvenciones y otros ingresos, acumulado mes a mes', pres ? pres.ingresos : null)}
      ${evo}
      ${rank}
    </div>
    <p class="legend">Toca un gráfico para ver los valores. El punto hueco marca dónde iba ${c - 1} a la misma fecha. Mismas cuentas que la pestaña Resultados (mano de obra propia a ${nf(PARAM.moEurH, 0, 2)} €/h).</p>
    <div id="vizTip" class="viztip" hidden></div>`;
  drawCharts();
  $('#dCamp').onchange = (e) => { ui.camp = Number(e.target.value); saveUi(); renderAll(); };
  $('#dFinca').onchange = (e) => { ui.finca = e.target.value; saveUi(); renderAll(); };
  $('#dModo').onclick = (e) => { const b = e.target.closest('[data-m]'); if (b) { ui.modo = b.dataset.m; saveUi(); renderAll(); } };
  $('#dMet').onclick = (e) => { const b = e.target.closest('[data-r]'); if (b) { ui.rmet = b.dataset.r; saveUi(); renderAll(); } };
  const v = $('#view');
  v.onpointermove = onTip; v.onpointerdown = onTip;
  v.onpointerleave = () => { const t = $('#vizTip'); if (t) t.hidden = true; document.querySelectorAll('.viz .col.on').forEach((x) => x.classList.remove('on')); };
  bindAviso();
}
function drawCharts() {
  for (const d of dashCharts) { const el = document.getElementById(d.id); if (el) el.innerHTML = d.f(Math.max(260, Math.floor(el.clientWidth))); }
}
function headDashboard() { return kpis(realDe(ui.camp, ui.finca), `real ${ui.camp}`) + presLine(presDe(ui.camp, ui.finca), ui.camp); }
let rsTimer;
window.addEventListener('resize', () => { clearTimeout(rsTimer); rsTimer = setTimeout(() => { if (ui.tab === 'dashboard') drawCharts(); }, 200); });

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
    <div class="actions" style="margin:0 0 10px">
      <button class="btn primary" id="pAjuste" ${LINEAS.some((l) => l.campana === c) ? '' : 'disabled'}>Ajustar a lo real ${c}</button>
      ${ultimoAjuste && ultimoAjuste.camp === c ? `<button class="btn" id="pDeshacer">Deshacer el último ajuste (${ultimoAjuste.items.length} ${ultimoAjuste.items.length === 1 ? 'casilla' : 'casillas'} · ${new Date(ultimoAjuste.fecha).toLocaleDateString('es-ES')})</button>` : ''}
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
  $('#pAjuste').onclick = () => openAjuste(c);
  const dh = $('#pDeshacer'); if (dh) dh.onclick = deshacerAjuste;
  bindAviso();
}

/* ---------- Ajustar a lo real: iguala las líneas del presupuesto que lo real ya ha superado ---------- */
const AJ_LABEL = { cosecha: 'Cosecha (kg × precio)', arrendamiento: 'Arrendamiento', ...Object.fromEntries(CU.ENTRADAS.map((e) => [e.k, e.label])) };
const hoyISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function ajTexto(cb) {
  if (cb.k === 'cosecha') {
    const p = cb.previos, v = cb.valores;
    const kgDe = ok(p.kg) ? p.kg : 0, kgA = 'kg' in v ? v.kg : kgDe;
    const prDe = ok(p.precio) ? p.precio : 0, prA = 'precio' in v ? v.precio : prDe;
    return { de: `${nf(kgDe)} kg × ${nf(prDe, 3, 3)}`, a: `${nf(kgA)} kg × ${nf(prA, 3, 3)}`, real: `real: ${nf(cb.realKg || 0)} kg · ${eur0(cb.real || 0)}` };
  }
  const k = Object.keys(cb.valores)[0];
  const de = cb.k === 'arrendamiento' && cb.deEstimado ? `${eur0(cb.presupuestado)} (estimado)` : ok(cb.previos[k]) ? eur0(cb.previos[k]) : 'vacío';
  return { de, a: eur0(cb.valores[k]), real: `real: ${eur(cb.real)}` };
}
function openAjuste(c) {
  const ids = [ui.pfinca, ...FINCAS.map((f) => f.id).filter((i) => i !== ui.pfinca)];
  const bloques = [];
  for (const id of ids) {
    const x = realDe(c, id); if (!x) continue;
    const b = PRES[c + '|' + id] || {};
    const aj = CU.ajusteReal(b, x, pf(id), PARAM.reglas[id]);
    if (aj.cambios.length) bloques.push({ id, b, x, aj });
  }
  const cerrada = !CU.campanaAbierta(c, hoyISO());
  const html = !bloques.length ? `<p class="empty">Ninguna línea del presupuesto ${c} está por debajo de lo real. No hay nada que ajustar.</p>` : `
    <p class="small" style="margin-top:0">Líneas del presupuesto ${c} que lo real ya ha superado. Al ajustarlas pasan a valer lo real (redondeado al euro); las que siguen por debajo no se tocan. Marca las que quieras.</p>
    ${cerrada ? `<p class="hint warn" style="margin:0 0 12px">La campaña ${c} ya está cerrada: si la ajustas, su presupuesto quedará igual que lo real y dejará de servir para comparar.</p>` : ''}
    ${bloques.map((bl) => `
      <div class="ajf" data-f="${esc(bl.id)}">
        <label class="ajh"><input type="checkbox" class="ajall" ${bl.aj.sinPresupuesto ? '' : 'checked'}> <b>${esc(nombreFinca(bl.id))}</b>${bl.aj.sinPresupuesto ? ' <span class="pill">sin presupuesto: se crearía con lo real</span>' : ''}</label>
        ${bl.aj.cambios.map((cb) => { const t = ajTexto(cb); return `
          <label class="ajl"><input type="checkbox" data-k="${cb.k}" ${bl.aj.sinPresupuesto ? '' : 'checked'}>
            <span class="t">${esc(AJ_LABEL[cb.k] || cb.k)}<small>${esc(t.real)}</small></span>
            <span class="v">${esc(t.de)} → <b>${esc(t.a)}</b></span></label>`; }).join('')}
        <p class="ajr small"></p>
      </div>`).join('')}
    <div class="actions"><button class="btn primary" id="ajGo">Ajustar</button></div>
    <p class="hint" style="margin-top:8px">Después podrás deshacerlo con «Deshacer el último ajuste».</p>`;
  const body = openSheet(`Ajustar a lo real · ${c}`, html);
  if (!bloques.length) return;
  const elegidos = (el) => [...el.querySelectorAll('input[data-k]:checked')].map((i) => i.dataset.k);
  const resumen = () => {
    let n = 0;
    for (const bl of bloques) {
      const el = body.querySelector(`.ajf[data-f="${CSS.escape(bl.id)}"]`);
      const sel = elegidos(el);
      const nb = CU.aplicarAjuste(bl.b, bl.aj.cambios, sel);
      if (sel.includes('arrendamiento')) { const arr = CU.arrendamientoTras(bl.b, sel, bl.aj.cambios, bl.x, pf(bl.id), PARAM.reglas[bl.id]); if (arr) nb.arrendamiento = arr.valores.arrendamiento; }
      const antes = CU.presupuesto(Object.keys(bl.b).length ? bl.b : { kg: 0 }, pf(bl.id), PARAM.reglas[bl.id]);
      const desp = CU.presupuesto(Object.keys(nb).length ? nb : { kg: 0 }, pf(bl.id), PARAM.reglas[bl.id]);
      el.querySelector('.ajall').checked = sel.length === bl.aj.cambios.length;
      el.querySelector('.ajall').indeterminate = sel.length > 0 && sel.length < bl.aj.cambios.length;
      el.querySelector('.ajr').innerHTML = sel.length ? `Resultado presupuestado: ${eur0(antes.resultado)} → <b class="${desp.resultado < 0 ? 'neg' : ''}">${eur0(desp.resultado)}</b> · gastos ${eur0(antes.gastos)} → ${eur0(desp.gastos)}` : 'Sin cambios en esta finca';
      n += sel.length;
    }
    const go = $('#ajGo', body); go.disabled = !n; go.textContent = n ? `Ajustar ${n} ${n === 1 ? 'línea' : 'líneas'}` : 'Marca alguna línea';
  };
  body.addEventListener('change', (e) => {
    const all = e.target.closest('.ajall');
    if (all) all.closest('.ajf').querySelectorAll('input[data-k]').forEach((i) => { i.checked = all.checked; });
    resumen();
  });
  resumen();
  $('#ajGo', body).onclick = () => {
    const lista = [], items = [];
    for (const bl of bloques) {
      const el = body.querySelector(`.ajf[data-f="${CSS.escape(bl.id)}"]`);
      const sel = elegidos(el);
      const cambios = bl.aj.cambios.filter((cb) => cb.k !== 'arrendamiento' && sel.includes(cb.k));
      if (sel.includes('arrendamiento')) { const arr = CU.arrendamientoTras(bl.b, sel, bl.aj.cambios, bl.x, pf(bl.id), PARAM.reglas[bl.id]); if (arr) cambios.push(arr); }
      for (const cb of cambios) for (const [k, v] of Object.entries(cb.valores)) {
        lista.push({ camp: c, id: bl.id, k, v });
        items.push({ fincaId: bl.id, concepto: k, previo: ok(cb.previos[k]) ? cb.previos[k] : null });
      }
    }
    if (!lista.length) return;
    ultimoAjuste = { camp: c, fecha: new Date().toISOString(), items };
    save('ajuste', ultimoAjuste);
    closeSheet();
    setPresVarios(lista);
    toast(`Ajustadas ${items.length} ${items.length === 1 ? 'casilla' : 'casillas'} a lo real`);
  };
}
function deshacerAjuste() {
  const a = ultimoAjuste; if (!a) return;
  if (!confirm(`¿Volver a dejar las ${a.items.length} casillas como estaban antes del ajuste del ${new Date(a.fecha).toLocaleDateString('es-ES')}?`)) return;
  ultimoAjuste = null; save('ajuste', null);
  setPresVarios(a.items.map((it) => ({ camp: a.camp, id: it.fincaId, k: it.concepto, v: it.previo })));
  toast('Ajuste deshecho');
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
function anotarCambio(camp, id, k, v, ts) {
  const actual = PRES[camp + '|' + id] || {};
  if ((v === null && !ok(actual[k])) || (ok(v) && actual[k] === v)) return;
  pend.cambios = pend.cambios.filter((x) => !(x.campana === camp && x.fincaId === id && x.concepto === k));
  pend.cambios.push({ campana: camp, fincaId: id, finca: nombreFinca(id), concepto: k, descripcion: DESC[k] || k, valor: v, ts });
}
function setPres(camp, id, valores, redibujar = true) {
  const ts = new Date().toISOString();
  for (const [k, v] of Object.entries(valores)) anotarCambio(camp, id, k, v, ts);
  save('pend', pend); build(); if (redibujar) renderAll(); else renderStatus(); scheduleSync();
}
/* Varias fincas a la vez (ajuste a lo real y deshacer). lista: [{ camp, id, k, v }] */
function setPresVarios(lista) {
  const ts = new Date().toISOString();
  for (const c of lista) anotarCambio(c.camp, c.id, c.k, c.v, ts);
  save('pend', pend); build(); renderAll(); scheduleSync();
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
  const faltan = FINCAS.filter((f) => f.sinMaestro);
  if (faltan.length) {
    box.querySelector('#pSave').disabled = true;
    box.insertAdjacentHTML('beforeend', `<p class="hint warn" style="margin-top:8px">No se pueden guardar hasta leer el Maestro de fincas (faltan: ${faltan.map((f) => esc(f.nombre)).join(', ')}). Así no se pierden los porcentajes que ya tienes en la hoja.</p>`);
  }
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
  dashboard: { title: 'Dashboard', head: headDashboard, render: renderDashboard },
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
function saveUi() { save('ui', { v: 2, tab: ui.tab, camp: ui.camp, finca: ui.finca, modo: ui.modo, pcamp: ui.pcamp, pfinca: ui.pfinca, rmet: ui.rmet }); }

async function init() {
  document.querySelectorAll('.tab').forEach((b) => b.onclick = () => { ui.tab = b.dataset.tab; saveUi(); window.scrollTo(0, 0); renderAll(); });
  $('#btnSettings').onclick = openSettings;
  $('#syncStatus').onclick = openSettings;
  try {
    const [c, d, p, u, aj] = await Promise.all([dbGet('conn'), dbGet('datos'), dbGet('pend'), dbGet('ui'), dbGet('ajuste')]);
    if (c) conn = { ...conn, ...c };
    if (d) datos = d;
    if (p) pend = { cambios: Array.isArray(p.cambios) ? p.cambios : [], param: p.param || null };
    if (u) Object.assign(ui, u);
    if (!u || u.v !== 2) ui.tab = 'dashboard'; // v1.2.0: la primera vez se abre en el Dashboard nuevo
    if (!TABS[ui.tab]) ui.tab = 'dashboard';
    if (aj && Array.isArray(aj.items)) ultimoAjuste = aj;
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
