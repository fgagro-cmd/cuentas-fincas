# Cuentas fincas

App para el móvil y el ordenador con la cuenta de resultados y los presupuestos de mis fincas propias. Sustituye a las pestañas «Presupuesto y resultados» del Excel Gestion_de_fincas_3.0. Funciona sin conexión con los últimos datos leídos.

- **Dashboard** (primera pestaña, desde la v1.2.0): por campaña y finca (o explotación). Ritmo de la campaña: gasto de cultivo (sin arrendamiento ni recolección) e ingresos acumulados mes a mes frente a la campaña anterior a la misma fecha, con la línea del presupuesto. Evolución por campaña: ingresos y gastos, resultado, precio medio y coste de producción (€/kg, sin la campaña en curso) y producción total en kg con cada finca en su color (desde la v1.3.0; antes kg/ha); la campaña en curso lleva el presupuesto como contorno. Ranking de fincas por resultado, margen, €/ha, coste €/kg o kg/ha, en real o en presupuesto. Toca un gráfico para ver los valores.
- **Gráficos** (v1.3.0): por campaña y finca (o explotación), lo real. Sin recolección ni arrendamiento (v1.3.1). Importe por tarea en %; tareas por tipo de mano de obra (contratadas, con maquinaria y sin maquinaria) en horas o importe, con tabla de horas, importe y €/h; gasto en insumos en %; horas por tarea en %; horas por mes y tipo de tarea (barras apiladas) con los meses de más trabajo. Las horas son la cantidad de cada tarea; las tareas anotadas solo con importe no suman horas. Cada finca y cada tipo de tarea llevan siempre el mismo color.
- **Resultados:** como la pestaña del Excel, por campaña y finca (o la explotación completa). Columnas: las dos campañas anteriores, presupuesto, real y % de variación. Filas: ingresos, gastos por tipo, balance y otros indicadores. Toca una cifra para ver las líneas que la forman.
- **Fincas:** una campaña con todas las fincas una al lado de otra, en real o en presupuesto.
- **Presupuesto:** por finca y campaña. Se guarda solo al cambiar cada cifra. El arrendamiento se estima con la regla de cada finca y se puede escribir a mano. Botones para rellenar con lo real o copiar el presupuesto de la campaña anterior.
  - **Ajustar a lo real** (v1.2.0): iguala a lo real las líneas del presupuesto de la campaña que lo real ya ha superado (redondeado al euro); las que siguen por debajo no se tocan. Muestra por finca qué cambia (de → a) y el resultado presupuestado antes y después; se marcan las que se quieran. Cosecha: kg reales si son más, y precio subido si el ingreso real de cosecha ya pasa de kg × precio. Arrendamiento: si ya hay algo pagado y supera lo presupuestado (escrito o estimado), se escribe lo pagado. Las fincas sin presupuesto salen desmarcadas. «Deshacer el último ajuste» deja las casillas como estaban.

## De dónde salen los datos
- **Líneas:** pestaña «Tabla principal» de la hoja de Google de Gestión fincas (la escribe la app Gestión fincas: histórico del Excel + lo que anotas).
- **Presupuestos y parámetros:** pestañas «Presupuestos» y «Parámetros» de esa misma hoja (las escribe esta app).
- **Superficie y árboles:** «Maestro de fincas» (Drive › Apps › Maestros), fincas con Propia = Sí.
- El código no lleva datos (el repositorio es público).

## Cálculos (los mismos del Excel)
- Fertilizantes incluye bioestimulantes; fitosanitarios incluye herbicidas; seguro = gastos de tipo «Seguro» (desde la v1.1.0, dentro de insumos; resta en el arrendamiento de las fincas cuya regla resta insumos: Pomelos Herrero, Limoneros Herrero y Finca Cortijo); resto = combustible + material de riego + enmienda orgánica.
- Tratamientos = fumigación + herbicida (tareas); desbroce = desbrozar + labrar; otras tareas = estiércol + otras + mejoras + mantenimiento.
- Mano de obra propia = horas de tareas con y sin maquinaria × €/h (8 €/h, en Ajustes). Amortización de maquinaria = importe de esas tareas − mano de obra propia.
- % var. = 1 − (media de las dos campañas anteriores ÷ real).
- Presupuesto: mejoras = 10 % de las tareas; amortización = 60 % de (tratamientos + desbroce + otras tareas); mano de obra contratada = poda + recolección.
- Arrendamiento estimado (Ajustes → Parámetros): % sobre (cosecha − recolección − insumos − poda), (cosecha − recolección) o (ingresos − insumos − mano de obra contratada).

## Conectar
Ajustes → Hoja de Gestión fincas → la misma dirección (termina en `/exec`) y clave que la copia automática de Gestión fincas → «Probar y conectar». El script de esa hoja tiene que ser el nuevo (versión con «Tabla principal»; ver el README de Gestión fincas).

## Publicar (GitHub Pages)
Settings → Pages → rama `main`, carpeta `/ (root)`. En el móvil: abrir la dirección en Edge → ⋮ → «Añadir a la pantalla de inicio». En el ordenador: abrir la dirección y, si quieres, instalarla desde el icono de la barra de direcciones.

## Actualizaciones
Al cambiar cualquier fichero, sube `VERSION` en `sw.js` para que los aparatos recojan la nueva versión.
