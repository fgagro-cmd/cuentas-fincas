'use strict';
/* Cuentas fincas · motor de cálculo (sin pantalla, se puede probar fuera del navegador).
   Reproduce la pestaña «Presupuesto y cuenta de resultados» del Excel Gestion_de_fincas_3.0:
   lo real sale de las líneas de la Tabla principal; el presupuesto, de lo que escribes tú. */
(function (root) {
  const r2 = (n) => Math.round((n + Number.EPSILON * Math.sign(n)) * 100) / 100;
  const div = (a, b) => (b ? a / b : null);

  /* Filas de la cuenta de resultados, en el orden del Excel.
     tipo: kg | eurkg | eur | kgha | kgpie | eurpie | pct.  total: fila de suma (en negrita). */
  const SECCIONES = [
    { titulo: 'Ingresos de la explotación', filas: [
      { k: 'kg', label: 'Producción (kg)', tipo: 'kg' },
      { k: 'precio', label: 'Precio medio (€/kg)', tipo: 'eurkg' },
      { k: 'cosecha', label: 'Ingresos por cosecha' },
      { k: 'subvenciones', label: 'Ingresos por subvenciones' },
      { k: 'otros_ingresos', label: 'Otros ingresos' },
      { k: 'ingresos', label: 'Total ingresos', total: true },
    ] },
    { titulo: 'Gastos de la explotación', filas: [
      { k: 'fertilizantes', label: 'Fertilizantes', nota: 'con bioestimulantes' },
      { k: 'fitosanitarios', label: 'Fitosanitarios', nota: 'con herbicidas' },
      { k: 'agua', label: 'Agua de riego' },
      { k: 'seguro', label: 'Seguro' },
      { k: 'resto', label: 'Resto', nota: 'combustible, material de riego y enmiendas' },
      { k: 'insumos', label: 'Gasto en insumos', total: true },
      { k: 'tratamientos', label: 'Tratamientos fitosanitarios', nota: 'fumigación y herbicida' },
      { k: 'poda', label: 'Poda' },
      { k: 'recoleccion', label: 'Recolección' },
      { k: 'desbroce', label: 'Desbroce', nota: 'desbrozar y labrar' },
      { k: 'otras_tareas', label: 'Otras tareas', nota: 'estiércol, mejoras, mantenimiento y otras' },
      { k: 'tareas', label: 'Gasto total en tareas', total: true },
      { k: 'arrendamiento', label: 'Arrendamiento', total: true },
      { k: 'otros_gastos', label: 'Otros gastos', total: true },
      { k: 'gastos', label: 'Total gastos', total: true },
    ] },
    { titulo: 'Balance', filas: [
      { k: 'resultado', label: 'Resultado de la explotación', total: true, signo: true },
    ] },
    { titulo: 'Otros indicadores', filas: [
      { k: 'kg_ha', label: 'Producción por hectárea (kg/ha)', tipo: 'kgha' },
      { k: 'kg_arbol', label: 'Producción por árbol (kg/árbol)', tipo: 'kgpie' },
      { k: 'coste_prod', label: 'Coste de producción sin arrendamiento (€/kg)', tipo: 'eurkg' },
      { k: 'coste_rec', label: 'Coste de recolección (€/kg)', tipo: 'eurkg' },
      { k: 'poda_arbol', label: 'Coste de poda por árbol (€/árbol)', tipo: 'eurpie' },
      { k: 'trituracion', label: 'Coste de trituración' },
      { k: 'coste_trat', label: 'Coste de tratamientos' },
      { k: 'mejoras', label: 'Coste de mejoras y mantenimiento' },
      { k: 'mo_contratada', label: 'Mano de obra contratada' },
      { k: 'mo_propia', label: 'Mano de obra propia' },
      { k: 'amortizacion', label: 'Amortización de maquinaria' },
      { k: 'gastos_sin_arr', label: 'Gastos sin arrendamiento' },
      { k: 'gastos_sin_arr_rec', label: 'Gastos sin arrendamiento ni recolección' },
      { k: 'benef_mo', label: 'Beneficio + mano de obra propia', signo: true },
      { k: 'benef_mo_maq', label: 'Beneficio + MO propia + maquinaria', signo: true },
      { k: 'margen', label: 'Margen de beneficio', tipo: 'pct', signo: true },
    ] },
  ];
  const FILAS = SECCIONES.flatMap((s) => s.filas);

  /* Lo que escribes en un presupuesto (por finca y campaña). */
  const ENTRADAS = [
    { k: 'kg', label: 'Producción estimada (kg)', tipo: 'kg' },
    { k: 'precio', label: 'Precio estimado (€/kg)', tipo: 'eurkg' },
    { k: 'subvenciones', label: 'Subvenciones' },
    { k: 'otros_ingresos', label: 'Otros ingresos' },
    { k: 'fertilizantes', label: 'Fertilizantes (con bioestimulantes)' },
    { k: 'fitosanitarios', label: 'Fitosanitarios (con herbicidas)' },
    { k: 'agua', label: 'Agua de riego' },
    { k: 'seguro', label: 'Seguro' },
    { k: 'resto', label: 'Resto de insumos' },
    { k: 'tratamientos', label: 'Tratamientos fitosanitarios' },
    { k: 'poda', label: 'Poda' },
    { k: 'recoleccion', label: 'Recolección' },
    { k: 'desbroce', label: 'Desbroce' },
    { k: 'otras_tareas', label: 'Otras tareas' },
    { k: 'trituracion', label: 'Trituración (parte de la poda)' },
    { k: 'otros_gastos', label: 'Otros gastos' },
    { k: 'arrendamiento', label: 'Arrendamiento' },
  ];

  /* Reglas de arrendamiento (el porcentaje y la base de cada finca están en la pestaña Parámetros). */
  // Las reglas que restan insumos (Pomelos, L. Herrero y Cortijo) restan también el seguro, que va dentro de los insumos.
  const BASES = {
    ninguno: { label: 'Sin arrendamiento (en propiedad)', f: () => 0 },
    'cosecha-recoleccion-insumos-poda': { label: '% de (cosecha − recolección − insumos − poda)', f: (x) => x.cosecha - x.recoleccion - x.insumos - x.poda },
    'cosecha-recoleccion': { label: '% de (cosecha − recolección)', f: (x) => x.cosecha - x.recoleccion },
    'ingresos-insumos-mocontratada': { label: '% de (ingresos − insumos − mano de obra contratada)', f: (x) => x.ingresos - x.insumos - x.mo_contratada },
  };
  function arrendamientoEstimado(x, regla) {
    if (!regla || !BASES[regla.base] || !(regla.pct > 0)) return 0;
    return r2(BASES[regla.base].f(x) * regla.pct / 100);
  }

  /* Indicadores comunes a lo real y al presupuesto. */
  function indicadores(x, ha, arboles) {
    x.gastos_sin_arr = x.gastos - x.arrendamiento;
    x.gastos_sin_arr_rec = x.gastos_sin_arr - x.recoleccion;
    x.kg_ha = div(x.kg, ha);
    x.kg_arbol = div(x.kg, arboles);
    x.coste_prod = div(x.gastos_sin_arr, x.kg);
    x.coste_rec = div(x.recoleccion, x.kg);
    x.poda_arbol = div(x.poda - x.trituracion, arboles);
    x.coste_trat = x.tratamientos + x.fitosanitarios;
    x.margen = div(x.resultado, x.ingresos);
    x.precio = div(x.cosecha, x.kg);
    return x;
  }

  /* ---------- Lo real, desde las líneas ----------
     linea: { fecha, campana, categoria, tipo, tipo2, finca, desc, cantidad, precio, importe }
     fincas: nombre de la finca, o null para la explotación completa. */
  const enLista = (l, cat, tipos) => l.categoria === cat && tipos.includes(l.tipo);
  /* Qué líneas forman cada concepto real (se usa también para enseñar el detalle de una cifra). */
  const FILTRO = {
    kg: (l) => enLista(l, 'Ingreso', ['Cosecha']),
    cosecha: (l) => enLista(l, 'Ingreso', ['Cosecha']),
    precio: (l) => enLista(l, 'Ingreso', ['Cosecha']),
    subvenciones: (l) => enLista(l, 'Ingreso', ['Subvención']),
    otros_ingresos: (l) => enLista(l, 'Ingreso', ['Otros ingresos']),
    ingresos: (l) => l.categoria === 'Ingreso',
    fertilizantes: (l) => enLista(l, 'Gasto', ['Fertilizantes', 'Bioestimulantes']),
    fitosanitarios: (l) => enLista(l, 'Gasto', ['Fitosanitarios', 'Herbicidas']),
    agua: (l) => enLista(l, 'Gasto', ['Agua de riego']),
    seguro: (l) => enLista(l, 'Gasto', ['Seguro']),
    resto: (l) => enLista(l, 'Gasto', ['Combustible', 'Material de riego', 'Enmienda orgánica']),
    insumos: (l) => enLista(l, 'Gasto', ['Fertilizantes', 'Bioestimulantes', 'Fitosanitarios', 'Herbicidas', 'Agua de riego', 'Seguro', 'Combustible', 'Material de riego', 'Enmienda orgánica']),
    tratamientos: (l) => enLista(l, 'Tarea', ['Fumigación', 'Herbicida']),
    poda: (l) => enLista(l, 'Tarea', ['Poda']),
    recoleccion: (l) => enLista(l, 'Tarea', ['Recolección']),
    desbroce: (l) => enLista(l, 'Tarea', ['Desbrozar', 'Labrar']),
    otras_tareas: (l) => enLista(l, 'Tarea', ['Estiércol', 'Otras tareas', 'Mejoras', 'Mantenimiento']),
    tareas: (l) => l.categoria === 'Tarea',
    arrendamiento: (l) => enLista(l, 'Gasto', ['Arrendamiento']),
    otros_gastos: (l) => enLista(l, 'Gasto', ['Otros']),
    gastos: (l) => l.categoria === 'Gasto' || l.categoria === 'Tarea',
    resultado: () => true,
    trituracion: (l) => enLista(l, 'Tarea', ['Poda']) && l.tipo2 === 'Con maquinaria',
    coste_trat: (l) => enLista(l, 'Tarea', ['Fumigación', 'Herbicida']) || enLista(l, 'Gasto', ['Fitosanitarios', 'Herbicidas']),
    mejoras: (l) => enLista(l, 'Tarea', ['Mejoras', 'Mantenimiento']),
    mo_contratada: (l) => l.tipo2 === 'Contratado',
    mo_propia: (l) => l.tipo2 === 'Con maquinaria' || l.tipo2 === 'Sin maquinaria',
    amortizacion: (l) => l.tipo2 === 'Con maquinaria' || l.tipo2 === 'Sin maquinaria',
    gastos_sin_arr: (l) => (l.categoria === 'Gasto' || l.categoria === 'Tarea') && !(l.categoria === 'Gasto' && l.tipo === 'Arrendamiento'),
  };
  const lineasDe = (lineas, campana, finca) => lineas.filter((l) => l.campana === campana && (finca == null || l.finca === finca));
  function lineasConcepto(lineas, campana, finca, k) {
    const f = FILTRO[k];
    return f ? lineasDe(lineas, campana, finca).filter(f) : [];
  }

  function real(lineas, campana, finca, p) {
    const L = lineasDe(lineas, campana, finca);
    const imp = (k) => L.reduce((t, l) => t + (FILTRO[k](l) ? l.importe : 0), 0);
    const x = { n: L.length };
    for (const k of ['cosecha', 'subvenciones', 'otros_ingresos', 'fertilizantes', 'fitosanitarios', 'agua', 'seguro', 'resto', 'tratamientos', 'poda', 'recoleccion', 'desbroce', 'otras_tareas', 'arrendamiento', 'otros_gastos', 'trituracion', 'mejoras', 'mo_contratada']) x[k] = imp(k);
    x.kg = L.reduce((t, l) => t + (FILTRO.kg(l) ? l.cantidad : 0), 0);
    x.ingresos = x.cosecha + x.subvenciones + x.otros_ingresos;
    x.insumos = x.fertilizantes + x.fitosanitarios + x.agua + x.seguro + x.resto;
    x.tareas = L.reduce((t, l) => t + (l.categoria === 'Tarea' ? l.importe : 0), 0);
    x.gastos = x.insumos + x.tareas + x.arrendamiento + x.otros_gastos;
    x.resultado = x.ingresos - x.gastos;
    // Mano de obra propia = horas de tareas propias (con y sin maquinaria) × €/h. Lo que pagas de más por esas horas es la maquinaria.
    const horas = L.reduce((t, l) => t + (FILTRO.mo_propia(l) ? l.cantidad : 0), 0);
    const impPropias = L.reduce((t, l) => t + (FILTRO.amortizacion(l) ? l.importe : 0), 0);
    x.horas_propias = horas;
    x.mo_propia = horas * p.moEurH;
    x.amortizacion = impPropias - x.mo_propia;
    x.benef_mo = x.resultado + x.mo_propia;
    x.benef_mo_maq = x.benef_mo + x.amortizacion;
    return indicadores(x, p.ha, p.arboles);
  }

  /* ---------- El presupuesto, desde lo que escribes ----------
     b: { kg, precio, subvenciones, ..., arrendamiento? }. Si no escribes el arrendamiento, se estima con la regla. */
  function presupuesto(b, p, regla) {
    if (!b || !Object.keys(b).length) return null;
    const v = (k) => (isFinite(b[k]) ? Number(b[k]) : 0);
    const x = { kg: v('kg') };
    x.cosecha = x.kg * v('precio');
    x.subvenciones = v('subvenciones'); x.otros_ingresos = v('otros_ingresos');
    x.ingresos = x.cosecha + x.subvenciones + x.otros_ingresos;
    for (const k of ['fertilizantes', 'fitosanitarios', 'agua', 'seguro', 'resto', 'tratamientos', 'poda', 'recoleccion', 'desbroce', 'otras_tareas', 'otros_gastos', 'trituracion']) x[k] = v(k);
    x.insumos = x.fertilizantes + x.fitosanitarios + x.agua + x.seguro + x.resto;
    x.tareas = x.tratamientos + x.poda + x.recoleccion + x.desbroce + x.otras_tareas;
    x.mo_contratada = x.poda + x.recoleccion;               // reglas de estimación del Excel
    x.arrendamiento_estimado = arrendamientoEstimado(x, regla);
    x.arrendamiento_manual = isFinite(b.arrendamiento) && b.arrendamiento !== null && b.arrendamiento !== '';
    x.arrendamiento = x.arrendamiento_manual ? Number(b.arrendamiento) : x.arrendamiento_estimado;
    x.gastos = x.insumos + x.tareas + x.arrendamiento + x.otros_gastos;
    x.resultado = x.ingresos - x.gastos;
    x.mejoras = x.tareas * 0.1;
    x.amortizacion = (x.tratamientos + x.desbroce + x.otras_tareas) * 0.6;
    x.benef_mo_maq = x.resultado + x.otras_tareas + x.desbroce + x.tratamientos;
    x.benef_mo = x.benef_mo_maq - x.amortizacion;
    x.mo_propia = x.benef_mo - x.resultado;
    return indicadores(x, p.ha, p.arboles);
  }

  /* Suma de varias fincas (explotación completa): las cantidades se suman y los cocientes se recalculan. */
  const SUMABLES = ['kg', 'cosecha', 'subvenciones', 'otros_ingresos', 'ingresos', 'fertilizantes', 'fitosanitarios', 'agua', 'seguro', 'resto', 'insumos', 'tratamientos', 'poda', 'recoleccion', 'desbroce', 'otras_tareas', 'tareas', 'arrendamiento', 'otros_gastos', 'gastos', 'resultado', 'trituracion', 'mejoras', 'mo_contratada', 'mo_propia', 'amortizacion', 'benef_mo', 'benef_mo_maq'];
  function sumar(lista, ha, arboles) {
    const xs = lista.filter(Boolean);
    if (!xs.length) return null;
    const x = {};
    for (const k of SUMABLES) x[k] = xs.reduce((t, y) => t + (y[k] || 0), 0);
    return indicadores(x, ha, arboles);
  }

  /* % de variación como en el Excel: 1 − (media de las dos campañas anteriores ÷ real de esta campaña). */
  function variacion(a, b, real) {
    if (a == null || b == null || real == null || !real) return null;
    return 1 - ((a + b) / 2) / real;
  }

  /* ---------- Ajustar el presupuesto a lo real (v1.2.0) ----------
     Solo sube las líneas que lo real ya ha superado; las que siguen por debajo no se tocan.
     Grupos: cada concepto de dinero por separado, «cosecha» (kg y precio juntos) y el arrendamiento.
     Devuelve { cambios: [{ k, valores: {concepto: nuevo}, previos: {concepto: anterior|null}, real }], sinPresupuesto } */
  const AJ_DINERO = ['subvenciones', 'otros_ingresos', 'fertilizantes', 'fitosanitarios', 'agua', 'seguro', 'resto', 'tratamientos', 'poda', 'recoleccion', 'desbroce', 'otras_tareas', 'trituracion', 'otros_gastos'];
  const okv = (n) => n !== null && n !== undefined && n !== '' && isFinite(n);
  function ajusteReal(b, x, p, regla) {
    b = b || {};
    const sinPresupuesto = !Object.keys(b).some((k) => okv(b[k]));
    const cambios = [];
    if (!x) return { cambios, sinPresupuesto };
    const val = (k) => (okv(b[k]) ? Number(b[k]) : 0);
    const prev = (k) => (okv(b[k]) ? Number(b[k]) : null);
    for (const k of AJ_DINERO) {
      if ((x[k] || 0) > val(k) + 0.5) cambios.push({ k, valores: { [k]: Math.round(x[k]) }, previos: { [k]: prev(k) }, real: x[k] });
    }
    // Cosecha = kg × precio: kg reales si son más, y precio subido si el ingreso real de cosecha ya pasa de kg × precio
    const kgN = (x.kg || 0) > val('kg') + 0.5 ? Math.round(x.kg) : val('kg');
    const precioN = kgN > 0 && (x.cosecha || 0) > kgN * val('precio') + 0.5 ? Math.ceil((x.cosecha / kgN) * 1000) / 1000 : val('precio');
    if (kgN !== val('kg') || precioN !== val('precio')) {
      const valores = {}, previos = {};
      if (kgN !== val('kg')) { valores.kg = kgN; previos.kg = prev('kg'); }
      if (precioN !== val('precio')) { valores.precio = precioN; previos.precio = prev('precio'); }
      cambios.push({ k: 'cosecha', valores, previos, real: x.cosecha, realKg: x.kg });
    }
    // Arrendamiento: si ya hay algo pagado y pasa del presupuestado (escrito o estimado con la regla), se escribe lo pagado
    const arr = arrendamientoTras(b, cambios.map((c) => c.k), cambios, x, p, regla);
    if (arr) cambios.push(arr);
    return { cambios, sinPresupuesto };
  }
  /* Presupuesto tras aplicar los grupos elegidos (sin el arrendamiento). */
  function aplicarAjuste(b, cambios, elegidos) {
    const nb = { ...(b || {}) };
    for (const c of cambios) if (c.k !== 'arrendamiento' && elegidos.includes(c.k)) Object.assign(nb, c.valores);
    return nb;
  }
  function arrendamientoTras(b, elegidos, cambios, x, p, regla) {
    if (!x) return null;
    const nb = aplicarAjuste(b, cambios, elegidos);
    const xp = presupuesto(Object.keys(nb).length ? nb : { kg: 0 }, p, regla);
    if ((x.arrendamiento || 0) > 0 && x.arrendamiento > xp.arrendamiento + 0.5) {
      return { k: 'arrendamiento', valores: { arrendamiento: Math.round(x.arrendamiento) }, previos: { arrendamiento: okv(b && b.arrendamiento) ? Number(b.arrendamiento) : null }, real: x.arrendamiento, deEstimado: !okv(b && b.arrendamiento), presupuestado: xp.arrendamiento };
    }
    return null;
  }

  /* ---------- Ritmo de la campaña (v1.2.0) ----------
     Acumulado mes a mes de la campaña y de la anterior, con «la misma fecha» (mismo día y mes un año antes).
     cual: 'cultivo' = gastos sin arrendamiento ni recolección; 'ingresos'.
     Meses: desplazamiento respecto a enero del año de la campaña (−2 = noviembre del año anterior). */
  const ES_CULTIVO = (l) => (l.categoria === 'Gasto' && l.tipo !== 'Arrendamiento') || (l.categoria === 'Tarea' && l.tipo !== 'Recolección');
  const ES_INGRESO = (l) => l.categoria === 'Ingreso';
  const mesDe = (fecha) => Number(String(fecha).slice(0, 4)) * 12 + Number(String(fecha).slice(5, 7)) - 1;
  const menosUnAno = (iso) => (Number(iso.slice(0, 4)) - 1) + iso.slice(4, 10);
  function campanaAbierta(c, hoy) { return hoy < (c + 1) + '-10-01'; }
  function ritmo(lineas, c, finca, cual, hoy) {
    const f = cual === 'ingresos' ? ES_INGRESO : ES_CULTIVO;
    const abierta = campanaAbierta(c, hoy) && hoy >= (c - 1) + '-11-01';
    const corte = abierta ? hoy : null, cortePrev = abierta ? menosUnAno(hoy) : null;
    const porMes = (camp, hasta) => {
      const m = new Map(); let tot = 0;
      for (const l of lineas) {
        if (l.campana !== camp || (finca != null && l.finca !== finca) || !f(l) || !l.fecha) continue;
        if (hasta && l.fecha > hasta) continue;
        const off = Math.max(-3, Math.min(20, mesDe(l.fecha) - camp * 12));
        m.set(off, (m.get(off) || 0) + l.importe); tot += l.importe;
      }
      return { m, tot };
    };
    const cur = porMes(c, corte), prv = porMes(c - 1, null), prvMisma = cortePrev ? porMes(c - 1, cortePrev).tot : prv.tot;
    const hoyOff = abierta ? mesDe(hoy) - c * 12 : null;
    const offs = [...cur.m.keys(), ...prv.m.keys()];
    if (hoyOff !== null) offs.push(hoyOff);
    let a = offs.length ? Math.min(...offs, 0) : 0, z = offs.length ? Math.max(...offs, 11) : 11;
    const meses = [], vc = [], vp = [];
    let sc = 0, sp = 0;
    const finCur = hoyOff !== null ? hoyOff : Math.max(...[...cur.m.keys(), a]);
    for (let o = a; o <= z; o++) {
      meses.push(o);
      sc += cur.m.get(o) || 0; sp += prv.m.get(o) || 0;
      vc.push(o <= finCur ? sc : null); vp.push(sp);
    }
    return { meses, cur: vc, prev: vp, curTot: cur.tot, prevMisma: prvMisma, prevTotal: prv.tot, abierta, hoyOff };
  }

  const api = { SECCIONES, FILAS, ENTRADAS, BASES, FILTRO, real, presupuesto, sumar, variacion, arrendamientoEstimado, lineasConcepto, r2, ajusteReal, aplicarAjuste, arrendamientoTras, ritmo, campanaAbierta };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CU = api;
})(typeof window !== 'undefined' ? window : globalThis);
