import {
  aplicarListaGafi,
  configuracionBaseInmobiliaria,
  evaluar,
  type PerfilEvaluacion,
} from '@agente-aml/riesgo';
import type { Aviso, Dato, DetalleExpediente, FilaOperacion, Fuente, Nivel, Rol } from './tipos';
import { ROLES_CUMPLIMIENTO } from './tipos';
import { enmascararEstado, validarOperacion, validarPagoEfectivo } from './validacion';

/**
 * Fuente de demostración: datos ficticios en memoria y el motor de riesgo
 * real. Sirve para presentar la consola sin conectar Supabase. Ningún nombre
 * corresponde a una persona real.
 */
const ORG = 'org-demo';
const hace = (horas: number) => new Date(Date.now() - horas * 3_600_000).toISOString();
const hash = (n: number) => Array.from({ length: 64 }, (_, i) => '0123456789abcdef'[(n * 7 + i * 13) % 16]).join('');
const dato = (campo: string, valor: unknown, origen: Dato['origen'] = 'cliente', extra: Partial<Dato> = {}): Dato => ({
  campo, valor, origen, documentoId: null, pagina: null, confianza: null, confirmado: true, ...extra,
});
const deDoc = (campo: string, valor: unknown, documentoId: string, confianza = 0.96, confirmado = true): Dato =>
  dato(campo, valor, 'documento', { documentoId, pagina: 1, confianza, confirmado });

const perfilBase = (p: Partial<PerfilEvaluacion>): PerfilEvaluacion => ({
  parte: 'comprador', tipoPersona: 'individual', esPep: false, vinculoPep: false, contratistaOProveedorEstado: false,
  sinFinesDeLucro: false, fideicomiso: false, noDomiciliado: false, beneficiarioFinalIdentificado: true,
  nacionalidad: 'GT', paisResidencia: 'GT', departamentoInmueble: 'Guatemala', presencial: false, intermediario: false,
  actuaPorRepresentacion: false, tipoOperacion: 'compraventa', pagos: [], origenFondosDeclarado: true, ddcCompleta: true,
  transaccionInusual: false, coincidenciaOnu: 'ninguna', ...p,
});

function crearDatos(): { expedientes: DetalleExpediente[]; perfiles: Record<string, PerfilEvaluacion>; avisos: Aviso[] } {
  const base = {
    organizacionId: ORG, verificacionDiferidaHasta: null, evaluaciones: [], decisiones: [], alertas: [], bloqueos: [], bloqueosRelacionados: [], pendientes: [],
  };
  const opA = { tipo: 'compraventa', precio: 1540000, moneda: 'GTQ', inmueble: { departamento: 'Sacatepéquez', municipio: 'Antigua Guatemala', finca: '18,452 folio 210 libro 98' }, formaPago: [{ medio: 'financiamiento_bancario', monto: 1232000 }, { medio: 'transferencia_local', monto: 308000 }] };

  const A: DetalleExpediente = {
    ...base, id: 'exp-a', codigoOperacion: 'OP-2026-00014', parte: 'comprador', tipoPersona: 'individual', estado: 'listo_para_decision',
    contacto: { nombre: 'Ana Lucía Pérez Gómez', telefono: '+502 5555 0101', correo: null, whatsappVinculado: true },
    operacion: opA,
    datos: [
      deDoc('cliente.nombre_completo', 'Ana Lucía Pérez Gómez', 'doc-a1', 0.98),
      deDoc('cliente.documento_numero', '2345 67890 0101', 'doc-a1', 0.97),
      dato('cliente.documento_tipo', 'DPI'),
      deDoc('cliente.fecha_nacimiento', '1985-04-12', 'doc-a1', 0.95),
      dato('cliente.nacionalidad', 'guatemalteca'),
      dato('cliente.estado_civil', 'casado'),
      dato('cliente.profesion', 'Médica pediatra'),
      dato('cliente.actividad_economica', 'Consulta privada y Hospital Privado Ficticio'),
      dato('cliente.ingresos_rango', 'Q30,001 a Q75,000'),
      dato('cliente.cargo_publico', 'no'),
      dato('cliente.familiar_cargo_publico', 'no'),
      deDoc('cliente.direccion_residencia', '12 calle 3-45 zona 14, Guatemala', 'doc-a2', 0.91),
      dato('relacion.proposito', 'Vivienda familiar'),
      dato('origen_fondos.descripcion', 'Préstamo hipotecario (80 %) y ahorros personales (20 %)'),
      dato('origen_fondos.forma_pago', 'Transferencia desde banco del sistema y desembolso del préstamo'),
      dato('origen_fondos.pagador', 'el cliente'),
    ],
    documentos: [
      { id: 'doc-a1', tipo: 'dpi', estado: 'confirmado', canal: 'whatsapp', sha256: hash(1), creadoEn: hace(30) },
      { id: 'doc-a2', tipo: 'recibo_servicio', estado: 'extraido', canal: 'whatsapp', sha256: hash(2), creadoEn: hace(29) },
      { id: 'doc-a3', tipo: 'nit_rtu', estado: 'extraido', canal: 'web', sha256: hash(3), creadoEn: hace(26) },
      { id: 'doc-a4', tipo: 'soporte_origen_fondos', estado: 'extraido', canal: 'web', sha256: hash(4), creadoEn: hace(25) },
    ],
    verificaciones: [{
      id: 'ver-a1', nombreConsultado: 'Ana Lucía Pérez Gómez', fuente: 'onu', versionFuente: '2026-11-15', consultadoEn: hace(3),
      resultado: 'posible_coincidencia', justificacion: null, dispuestoEn: null,
      coincidencias: [{ referencia: 'XXi.204', lista: 'Ejemplo', nombreListado: 'ANA LUCIA PERES', nombreCoincidente: 'ANA LUCIA PERES', puntaje: 0.912, fechaNacimiento: 'difiere', prioridad: 'normal' }],
    }],
    bitacora: [],
  };

  const B: DetalleExpediente = {
    ...base, id: 'exp-b', codigoOperacion: 'OP-2026-00014', parte: 'vendedor', tipoPersona: 'individual', estado: 'en_revision',
    contacto: { nombre: 'Luis Fernando Gómez Ramírez', telefono: null, correo: 'lgomez@example.com', whatsappVinculado: false },
    operacion: opA,
    datos: [
      dato('cliente.nombre_completo', 'Luis Fernando Gómez Ramírez'),
      dato('cliente.documento_tipo', 'DPI'),
      dato('cliente.documento_numero', '1987 65432 0101'),
      dato('relacion.proposito', 'Cambio de residencia al extranjero'),
      deDoc('doc.certificacion_registral.propietarios', ['MARTA ELENA SOTO DE LEON'], 'doc-b2', 0.93),
      deDoc('doc.certificacion_registral.fecha_emision', '2026-11-02', 'doc-b2', 0.97),
    ],
    documentos: [
      { id: 'doc-b1', tipo: 'dpi', estado: 'extraido', canal: 'web', sha256: hash(5), creadoEn: hace(50) },
      { id: 'doc-b2', tipo: 'certificacion_registral', estado: 'extraido', canal: 'web', sha256: hash(6), creadoEn: hace(48) },
    ],
    pendientes: [{ id: 'pen-b1', tipo: 'aclaracion', estado: 'abierto', descripcion: 'El inmueble aparece inscrito a nombre de otra persona. ¿Puede explicar su relación con el propietario registral?' }],
    verificaciones: [{ id: 'ver-b1', nombreConsultado: 'Luis Fernando Gómez Ramírez', fuente: 'onu', versionFuente: '2026-11-15', consultadoEn: hace(47), resultado: 'sin_coincidencia', coincidencias: [], justificacion: null, dispuestoEn: null }],
    alertas: [{ id: 'al-b1', senal: 'REVENTA_RAPIDA', descripcion: 'Reventa del inmueble poco tiempo después de adquirido', estado: 'abierta', venceEn: null, creadoEn: hace(40), cierre: null }],
    bitacora: [],
  };

  const C: DetalleExpediente = {
    ...base, id: 'exp-c', codigoOperacion: 'OP-2026-00015', parte: 'comprador', tipoPersona: 'juridica', estado: 'listo_para_decision',
    contacto: { nombre: 'Inversiones Altamira, S.A.', telefono: '+502 5555 0303', correo: 'gerencia@altamira.example', whatsappVinculado: true },
    operacion: { tipo: 'compraventa', precio: 3850000, moneda: 'GTQ', inmueble: { departamento: 'Guatemala', municipio: 'Mixco' }, formaPago: [{ medio: 'transferencia_exterior', monto: 3850000 }] },
    datos: [
      deDoc('entidad.razon_social', 'Inversiones Altamira, Sociedad Anónima', 'doc-c1'),
      dato('entidad.tipo', 'sociedad anónima'),
      deDoc('entidad.nit', '9876543-2', 'doc-c3'),
      deDoc('entidad.fecha_constitucion', '2026-07-20', 'doc-c2', 0.94),
      dato('entidad.lugar_constitucion', 'GT'),
      dato('entidad.actividad', 'Inversiones inmobiliarias'),
      dato('representante.nombre_completo', 'Roberto Andrés Cifuentes Mejía'),
      dato('beneficiarios_finales', [{ nombre: 'Roberto Andrés Cifuentes Mejía', porcentaje: 60 }, { nombre: 'Holding Pacífico Ltd.', porcentaje: 40 }]),
      dato('relacion.proposito', 'Inversión para arrendamiento'),
      dato('origen_fondos.descripcion', 'Aporte de capital de accionista extranjero'),
      dato('origen_fondos.pagador', 'otra persona o empresa'),
      dato('origen_fondos.pagador_identificacion', 'Holding Pacífico Ltd., accionista, cuenta en el exterior'),
    ],
    documentos: [
      { id: 'doc-c1', tipo: 'patente_sociedad', estado: 'extraido', canal: 'web', sha256: hash(7), creadoEn: hace(70) },
      { id: 'doc-c2', tipo: 'escritura_constitutiva', estado: 'extraido', canal: 'web', sha256: hash(8), creadoEn: hace(70) },
      { id: 'doc-c3', tipo: 'nit_rtu', estado: 'extraido', canal: 'web', sha256: hash(9), creadoEn: hace(69) },
      { id: 'doc-c4', tipo: 'nombramiento_representante', estado: 'extraido', canal: 'web', sha256: hash(10), creadoEn: hace(69) },
      { id: 'doc-c5', tipo: 'registro_accionistas', estado: 'extraido', canal: 'web', sha256: hash(11), creadoEn: hace(68) },
      { id: 'doc-c6', tipo: 'soporte_origen_fondos', estado: 'extraido', canal: 'web', sha256: hash(12), creadoEn: hace(66) },
    ],
    verificaciones: [
      { id: 'ver-c1', nombreConsultado: 'Inversiones Altamira, Sociedad Anónima', fuente: 'onu', versionFuente: '2026-11-15', consultadoEn: hace(65), resultado: 'sin_coincidencia', coincidencias: [], justificacion: null, dispuestoEn: null },
      { id: 'ver-c2', nombreConsultado: 'Roberto Andrés Cifuentes Mejía', fuente: 'onu', versionFuente: '2026-11-15', consultadoEn: hace(65), resultado: 'sin_coincidencia', coincidencias: [], justificacion: null, dispuestoEn: null },
    ],
    bitacora: [],
  };

  const D: DetalleExpediente = {
    ...base, id: 'exp-d', codigoOperacion: 'OP-2026-00012', parte: 'comprador', tipoPersona: 'individual', estado: 'aprobado',
    contacto: { nombre: 'Carlos Enrique Morales Díaz', telefono: '+502 5555 0404', correo: null, whatsappVinculado: true },
    operacion: { tipo: 'compraventa', precio: 920000, moneda: 'GTQ', inmueble: { departamento: 'Guatemala', municipio: 'Guatemala' }, formaPago: [{ medio: 'financiamiento_bancario', monto: 920000 }] },
    datos: [dato('cliente.nombre_completo', 'Carlos Enrique Morales Díaz'), dato('cliente.documento_tipo', 'DPI'), dato('cliente.documento_numero', '3012 45678 0101')],
    documentos: [{ id: 'doc-d1', tipo: 'dpi', estado: 'confirmado', canal: 'whatsapp', sha256: hash(13), creadoEn: hace(200) }],
    verificaciones: [{ id: 'ver-d1', nombreConsultado: 'Carlos Enrique Morales Díaz', fuente: 'onu', versionFuente: '2026-11-10', consultadoEn: hace(199), resultado: 'sin_coincidencia', coincidencias: [], justificacion: null, dispuestoEn: null }],
    evaluaciones: [{ id: 'ev-d1', calculadoEn: hace(150), puntajes: { cliente: 10, geografia: 0, canal: 35, producto: 15 }, puntajeTotal: 13.0, nivelCalculado: 'bajo', nivelAjustado: null, justificacionAjuste: null, medidas: 'estandar', reglas: [], senales: [] }],
    decisiones: [{ id: 'dec-d1', tipo: 'aprobar', justificacion: 'Debida diligencia completa, financiamiento bancario y perfil coherente con el monto.', condiciones: null, decididoEn: hace(140), decididoPor: 'Oficial de cumplimiento (demo)' }],
    bitacora: [],
  };

  const E: DetalleExpediente = {
    ...base, id: 'exp-e', codigoOperacion: 'OP-2026-00016', parte: 'comprador', tipoPersona: 'individual', estado: 'en_captura',
    contacto: { nombre: 'María José Castillo Herrera', telefono: '+502 5555 0505', correo: null, whatsappVinculado: true },
    operacion: { tipo: 'intermediacion', precio: 650000, moneda: 'GTQ', inmueble: { departamento: 'Quetzaltenango' }, formaPago: [] },
    datos: [dato('cliente.nombre_completo', 'María José Castillo Herrera')],
    documentos: [],
    pendientes: [
      { id: 'pen-e1', tipo: 'faltante', estado: 'abierto', descripcion: 'DPI (ambos lados)' },
      { id: 'pen-e2', tipo: 'faltante', estado: 'abierto', descripcion: 'Origen de los fondos' },
      { id: 'pen-e3', tipo: 'faltante', estado: 'abierto', descripcion: 'Documento que respalde el origen de los fondos' },
    ],
    verificaciones: [],
    bitacora: [],
  };

  const expedientes = [A, B, C, D, E];
  let n = 0;
  for (const e of expedientes) {
    const eventos = [
      ['sistema', 'insert', 'expedientes'], ['cliente', 'insert', 'datos_expediente'], ['cliente', 'insert', 'documentos'],
      ['agente', 'insert', 'datos_expediente'], ['sistema', 'insert', 'verificaciones'],
    ] as const;
    e.bitacora = eventos.map(([actor, evento, entidad], i) => ({ id: ++n, ocurridoEn: hace(80 - i * 6), actorTipo: actor, evento, entidad, hash: hash(n + 40) })).reverse();
  }

  const perfiles: Record<string, PerfilEvaluacion> = {
    'exp-a': perfilBase({ precioUsd: 200000, valorReferenciaUsd: 195000, departamentoInmueble: 'Sacatepéquez',
      pagos: [{ medio: 'financiamiento_bancario', montoUsd: 160000, pagadorEsCliente: true }, { medio: 'transferencia_local', montoUsd: 40000, pagadorEsCliente: true }] }),
    'exp-b': perfilBase({ parte: 'vendedor', diasDesdeAdquisicion: 140, pagos: [], ddcCompleta: false }),
    'exp-c': perfilBase({ tipoPersona: 'juridica', antiguedadSociedadMeses: 3, nivelesPropiedad: 2, precioUsd: 500000,
      pagos: [{ medio: 'transferencia_exterior', montoUsd: 500000, pagadorEsCliente: false, paisOrigen: 'PA' }] }),
    'exp-d': perfilBase({ precioUsd: 119480, pagos: [{ medio: 'financiamiento_bancario', montoUsd: 119480, pagadorEsCliente: true }] }),
    'exp-e': perfilBase({ tipoOperacion: 'intermediacion', origenFondosDeclarado: false, ddcCompleta: false }),
  };

  const avisos: Aviso[] = [
    { id: 'av1', asunto: 'Posible coincidencia en lista de la ONU', cuerpo: 'Ana Lucía Pérez Gómez: 1 posible coincidencia. Disponer antes de continuar.', prioridad: 'alta', expedienteId: 'exp-a', creadaEn: hace(3), leida: false },
    { id: 'av2', asunto: 'Expediente listo para decisión', cuerpo: 'Inversiones Altamira, S.A. completó su información.', prioridad: 'normal', expedienteId: 'exp-c', creadaEn: hace(60), leida: false },
    { id: 'av3', asunto: 'Actualización de cliente próxima', cuerpo: 'Un cliente de riesgo alto debe actualizarse antes del 15/12/2026.', prioridad: 'normal', expedienteId: null, creadaEn: hace(120), leida: true },
  ];

  // Evaluación inicial del caso C para mostrar el resultado del motor
  const rC = evaluar(perfiles['exp-c'], configuracionBaseInmobiliaria);
  C.evaluaciones = [{ id: 'ev-c1', calculadoEn: hace(60), puntajes: rC.puntajes, puntajeTotal: rC.puntajeTotal, nivelCalculado: rC.nivel, nivelAjustado: null, justificacionAjuste: null, medidas: rC.medidas, reglas: rC.reglas, senales: rC.senales }];
  C.alertas = rC.senales.map((s, i) => ({ id: `al-c${i}`, senal: s.codigo, descripcion: s.descripcion, estado: 'abierta', venceEn: null, creadoEn: hace(60), cierre: null }));

  return { expedientes, perfiles, avisos };
}

export function fuenteDemo(): Fuente {
  const estado = crearDatos();
  let sesion: { usuarioId: string; correo: string } | null = null;
  let rol: Rol = 'oficial';
  /** Como la RLS real: los roles operativos no leen ni actúan sobre datos de cumplimiento. */
  const exigirCumplimiento = () => {
    if (!ROLES_CUMPLIMIENTO.includes(rol)) throw new Error('Sin permiso: información reservada a cumplimiento');
  };
  const avisosOperativos: Aviso[] = [
    { id: 'avo1', asunto: 'Cliente sin completar su información', cuerpo: 'María José Castillo Herrera no ha completado su expediente después de 3 recordatorios.', prioridad: 'normal', expedienteId: null, creadaEn: hace(20), leida: false },
  ];
  const pagosEfectivo: { expedienteId: string; fecha: string; montoUsd: number }[] = [];
  let correlativo = 16;
  const buscar = (id: string) => {
    const e = estado.expedientes.find((x) => x.id === id);
    if (!e) throw new Error('Expediente no encontrado');
    return e;
  };
  const registrar = (e: DetalleExpediente, evento: string, entidad: string) => {
    const id = Math.max(0, ...estado.expedientes.flatMap((x) => x.bitacora.map((b) => b.id))) + 1;
    e.bitacora.unshift({ id, ocurridoEn: new Date().toISOString(), actorTipo: 'usuario', evento, entidad, hash: hash(id + 40) });
  };
  const exigirTexto = (t: string, que: string) => {
    if (t.trim().length < 20) throw new Error(`${que}: escriba al menos 20 caracteres`);
  };
  const copia = <T>(x: T): T => structuredClone(x);
  const nivelVigente = (e: DetalleExpediente): Nivel | null => e.evaluaciones[0] ? (e.evaluaciones[0].nivelAjustado ?? e.evaluaciones[0].nivelCalculado) : null;

  return {
    modoDemo: true,
    async sesion() { return sesion; },
    async iniciarSesion(correo, _clave, rolDemo) {
      rol = rolDemo ?? 'oficial';
      sesion = { usuarioId: `${rol}-demo`, correo: correo || `${rol}@demo.example` };
    },
    async cerrarSesion() { sesion = null; },
    async organizaciones() { return [{ id: ORG, nombre: 'Inmobiliaria Demostración', rol }]; },

    async bandeja() {
      exigirCumplimiento();
      return estado.expedientes.map((e) => ({
        id: e.id, codigoOperacion: e.codigoOperacion, parte: e.parte, tipoPersona: e.tipoPersona, nombre: e.contacto.nombre,
        estado: e.estado, nivel: nivelVigente(e), pendientes: e.pendientes.filter((p) => p.estado === 'abierto').length,
        coincidenciasSinDisponer: e.verificaciones.filter((v) => v.resultado === 'posible_coincidencia').length,
        alertasAbiertas: e.alertas.filter((a) => a.estado !== 'cerrada').length,
        actualizadoEn: e.bitacora[0]?.ocurridoEn ?? hace(1),
      }));
    },
    async expediente(id) { exigirCumplimiento(); return copia(buscar(id)); },
    async avisos() { return copia(ROLES_CUMPLIMIENTO.includes(rol) ? estado.avisos : avisosOperativos); },
    async marcarLeido(id) { const a = [...estado.avisos, ...avisosOperativos].find((x) => x.id === id); if (a) a.leida = true; },

    async evaluar(id, ajustes) {
      exigirCumplimiento();
      const e = buscar(id);
      const onu = e.verificaciones.filter((v) => v.fuente === 'onu');
      const perfil: PerfilEvaluacion = {
        ...estado.perfiles[id],
        presencial: ajustes.presencial ?? false,
        intermediario: ajustes.intermediario ?? false,
        actuaPorRepresentacion: ajustes.actuaPorRepresentacion ?? false,
        contratistaOProveedorEstado: ajustes.contratistaOProveedorEstado ?? false,
        noDomiciliado: ajustes.noDomiciliado ?? false,
        coherenciaPerfilMonto: ajustes.coherenciaPerfilMonto,
        transaccionInusual: ajustes.transaccionInusual ?? false,
        coincidenciaOnu: onu.some((v) => v.resultado === 'coincidencia_confirmada') ? 'confirmada'
          : onu.some((v) => v.resultado === 'posible_coincidencia') ? 'posible' : 'ninguna',
        ddcCompleta: estado.perfiles[id].ddcCompleta && e.pendientes.every((p) => p.estado !== 'abierto') && onu.length > 0,
      };
      const r = evaluar(perfil, aplicarListaGafi(configuracionBaseInmobiliaria, { plenario: '2026-10-30', altoRiesgo: [], monitoreo: [] }));
      e.evaluaciones.unshift({
        id: `ev-${Date.now()}`, calculadoEn: new Date().toISOString(), puntajes: r.puntajes, puntajeTotal: r.puntajeTotal,
        nivelCalculado: r.nivel, nivelAjustado: null, justificacionAjuste: null, medidas: r.medidas, reglas: r.reglas, senales: r.senales,
      });
      for (const s of r.senales) {
        if (!e.alertas.some((a) => a.senal === s.codigo && a.estado !== 'cerrada')) {
          e.alertas.unshift({ id: `al-${Date.now()}-${s.codigo}`, senal: s.codigo, descripcion: s.descripcion, estado: 'abierta', venceEn: null, creadoEn: new Date().toISOString(), cierre: null });
        }
      }
      registrar(e, 'insert', 'evaluaciones_riesgo');
      const advertencias = [
        ...(onu.length ? [] : ['No hay cotejo con la lista de la ONU registrado para este expediente.']),
        ...(e.pendientes.some((p) => p.estado === 'abierto') ? [`Hay ${e.pendientes.filter((p) => p.estado === 'abierto').length} pendiente(s) abiertos en el expediente.`] : []),
        ...(estado.perfiles[id].ddcCompleta ? [] : ['La debida diligencia no está completa.']),
      ];
      return { advertencias };
    },

    async disponer(id, resultado, justificacion) {
      exigirCumplimiento();
      exigirTexto(justificacion, 'Justificación');
      const e = estado.expedientes.find((x) => x.verificaciones.some((v) => v.id === id))!;
      const v = e.verificaciones.find((x) => x.id === id)!;
      if (v.resultado !== 'posible_coincidencia') throw new Error('La verificación ya fue dispuesta');
      Object.assign(v, { resultado, justificacion, dispuestoEn: new Date().toISOString() });
      if (resultado === 'coincidencia_confirmada') {
        e.alertas.unshift({
          id: `al-onu-${v.id}`, senal: 'ONU_CONFIRMADA', estado: 'abierta', creadoEn: new Date().toISOString(), cierre: null,
          descripcion: 'Coincidencia confirmada con lista del Consejo de Seguridad (art. 43). Quedó un bloqueo preventivo sobre la persona. Comunique al Ministerio Público dentro de 24 horas y registre la comunicación.',
          venceEn: new Date(new Date(v.consultadoEn).getTime() + 24 * 3_600_000).toISOString(),
        });
        // Igual que la base: bloqueo preventivo en la misma operación
        e.bloqueos.unshift({
          id: `bl-${v.id}`, fuente: v.fuente, nombre: v.nombreConsultado, detectadaEn: v.consultadoEn, creadoEn: new Date().toISOString(),
          comunicadoMpEn: null, comunicacionReferencia: null, comunicacionDentroPlazo: null,
          levantadoEn: null, levantamientoMotivo: null, levantamientoReferencia: null,
        });
      }
      registrar(e, 'update', 'verificaciones');
    },

    async decidir(id, d) {
      exigirCumplimiento();
      exigirTexto(d.justificacion, 'Justificación');
      if (rol === 'oficial_suplente' && (d.motivoSuplencia ?? '').trim().length < 10) {
        throw new Error('Como oficial suplente, indique el motivo por el que decide en lugar del titular.');
      }
      const e = buscar(id);
      const aprueba = d.tipo === 'aprobar' || d.tipo === 'aprobar_diferida';
      if (aprueba && e.verificaciones.some((v) => v.resultado === 'posible_coincidencia' || v.resultado === 'coincidencia_confirmada')) {
        throw new Error('Hay verificaciones con coincidencia sin descartar');
      }
      if (aprueba && !e.evaluaciones.length) throw new Error('Evalúe el riesgo antes de aprobar.');
      if (d.tipo === 'aprobar_diferida') {
        if (!d.verificacionDiferidaHasta) throw new Error('Indique la fecha límite de la verificación diferida');
        const limite = new Date(); limite.setMonth(limite.getMonth() + 3);
        if (new Date(d.verificacionDiferidaHasta) > limite) throw new Error('La verificación diferida no puede exceder 3 meses (art. 22)');
        e.verificacionDiferidaHasta = d.verificacionDiferidaHasta;
      }
      const estados = { aprobar: 'aprobado', aprobar_diferida: 'aprobado_condicionado', intensificar: 'en_revision', rechazar: 'rechazado', abstener: 'abstenido', abrir_examen: 'en_examen' } as const;
      e.estado = estados[d.tipo];
      e.decisiones.unshift({ id: `dec-${Date.now()}`, tipo: d.tipo, justificacion: d.justificacion, condiciones: d.condiciones ?? null, decididoEn: new Date().toISOString(), decididoPor: 'Oficial de cumplimiento (demo)' });
      registrar(e, 'insert', 'decisiones');
    },

    async cerrarAlerta(id, cierre) {
      exigirCumplimiento();
      exigirTexto(cierre, 'Cierre');
      const e = estado.expedientes.find((x) => x.alertas.some((a) => a.id === id))!;
      if (id.startsWith('al-onu-') && e.bloqueos.some((b) => `al-onu-${b.id.slice(3)}` === id && !b.comunicadoMpEn)) {
        throw new Error('Registre la comunicación al Ministerio Público antes de cerrar esta alerta (art. 43)');
      }
      Object.assign(e.alertas.find((a) => a.id === id)!, { estado: 'cerrada', cierre });
      registrar(e, 'update', 'alertas');
    },

    async registrarComunicacionMp(id, c) {
      exigirCumplimiento();
      const e = estado.expedientes.find((x) => x.bloqueos.some((b) => b.id === id))!;
      const b = e.bloqueos.find((x) => x.id === id)!;
      if (b.comunicadoMpEn) throw new Error('La comunicación al Ministerio Público ya fue registrada');
      if (c.referencia.trim().length < 3) throw new Error('Indique la referencia de la comunicación (número de oficio o de recepción)');
      const t = new Date(c.comunicadoEn).getTime();
      if (Number.isNaN(t) || t > Date.now() + 5 * 60_000) throw new Error('Indique la fecha y hora en que se entregó la comunicación (no puede ser futura)');
      if (t < new Date(b.detectadaEn).getTime()) throw new Error('La comunicación no puede ser anterior a la detección de la coincidencia');
      const dentroDePlazo = t <= new Date(b.detectadaEn).getTime() + 24 * 3_600_000;
      Object.assign(b, { comunicadoMpEn: new Date(t).toISOString(), comunicacionReferencia: c.referencia.trim(), comunicacionDentroPlazo: dentroDePlazo });
      registrar(e, 'update', 'bloqueos_preventivos');
      return { dentroDePlazo };
    },
    async levantarBloqueo(id, motivo, referencia) {
      exigirCumplimiento();
      const e = estado.expedientes.find((x) => x.bloqueos.some((b) => b.id === id))!;
      const b = e.bloqueos.find((x) => x.id === id)!;
      if (b.levantadoEn) throw new Error('El bloqueo ya fue levantado');
      if (!b.comunicadoMpEn) throw new Error('Registre primero la comunicación al Ministerio Público');
      if (motivo.trim().length < 20 || referencia.trim().length < 3) throw new Error('Indique el motivo (al menos 20 caracteres) y la referencia de la resolución');
      Object.assign(b, { levantadoEn: new Date().toISOString(), levantamientoMotivo: motivo.trim(), levantamientoReferencia: referencia.trim() });
      registrar(e, 'update', 'bloqueos_preventivos');
    },

    async liberarExpediente(bloqueoId, expedienteId, tipo, justificacion) {
      exigirCumplimiento();
      const e = buscar(expedienteId);
      const r = e.bloqueosRelacionados.find((x) => x.bloqueoId === bloqueoId);
      if (!r) throw new Error('El bloqueo no alcanza a este expediente');
      if (r.liberacion) throw new Error('El expediente ya fue liberado de este bloqueo');
      if (justificacion.trim().length < 20) throw new Error('Justifique la liberación con al menos 20 caracteres (datos comparados y conclusión)');
      r.liberacion = { tipo, justificacion: justificacion.trim(), liberadoEn: new Date().toISOString() };
      registrar(e, 'insert', 'liberaciones_bloqueo');
    },
    async urlDocumento() { return null; },

    // ------------------------------------------------ vista operativa
    async operaciones() {
      const porCodigo = new Map<string, FilaOperacion>();
      for (const e of estado.expedientes) {
        const creada = e.bitacora.at(-1)?.ocurridoEn ?? hace(1);
        const op = porCodigo.get(e.codigoOperacion) ?? {
          id: e.codigoOperacion, codigo: e.codigoOperacion, tipo: e.operacion.tipo as FilaOperacion['tipo'],
          precio: e.operacion.precio, moneda: e.operacion.moneda, inmueble: { ...e.operacion.inmueble }, creadaEn: creada, partes: [],
        };
        // Solo campos que el área comercial puede ver (art. 38).
        op.partes.push({
          expedienteId: e.id, parte: e.parte, tipoPersona: e.tipoPersona, nombre: e.contacto.nombre,
          telefono: e.contacto.telefono, correo: e.contacto.correo, estado: enmascararEstado(e.estado),
          pendientes: e.pendientes.filter((p) => p.estado === 'abierto').length,
          whatsappVinculado: e.contacto.whatsappVinculado, actualizadoEn: e.bitacora[0]?.ocurridoEn ?? creada,
        });
        porCodigo.set(e.codigoOperacion, op);
      }
      return [...porCodigo.values()].sort((a, b) => b.codigo.localeCompare(a.codigo));
    },

    async registrarOperacion(_org, op) {
      if (rol === 'auditor') throw new Error('Sin permiso para registrar operaciones');
      const errores = validarOperacion(op);
      if (Object.keys(errores).length) throw new Error(Object.values(errores)[0]);
      const codigo = `OP-2026-${String(++correlativo).padStart(5, '0')}`;
      const ahora = new Date().toISOString();
      const nuevos: DetalleExpediente[] = [];
      op.partes.forEach((p, i) => {
        const id = `exp-n${correlativo}-${i}`;
        nuevos.push({
          id, organizacionId: ORG, codigoOperacion: codigo, parte: p.parte, tipoPersona: p.tipoPersona, estado: 'invitado',
          contacto: { nombre: p.nombre, telefono: p.telefono ?? null, correo: p.correo ?? null, whatsappVinculado: false },
          operacion: { tipo: op.tipo, precio: op.precio ?? null, moneda: op.moneda, inmueble: { ...op.inmueble } as Record<string, string>, formaPago: op.formaPago.map((f) => ({ medio: f.medio, monto: f.monto })) },
          verificacionDiferidaHasta: null, datos: [], documentos: [], pendientes: [], verificaciones: [], alertas: [], bloqueos: [], bloqueosRelacionados: [],
          evaluaciones: [], decisiones: [], bitacora: [{ id: 1000 + correlativo * 10 + i, ocurridoEn: ahora, actorTipo: 'usuario', evento: 'insert', entidad: 'expedientes', hash: hash(1000 + correlativo + i) }],
        });
        estado.perfiles[id] = perfilBase({ parte: p.parte, tipoPersona: p.tipoPersona, tipoOperacion: op.tipo, ddcCompleta: false, origenFondosDeclarado: p.parte === 'vendedor' });
      });
      estado.expedientes.unshift(...nuevos);
      return { codigo };
    },

    async reenviarEnlace(expedienteId) {
      const e = buscar(expedienteId);
      if (['aprobado', 'aprobado_condicionado', 'rechazado', 'abstenido'].includes(e.estado)) throw new Error('El expediente ya fue resuelto');
      const expiraEn = new Date(Date.now() + 7 * 86_400_000).toISOString();
      return e.contacto.telefono
        ? { canal: 'whatsapp' as const, expiraEn }
        : e.contacto.correo
          ? { canal: 'correo' as const, expiraEn }
          : { canal: 'manual' as const, url: `https://demo-inmuebles.ejemplo.invalid/e/${Math.random().toString(36).slice(2, 12)}`, expiraEn };
    },

    async registrarPagoEfectivo(p) {
      if (rol === 'auditor') throw new Error('Sin permiso para registrar pagos');
      const errores = validarPagoEfectivo(p);
      if (Object.keys(errores).length) throw new Error(Object.values(errores)[0]);
      buscar(p.expedienteId);
      pagosEfectivo.push({ expedienteId: p.expedienteId, fecha: p.fecha, montoUsd: p.monto / p.tipoCambioUsd });
      // El control del umbral (art. 31) lo ve cumplimiento: en la demo se refleja como aviso para el oficial.
      const total = pagosEfectivo.filter((x) => x.expedienteId === p.expedienteId && x.fecha === p.fecha).reduce((s, x) => s + x.montoUsd, 0);
      if (total >= 10000 && !estado.avisos.some((a) => a.id === `av-ef-${p.expedienteId}-${p.fecha}`)) {
        estado.avisos.unshift({
          id: `av-ef-${p.expedienteId}-${p.fecha}`, asunto: 'Efectivo diario sujeto a registro (art. 31)',
          cuerpo: `Pagos en efectivo del ${p.fecha} suman USD ${Math.round(total).toLocaleString('es-GT')}.`,
          prioridad: 'alta', expedienteId: p.expedienteId, creadaEn: new Date().toISOString(), leida: false,
        });
      }
    },
  };
}
