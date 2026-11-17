import { createHash } from 'node:crypto';
import { claveNombre, type PersonaIdentificada } from '@agente-aml/agente';

/**
 * Reglas puras (sin base de datos) sobre cuándo cotejar y cuándo el cliente
 * puede cambiar su expediente. Se prueban por separado.
 */

export interface VerificacionExistente {
  nombre_consultado: string;
  version_fuente: string | null;
}

/**
 * Personas que todavía no tienen un cotejo ONU con la versión vigente de la
 * lista. Un nombre nuevo o cambiado (aunque venga de un documento y aún no
 * esté confirmado) siempre se coteja (art. 43: verificar a quienes quieran
 * iniciar una relación de negocios).
 */
export function cotejosPendientes(
  personas: PersonaIdentificada[],
  verificaciones: VerificacionExistente[],
  versionVigente: string | null,
): PersonaIdentificada[] {
  const hechos = new Set(
    verificaciones
      .filter((v) => versionVigente === null || v.version_fuente === versionVigente)
      .map((v) => claveNombre(v.nombre_consultado)),
  );
  const vistos = new Set<string>();
  return personas.filter((p) => {
    const k = claveNombre(p.nombre);
    if (!k || hechos.has(k) || vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}

/** Id de evento estable: Inngest descarta duplicados del mismo cotejo. */
export function idEventoCotejo(expedienteId: string, nombre: string, version: string | null): string {
  const h = createHash('sha256').update(claveNombre(nombre)).digest('hex').slice(0, 16);
  return `onu-${expedienteId}-${h}-${version ?? 'sin-version'}`;
}

/**
 * Estado que se comporta hacia el cliente (portal y WhatsApp) sin revelar un
 * examen especial abierto después de resolver (art. 38). El estado real
 * 'en_examen' se presenta como el que tenía el expediente antes del examen:
 * en revisión si aún no se había decidido; si ya se había aprobado o no
 * aprobado (estado_comercial, que la base mantiene fijo durante el examen),
 * como ese resultado, incluida la verificación diferida aún pendiente.
 */
export function estadoAparente(
  estado: string,
  estadoComercial: string | null | undefined,
  ultimaAprobacion: 'aprobar' | 'aprobar_diferida' | null = null,
): string {
  if (estado !== 'en_examen') return estado;
  if (estadoComercial === 'no_aprobado') return 'rechazado';
  if (estadoComercial === 'aprobado') return ultimaAprobacion === 'aprobar_diferida' ? 'aprobado_condicionado' : 'aprobado';
  return 'en_revision';
}

/** Qué pasa cuando el cliente intenta cambiar datos o documentos según el estado del expediente. */
export type PoliticaEdicion = 'permitir' | 'permitir_y_avisar' | 'rechazar';

export function politicaEdicion(estado: string): PoliticaEdicion {
  switch (estado) {
    case 'invitado':
    case 'en_captura':
    case 'aprobado_condicionado': // debe completar la verificación diferida
      return 'permitir';
    case 'en_revision':
    case 'listo_para_decision':
    case 'en_examen': // igual que en revisión: no se revela el examen (art. 38)
      return 'permitir_y_avisar';
    default: // aprobado, rechazado, abstenido
      return 'rechazar';
  }
}

export const MENSAJE_NO_EDITABLE =
  'Su expediente ya fue procesado. Si necesita actualizar información, comuníquese con su asesor.';

/**
 * Límite de intentos de código de vinculación por WhatsApp (A3): cuántos
 * mensajes con forma de código acepta un número en la ventana, y cuántos
 * acepta la organización en total, antes de dejar de comprobarlos.
 */
export const LIMITE_CODIGOS = { porNumero: 5, porOrganizacion: 60, ventanaMinutos: 60 };

export function codigoPermitido(intentosNumero: number, intentosOrganizacion: number): boolean {
  return intentosNumero < LIMITE_CODIGOS.porNumero && intentosOrganizacion < LIMITE_CODIGOS.porOrganizacion;
}
