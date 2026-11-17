import { similitudNombres, tokensEntidad, tokensPersona } from '@agente-aml/listas';

/** Reglas puras que aplica la API de la consola. Se prueban sin base de datos. */

type Nivel = 'bajo' | 'medio' | 'alto';
const ORDEN: Record<Nivel, number> = { bajo: 0, medio: 1, alto: 2 };

/** El nivel mínimo que imponen las reglas de la evaluación (ONU, PEP, GAFI…). */
export function nivelMinimoImpuesto(reglas: { nivelMinimo?: Nivel; codigo?: string }[] | null | undefined): Nivel | null {
  let minimo: Nivel | null = null;
  for (const r of reglas ?? []) {
    if (r.nivelMinimo && (!minimo || ORDEN[r.nivelMinimo] > ORDEN[minimo])) minimo = r.nivelMinimo;
  }
  return minimo;
}

/** M1: el ajuste manual no puede quedar por debajo de lo que imponen las reglas. */
export function ajustePermitido(nivel: Nivel, reglas: { nivelMinimo?: Nivel }[] | null | undefined): boolean {
  const minimo = nivelMinimoImpuesto(reglas);
  return !minimo || ORDEN[nivel] >= ORDEN[minimo];
}

/**
 * M4: la evaluación usada para aprobar debe ser posterior al último cambio de
 * datos o documentos del expediente.
 */
export function evaluacionVigente(calculadaEn: string, ultimoCambio: string | null | undefined): boolean {
  return !ultimoCambio || new Date(ultimoCambio).getTime() <= new Date(calculadaEn).getTime();
}

/** Fecha de hoy en Guatemala (AAAA-MM-DD). */
export function hoyGuatemala(ahora = new Date()): string {
  return new Date(ahora.getTime() - 6 * 3_600_000).toISOString().slice(0, 10);
}

/** M6: un pleno del GAFI no puede tener fecha futura (quedaría vigente para siempre). */
export function plenarioValido(plenario: string, ahora = new Date()): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(plenario) && plenario <= hoyGuatemala(ahora);
}

/** M6: el administrador de la plataforma debe tener el correo verificado. */
export function correoVerificado(usuario: { email?: string | null; email_confirmed_at?: string | null } | null | undefined): boolean {
  return !!usuario?.email && !!usuario.email_confirmed_at;
}

/** M3: tipo y número de documento normalizados, para no duplicar fichas por formato. */
export function normalizarDocumento(tipo: string, numero: string): { tipo: string; numero: string } {
  const t = tipo.trim().toLowerCase();
  const tipoNorm = t === 'dpi' || t === 'cui' ? 'DPI' : t.startsWith('pas') ? 'PASAPORTE' : t === 'nit' ? 'NIT' : tipo.trim().toUpperCase();
  const numeroNorm = tipoNorm === 'PASAPORTE' ? numero.replace(/[\s-]/g, '').toUpperCase() : numero.replace(/[^0-9kK]/g, '').toUpperCase();
  return { tipo: tipoNorm, numero: numeroNorm };
}

/** M3: una ficha existente con el mismo documento solo se vincula si el nombre también coincide. */
export function mismaPersona(nombreFicha: string, nombreExpediente: string, entidad: boolean): boolean {
  const tk = entidad ? tokensEntidad : tokensPersona;
  return similitudNombres(tk(nombreFicha), tk(nombreExpediente)) >= 0.9;
}
