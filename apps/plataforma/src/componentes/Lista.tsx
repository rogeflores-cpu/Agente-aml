import type { EstadoAlta } from '../fuente/tipos';
import { Paso } from './ui';

/** Lista de verificación del alta: lo que falta para que la organización opere. */
export function ListaAlta({ e }: { e: EstadoAlta }) {
  return (
    <ul className="space-y-1.5">
      <Paso hecho={!!e.metodologiaVersionAprobada}>Metodología de riesgo aprobada (art. 8){e.metodologiaVersionAprobada ? ` · v${e.metodologiaVersionAprobada}` : ''}</Paso>
      <Paso hecho={e.oficiales > 0}>Oficial de cumplimiento asignado{e.suplentes ? ' y suplente' : ''}</Paso>
      <Paso hecho={e.whatsappEstado === 'activo'}>WhatsApp activo{e.whatsappNumero ? ` · ${e.whatsappNumero}` : ''}</Paso>
      <Paso hecho={!!e.inscripcionIve}>Inscripción ante la IVE (art. 5){e.inscripcionIve ? ` · ${e.inscripcionIve}` : ''}</Paso>
    </ul>
  );
}

export function avanceAlta(e: EstadoAlta) {
  return [!!e.metodologiaVersionAprobada, e.oficiales > 0, e.whatsappEstado === 'activo', !!e.inscripcionIve].filter(Boolean).length;
}
