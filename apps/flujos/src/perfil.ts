import { revisar, type EntradaRevision } from '@agente-aml/agente';
import type { MedioPago, PerfilEvaluacion } from '@agente-aml/riesgo';

/**
 * Datos que solo el oficial puede valorar y que no salen del expediente.
 * Se guardan con la evaluación para que quede claro qué juzgó una persona.
 */
export interface AjustesOficial {
  presencial?: boolean;
  intermediario?: boolean;
  actuaPorRepresentacion?: boolean;
  contratistaOProveedorEstado?: boolean;
  noDomiciliado?: boolean;
  nivelesPropiedad?: number;
  coherenciaPerfilMonto?: 'coherente' | 'dudosa' | 'incoherente';
  transaccionInusual?: boolean;
  diasDesdeAdquisicion?: number;
  /** ISO 3166-1 alfa-2, cuando el texto declarado no permite deducirlo. */
  nacionalidad?: string;
  paisResidencia?: string;
  /** Unidades de la moneda de la operación por 1 USD. Obligatorio si la moneda no es USD. */
  tipoCambioUsd?: number;
}

export interface OperacionParaPerfil {
  tipo: 'compraventa' | 'intermediacion';
  precio: number | null;
  moneda: string;
  valor_referencia: number | null;
  inmueble: { departamento?: string } | null;
  forma_pago: { medio: MedioPago; monto: number; moneda?: string; pagador?: 'cliente' | 'tercero'; pais?: string; fecha?: string }[];
}

export interface VerificacionParaPerfil {
  fuente: string;
  resultado: 'sin_coincidencia' | 'posible_coincidencia' | 'coincidencia_confirmada' | 'descartada';
}

const si = (v: unknown) => v === true || (typeof v === 'string' && /^(s[ií]|true)$/i.test(v.trim()));
const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function paisIso(v: unknown): string | undefined {
  const t = texto(v);
  if (/^[a-z]{2}$/i.test(t)) return t.toUpperCase();
  if (/guatemal/i.test(t)) return 'GT';
  return undefined;
}

function mesesDesde(fecha: unknown, hoy: Date): number | undefined {
  const m = texto(fecha).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return undefined;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return (hoy.getUTCFullYear() - d.getUTCFullYear()) * 12 + (hoy.getUTCMonth() - d.getUTCMonth());
}

/**
 * Arma el perfil que evalúa el motor de riesgo a partir del expediente, la
 * operación, las verificaciones y el juicio del oficial. Devuelve también las
 * advertencias que impiden considerar completa la debida diligencia.
 */
export function construirPerfil(
  entrada: EntradaRevision,
  operacion: OperacionParaPerfil,
  verificaciones: VerificacionParaPerfil[],
  ajustes: AjustesOficial = {},
  hoy = new Date(),
): { perfil: PerfilEvaluacion; advertencias: string[] } {
  const advertencias: string[] = [];
  const v = (campo: string) => entrada.datos[campo]?.valor;
  const { parte, tipoPersona } = entrada.contexto;
  const individual = tipoPersona === 'individual';

  const tc = operacion.moneda === 'USD' ? 1 : ajustes.tipoCambioUsd;
  if (!tc) throw new Error(`Indique el tipo de cambio de ${operacion.moneda} a USD`);
  const usd = (monto: number | null, moneda = operacion.moneda) =>
    monto == null ? undefined : moneda === 'USD' ? monto : Math.round((monto / tc) * 100) / 100;

  const pagaTercero = v('origen_fondos.pagador') === 'otra persona o empresa';
  const pagos = (operacion.forma_pago ?? []).map((p) => ({
    medio: p.medio,
    montoUsd: usd(p.monto, p.moneda ?? operacion.moneda) ?? 0,
    pagadorEsCliente: p.pagador ? p.pagador === 'cliente' : !pagaTercero,
    paisOrigen: p.pais,
    fecha: p.fecha,
  }));

  // Art. 43: la lista de la ONU y las designaciones de la S/RES/1373 tienen el mismo efecto
  const onu = verificaciones.filter((x) => x.fuente === 'onu' || x.fuente === 'designacion_1373');
  const coincidenciaOnu = onu.some((x) => x.resultado === 'coincidencia_confirmada')
    ? 'confirmada'
    : onu.some((x) => x.resultado === 'posible_coincidencia')
      ? 'posible'
      : 'ninguna';
  if (!onu.some((x) => x.fuente === 'onu')) advertencias.push('No hay cotejo con la lista de la ONU registrado para este expediente.');
  // OFAC (no es lista del art. 43): eleva el riesgo, sin bloqueo
  const ofac = verificaciones.filter((x) => x.fuente === 'ofac');
  const coincidenciaOfac = ofac.some((x) => x.resultado === 'coincidencia_confirmada')
    ? 'confirmada'
    : ofac.some((x) => x.resultado === 'posible_coincidencia')
      ? 'posible'
      : 'ninguna';

  const revision = revisar({ ...entrada, hoy });
  if (!revision.completo) advertencias.push(`Hay ${revision.pendientes.length} pendiente(s) abiertos en el expediente.`);

  const tipoEntidad = texto(v('entidad.tipo')).toLowerCase();
  const beneficiarios = v('beneficiarios_finales');
  const origenDeclarado =
    parte === 'vendedor' ||
    (!!texto(v('origen_fondos.descripcion')) && entrada.documentos.some((d) => d.clave === 'soporte_origen_fondos'));

  const nacionalidad = ajustes.nacionalidad ?? (individual ? paisIso(v('cliente.nacionalidad')) : paisIso(v('entidad.lugar_constitucion')));
  if (!nacionalidad) advertencias.push('No se pudo determinar la nacionalidad o el país de constitución: indíquelo en los ajustes.');

  const perfil: PerfilEvaluacion = {
    parte,
    tipoPersona,
    // Art. 25 a: también cuando un beneficiario final es PEP o está vinculado a uno (M7).
    // Las preguntas de persona jurídica combinan cargo y vínculo: se toma lo más estricto.
    esPep: individual ? si(v('cliente.cargo_publico')) : si(v('beneficiarios_finales.cargo_publico')),
    vinculoPep: individual ? si(v('cliente.familiar_cargo_publico')) : si(v('representante.cargo_publico')),
    contratistaOProveedorEstado: ajustes.contratistaOProveedorEstado ?? false,
    sinFinesDeLucro: /fundaci|asociaci|ong|sin fines/.test(tipoEntidad),
    fideicomiso: tipoPersona === 'estructura' || /fideicomiso/.test(tipoEntidad),
    noDomiciliado: ajustes.noDomiciliado ?? false,
    antiguedadSociedadMeses: individual ? undefined : mesesDesde(v('entidad.fecha_constitucion'), hoy),
    nivelesPropiedad: ajustes.nivelesPropiedad,
    beneficiarioFinalIdentificado: individual || (Array.isArray(beneficiarios) && beneficiarios.length > 0),
    actividadEconomica: texto(v(individual ? 'cliente.actividad_economica' : 'entidad.actividad')) || undefined,
    coherenciaPerfilMonto: ajustes.coherenciaPerfilMonto,
    nacionalidad,
    paisResidencia: ajustes.paisResidencia ?? (individual ? undefined : nacionalidad),
    departamentoInmueble: operacion.inmueble?.departamento,
    // La vinculación por enlace o WhatsApp es no presencial (art. 25 k) salvo que el oficial indique lo contrario.
    presencial: ajustes.presencial ?? false,
    intermediario: ajustes.intermediario ?? false,
    actuaPorRepresentacion: ajustes.actuaPorRepresentacion ?? false,
    tipoOperacion: operacion.tipo,
    precioUsd: usd(operacion.precio),
    valorReferenciaUsd: usd(operacion.valor_referencia),
    pagos,
    diasDesdeAdquisicion: ajustes.diasDesdeAdquisicion,
    origenFondosDeclarado: origenDeclarado,
    ddcCompleta: revision.completo && onu.length > 0,
    transaccionInusual: ajustes.transaccionInusual ?? false,
    coincidenciaOnu,
    coincidenciaOfac,
  };
  return { perfil, advertencias };
}
