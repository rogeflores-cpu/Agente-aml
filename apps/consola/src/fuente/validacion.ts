import { DEPARTAMENTOS_GUATEMALA, errorRegistral, municipioValido } from '@agente-aml/riesgo';
import type { EstadoComercial, EstadoExpediente, NuevaOperacion, NuevoPagoEfectivo } from './tipos';

/** Misma regla que la vista aml.operaciones_comercial (art. 38). */
export function enmascararEstado(e: EstadoExpediente): EstadoComercial {
  if (e === 'invitado' || e === 'en_captura') return e;
  if (e === 'aprobado' || e === 'aprobado_condicionado') return 'aprobado';
  if (e === 'rechazado' || e === 'abstenido') return 'no_aprobado';
  return 'en_revision';
}

/** Fecha de hoy (AAAA-MM-DD) en Guatemala, no en UTC: después de las 18:00 UTC ya es "mañana". */
export function hoyGuatemala(ahora = new Date()): string {
  return ahora.toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' });
}

export const TELEFONO_E164 = /^\+[1-9]\d{7,14}$/;
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validaciones del formulario. Devuelve los errores por campo; vacío si es válido. */
export function validarOperacion(op: NuevaOperacion): Record<string, string> {
  const e: Record<string, string> = {};
  const { departamento, municipio } = op.inmueble;
  if (!departamento?.trim() || !DEPARTAMENTOS_GUATEMALA.includes(departamento)) e['inmueble.departamento'] = 'Indique el departamento';
  else if (!municipio?.trim()) e['inmueble.municipio'] = 'Indique el municipio';
  else if (!municipioValido(departamento, municipio)) e['inmueble.municipio'] = `El municipio no corresponde a ${departamento}`;
  const registral = errorRegistral(op.inmueble);
  if (registral) e[`inmueble.${registral.campo}`] = registral.mensaje;
  if (op.precio !== undefined && !(op.precio > 0)) e.precio = 'El precio debe ser mayor que cero';
  if (op.valorReferencia !== undefined && !(op.valorReferencia > 0)) e.valorReferencia = 'Debe ser mayor que cero';
  op.formaPago.forEach((p, i) => { if (!(p.monto > 0)) e[`formaPago.${i}.monto`] = 'Monto mayor que cero'; });
  const total = op.formaPago.reduce((s, p) => s + (p.monto || 0), 0);
  if (op.precio && total > op.precio * 1.0001) e.formaPago = 'La forma de pago suma más que el precio';
  if (!op.partes.length) e.partes = 'Agregue al menos una parte';
  op.partes.forEach((p, i) => {
    if (p.nombre.trim().length < 3) e[`partes.${i}.nombre`] = 'Nombre completo o razón social';
    if (p.telefono && !TELEFONO_E164.test(p.telefono)) e[`partes.${i}.telefono`] = 'Formato internacional: +50255550000';
    if (p.correo && !CORREO.test(p.correo)) e[`partes.${i}.correo`] = 'Correo inválido';
    if (!p.telefono && !p.correo) e[`partes.${i}.telefono`] = 'Indique teléfono o correo';
  });
  return e;
}

export function validarPagoEfectivo(p: NuevoPagoEfectivo, hoy = new Date()): Record<string, string> {
  const e: Record<string, string> = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.fecha)) e.fecha = 'Indique la fecha';
  else if (p.fecha > hoyGuatemala(hoy)) e.fecha = 'La fecha no puede ser futura';
  if (!(p.monto > 0)) e.monto = 'Monto mayor que cero';
  if (!/^[A-Z]{3}$/.test(p.moneda)) e.moneda = 'Moneda ISO de 3 letras';
  if (!(p.tipoCambioUsd > 0)) e.tipoCambioUsd = 'Tipo de cambio mayor que cero';
  return e;
}
