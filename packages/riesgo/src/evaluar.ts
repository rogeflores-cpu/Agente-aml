import type {
  ConfiguracionRiesgo,
  Factor,
  Medidas,
  Nivel,
  PerfilEvaluacion,
  Propuesta,
  ReglaImpuesta,
  ResultadoEvaluacion,
  Senal,
} from './tipos.js';

const ORDEN: Record<Nivel, number> = { bajo: 0, medio: 1, alto: 2 };
const maxNivel = (a: Nivel, b: Nivel): Nivel => (ORDEN[a] >= ORDEN[b] ? a : b);
const redondear = (n: number) => Math.round(n * 100) / 100;

export class ConfiguracionInvalida extends Error {}

export function validarConfiguracion(c: ConfiguracionRiesgo): void {
  const suma = Object.values(c.pesosFactores).reduce((a, b) => a + b, 0);
  if (Math.abs(suma - 1) > 1e-9) {
    throw new ConfiguracionInvalida(`Los pesos de los factores suman ${suma}, deben sumar 1`);
  }
  if (!(c.umbrales.medio > 0 && c.umbrales.medio < c.umbrales.alto && c.umbrales.alto <= 100)) {
    throw new ConfiguracionInvalida('Umbrales inválidos: se requiere 0 < medio < alto <= 100');
  }
  if (c.actualizacionMeses.alto > 12) {
    throw new ConfiguracionInvalida('Clientes de riesgo alto: actualización al menos anual (art. 22)');
  }
  if (c.umbralEfectivoUsd > 10000) {
    throw new ConfiguracionInvalida('El umbral de efectivo no puede superar USD 10,000 (art. 31)');
  }
}

/**
 * Calcula la evaluación de riesgo de un expediente. Es determinista: la misma
 * entrada con la misma configuración produce siempre el mismo resultado.
 * No usa inteligencia artificial.
 */
export function evaluar(perfil: PerfilEvaluacion, config: ConfiguracionRiesgo): ResultadoEvaluacion {
  validarConfiguracion(config);
  const detalle: string[] = [];
  const senales: Senal[] = [];
  const reglas: ReglaImpuesta[] = [];
  const situaciones = new Set<string>();
  const pt = (clave: string): number => {
    const v = config.puntos[clave];
    if (v === undefined) throw new ConfiguracionInvalida(`Falta el puntaje '${clave}' en la configuración`);
    return v;
  };
  const brutos: Record<Factor, number> = { cliente: 0, geografia: 0, canal: 0, producto: 0 };
  const sumar = (factor: Factor, clave: string, motivo: string, puntos = pt(clave)) => {
    if (puntos === 0) return;
    brutos[factor] += puntos;
    detalle.push(`${factor}: +${puntos} ${motivo}`);
  };
  const esPersonaJuridica = perfil.tipoPersona !== 'individual';

  // ---------------------------------------------------------------- cliente
  sumar('cliente', `cliente.${perfil.tipoPersona}`, `tipo de persona ${perfil.tipoPersona}`);
  if (perfil.esPep) {
    sumar('cliente', 'cliente.pep', 'persona expuesta políticamente');
    situaciones.add('a');
  } else if (perfil.vinculoPep) {
    sumar('cliente', 'cliente.vinculo_pep', 'pariente o asociado cercano de PEP');
    situaciones.add('a');
  }
  if (perfil.contratistaOProveedorEstado) {
    sumar('cliente', 'cliente.contratista_estado', 'contratista o proveedor del Estado');
    situaciones.add('b');
  }
  if (perfil.sinFinesDeLucro) {
    sumar('cliente', 'cliente.sin_fines_lucro', 'persona jurídica sin fines de lucro');
    situaciones.add('f');
  }
  if (perfil.fideicomiso) {
    sumar('cliente', 'cliente.fideicomiso', 'fideicomiso');
    situaciones.add('g');
  }
  if (perfil.noDomiciliado) {
    sumar('cliente', 'cliente.no_domiciliado', 'sin domicilio en el país');
    situaciones.add('e');
  }
  if (esPersonaJuridica) {
    if (perfil.antiguedadSociedadMeses !== undefined && perfil.antiguedadSociedadMeses < config.sociedadRecienteMeses) {
      sumar('cliente', 'cliente.sociedad_reciente', `sociedad con ${perfil.antiguedadSociedadMeses} meses de constituida`);
      senales.push({
        codigo: 'SOCIEDAD_RECIENTE',
        descripcion: 'Operación a nombre de una sociedad de constitución reciente',
        evidencia: { meses: perfil.antiguedadSociedadMeses },
      });
    }
    if ((perfil.nivelesPropiedad ?? 1) > 2) {
      sumar('cliente', 'cliente.propiedad_compleja', `${perfil.nivelesPropiedad} capas de propiedad`);
    }
    if (!perfil.beneficiarioFinalIdentificado) {
      sumar('cliente', 'cliente.bf_no_identificado', 'beneficiario final no identificado');
      senales.push({ codigo: 'BF_NO_IDENTIFICADO', descripcion: 'No se ha identificado al beneficiario final' });
    }
  }
  if (perfil.actividadEconomica && config.actividades[perfil.actividadEconomica]) {
    sumar('cliente', '', `actividad económica ${perfil.actividadEconomica}`, config.actividades[perfil.actividadEconomica]);
  }
  if (perfil.coherenciaPerfilMonto === 'dudosa') {
    sumar('cliente', 'cliente.perfil_dudoso', 'coherencia dudosa entre perfil y monto');
  } else if (perfil.coherenciaPerfilMonto === 'incoherente') {
    sumar('cliente', 'cliente.perfil_incoherente', 'monto no coherente con el perfil económico');
    senales.push({ codigo: 'PERFIL_INCOHERENTE', descripcion: 'El monto no corresponde al perfil económico declarado' });
  }

  // -------------------------------------------------------------- geografía
  const paisesCliente = [perfil.nacionalidad, perfil.paisResidencia].filter(Boolean) as string[];
  const paisesFondos = perfil.pagos.map((p) => p.paisOrigen).filter(Boolean) as string[];
  const todos = [...new Set([...paisesCliente, ...paisesFondos].map((p) => p.toUpperCase()))];
  const gafiAlto = todos.filter((p) => config.paisesAltoRiesgoGafi.includes(p));
  const gafiMonitoreo = todos.filter((p) => config.paisesMonitoreoGafi.includes(p));
  if (gafiAlto.length) {
    sumar('geografia', 'geografia.gafi_alto_riesgo', `vínculo con país de alto riesgo GAFI: ${gafiAlto.join(', ')}`);
    reglas.push({
      codigo: 'GAFI_ALTO_RIESGO',
      descripcion: `Relación o fondos vinculados a ${gafiAlto.join(', ')}`,
      fundamento: 'Decreto 15-2026, art. 24 ii',
      nivelMinimo: 'alto',
      medidas: 'intensificada',
    });
  } else if (gafiMonitoreo.length) {
    sumar('geografia', 'geografia.gafi_monitoreo', `vínculo con país en monitoreo GAFI: ${gafiMonitoreo.join(', ')}`);
  }
  if (paisesCliente.some((p) => p.toUpperCase() !== 'GT')) {
    sumar('geografia', 'geografia.extranjero', 'nacionalidad o residencia extranjera');
  }
  const depto = perfil.departamentoInmueble?.trim().toLowerCase();
  if (depto && config.departamentos[depto]) {
    sumar('geografia', '', `inmueble en ${perfil.departamentoInmueble}`, config.departamentos[depto]);
  }

  // ------------------------------------------------------------------ canal
  if (!perfil.presencial) {
    sumar('canal', 'canal.no_presencial', 'relación sin presencia física');
    situaciones.add('k');
  }
  if (perfil.intermediario) sumar('canal', 'canal.intermediario', 'interviene un intermediario');
  if (perfil.actuaPorRepresentacion) sumar('canal', 'canal.representacion', 'actúa por medio de representante');

  // ------------------------------------------------------- producto u operación
  sumar('producto', `producto.${perfil.tipoOperacion}`, `operación de ${perfil.tipoOperacion}`);
  const efectivo = perfil.pagos.filter((p) => p.medio === 'efectivo');
  const efectivoPorDia = new Map<string, number>();
  for (const p of efectivo) {
    const dia = p.fecha ?? 'sin_fecha';
    efectivoPorDia.set(dia, (efectivoPorDia.get(dia) ?? 0) + p.montoUsd);
  }
  const maxDiario = Math.max(0, ...efectivoPorDia.values());
  const registroEfectivo = maxDiario >= config.umbralEfectivoUsd;
  if (efectivo.length) {
    sumar('producto', 'producto.efectivo', 'pago total o parcial en efectivo');
    if (registroEfectivo) {
      sumar('producto', 'producto.efectivo_sobre_umbral', `efectivo diario de USD ${redondear(maxDiario)}`);
      situaciones.add('l');
    }
    const fraccionado = [...efectivoPorDia.entries()].some(
      ([dia, total]) =>
        total >= config.umbralEfectivoUsd &&
        efectivo.filter((p) => (p.fecha ?? 'sin_fecha') === dia).every((p) => p.montoUsd < config.umbralEfectivoUsd),
    );
    if (fraccionado) {
      senales.push({
        codigo: 'EFECTIVO_FRACCIONADO',
        descripcion: 'Pagos en efectivo fraccionados que en un día superan el umbral',
        evidencia: { maxDiarioUsd: redondear(maxDiario) },
      });
    }
  }
  if (perfil.pagos.some((p) => !p.pagadorEsCliente)) {
    sumar('producto', 'producto.pago_terceros', 'pagos realizados por terceros');
    senales.push({ codigo: 'PAGO_TERCEROS', descripcion: 'Uno o más pagos los realiza un tercero distinto del cliente' });
  }
  if (perfil.pagos.some((p) => p.medio === 'transferencia_exterior')) {
    sumar('producto', 'producto.transferencia_exterior', 'fondos transferidos desde el exterior');
  }
  if (perfil.pagos.some((p) => p.medio === 'activos_virtuales')) {
    sumar('producto', 'producto.activos_virtuales', 'pago con activos virtuales');
  }
  if (perfil.precioUsd && perfil.valorReferenciaUsd) {
    const desviacion = Math.abs(perfil.precioUsd - perfil.valorReferenciaUsd) / perfil.valorReferenciaUsd;
    if (desviacion >= config.desviacionPrecio) {
      sumar('producto', 'producto.precio_desviado', `precio ${Math.round(desviacion * 100)} % distinto al valor de referencia`);
      senales.push({
        codigo: 'PRECIO_DESVIADO',
        descripcion: 'Precio muy distinto al valor de referencia del inmueble',
        evidencia: { precioUsd: perfil.precioUsd, valorReferenciaUsd: perfil.valorReferenciaUsd },
      });
    }
  }
  if (perfil.parte === 'vendedor' && perfil.diasDesdeAdquisicion !== undefined
      && perfil.diasDesdeAdquisicion < config.reventaRapidaDias) {
    sumar('producto', 'producto.reventa_rapida', `reventa a los ${perfil.diasDesdeAdquisicion} días de adquirido`);
    senales.push({ codigo: 'REVENTA_RAPIDA', descripcion: 'Reventa del inmueble poco tiempo después de adquirido' });
  }

  // ---------------------------------------------------------------- puntaje
  const puntajes = Object.fromEntries(
    (Object.keys(brutos) as Factor[]).map((f) => [f, Math.min(100, brutos[f])]),
  ) as Record<Factor, number>;
  const puntajeTotal = redondear(
    (Object.keys(puntajes) as Factor[]).reduce((s, f) => s + puntajes[f] * config.pesosFactores[f], 0),
  );
  const nivelPorPuntaje: Nivel =
    puntajeTotal >= config.umbrales.alto ? 'alto' : puntajeTotal >= config.umbrales.medio ? 'medio' : 'bajo';
  detalle.push(`total ponderado: ${puntajeTotal} → nivel ${nivelPorPuntaje}`);

  // ---------------------------------------------------- reglas que se imponen
  if (perfil.esPep || perfil.vinculoPep) {
    reglas.push({
      codigo: 'PEP',
      descripcion: 'Medidas adicionales por PEP o vínculo con PEP',
      fundamento: 'Decreto 15-2026, art. 25 a',
      nivelMinimo: config.nivelMinimoPep,
      medidas: 'intensificada',
    });
  }
  if (perfil.parte === 'comprador' && !perfil.origenFondosDeclarado) {
    reglas.push({
      codigo: 'SIN_ORIGEN_FONDOS',
      descripcion: 'El comprador no ha declarado ni soportado el origen de los fondos',
      fundamento: 'Decreto 15-2026, art. 21 numeral 5',
    });
  }
  const ddcIncompleta = !perfil.ddcCompleta || (perfil.parte === 'comprador' && !perfil.origenFondosDeclarado);
  if (ddcIncompleta) {
    reglas.push({
      codigo: 'DDC_INCOMPLETA',
      descripcion: 'No ha sido posible completar la debida diligencia',
      fundamento: 'Decreto 15-2026, art. 22 (abstención y examen para posible RTS)',
    });
  }
  if (perfil.transaccionInusual) {
    reglas.push({
      codigo: 'TRANSACCION_INUSUAL',
      descripcion: 'Transacción inusual identificada: no procede la debida diligencia simplificada',
      fundamento: 'Decreto 15-2026, arts. 23 y 29',
      medidas: 'estandar',
    });
  }
  if (perfil.coincidenciaOnu === 'confirmada') {
    reglas.push({
      codigo: 'ONU_CONFIRMADA',
      descripcion: 'Coincidencia confirmada con listas del Consejo de Seguridad de la ONU. Limitar disposición de fondos bajo administración y comunicar por escrito al Ministerio Público en un plazo que no exceda 24 horas',
      fundamento: 'Decreto 15-2026, art. 43',
      nivelMinimo: 'alto',
      medidas: 'intensificada',
      bloqueo: true,
    });
  } else if (perfil.coincidenciaOnu === 'posible') {
    reglas.push({
      codigo: 'ONU_POSIBLE',
      descripcion: 'Posible coincidencia con listas de la ONU pendiente de disposición por el oficial',
      fundamento: 'Decreto 15-2026, art. 43',
    });
  }

  let nivel = nivelPorPuntaje;
  for (const r of reglas) if (r.nivelMinimo) nivel = maxNivel(nivel, r.nivelMinimo);
  if (nivel !== nivelPorPuntaje) detalle.push(`nivel elevado a ${nivel} por reglas: ${reglas.filter((r) => r.nivelMinimo).map((r) => r.codigo).join(', ')}`);

  // ----------------------------------------------------------------- medidas
  const ordenMedidas: Medidas[] = ['simplificada', 'estandar', 'intensificada'];
  let medidas: Medidas =
    nivel === 'alto' ? 'intensificada' : nivel === 'medio' ? 'estandar' : 'simplificada';
  if (medidas === 'simplificada' && (!config.permitirSimplificada || situaciones.size > 0)) medidas = 'estandar';
  for (const r of reglas) {
    if (r.medidas && ordenMedidas.indexOf(r.medidas) > ordenMedidas.indexOf(medidas)) medidas = r.medidas;
  }

  // --------------------------------------------------------------- propuesta
  let propuesta: Propuesta = 'listo_para_decision';
  if (perfil.coincidenciaOnu === 'confirmada') propuesta = 'bloquear_y_comunicar_mp';
  else if (perfil.coincidenciaOnu === 'posible') propuesta = 'resolver_coincidencia';
  else if (ddcIncompleta) propuesta = 'proponer_abstencion';

  return {
    configuracionVersion: config.version,
    puntajes,
    puntajeTotal,
    nivelPorPuntaje,
    nivel,
    medidas,
    reglas,
    senales,
    situacionesEspeciales: [...situaciones].sort(),
    registroEfectivo: { requerido: registroEfectivo, totalMaximoDiarioUsd: redondear(maxDiario) },
    proximaActualizacionMeses: config.actualizacionMeses[nivel],
    propuesta,
    detalle,
  };
}
