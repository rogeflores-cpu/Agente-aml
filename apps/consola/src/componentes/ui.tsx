import type { ReactNode } from 'react';
import type { EstadoExpediente, Nivel } from '../fuente/tipos';

export const ESTADOS: Record<EstadoExpediente, { texto: string; clase: string }> = {
  invitado: { texto: 'Invitado', clase: 'bg-slate-100 text-slate-700' },
  en_captura: { texto: 'En captura', clase: 'bg-sky-50 text-sky-800' },
  en_revision: { texto: 'En revisión', clase: 'bg-indigo-50 text-indigo-800' },
  listo_para_decision: { texto: 'Listo para decidir', clase: 'bg-marca-claro text-marca' },
  aprobado: { texto: 'Aprobado', clase: 'bg-bajo-claro text-bajo' },
  aprobado_condicionado: { texto: 'Aprobado con verificación diferida', clase: 'bg-bajo-claro text-bajo' },
  rechazado: { texto: 'Rechazado', clase: 'bg-alto-claro text-alto' },
  abstenido: { texto: 'Abstención', clase: 'bg-alto-claro text-alto' },
  en_examen: { texto: 'En examen', clase: 'bg-medio-claro text-medio' },
};

export const NIVELES: Record<Nivel, { texto: string; clase: string }> = {
  bajo: { texto: 'Riesgo bajo', clase: 'bg-bajo-claro text-bajo' },
  medio: { texto: 'Riesgo medio', clase: 'bg-medio-claro text-medio' },
  alto: { texto: 'Riesgo alto', clase: 'bg-alto-claro text-alto' },
};

export function Insignia({ clase, children }: { clase: string; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${clase}`}>{children}</span>;
}

export function Tarjeta({ titulo, accion, children, className = '' }: { titulo?: ReactNode; accion?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-borde bg-white ${className}`}>
      {titulo && (
        <header className="flex items-center justify-between gap-4 border-b border-borde px-5 py-3">
          <h3 className="text-sm font-semibold text-tinta">{titulo}</h3>
          {accion}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Boton({
  children, onClick, tipo = 'primario', disabled, type = 'button',
}: { children: ReactNode; onClick?: () => void; tipo?: 'primario' | 'secundario' | 'peligro'; disabled?: boolean; type?: 'button' | 'submit' }) {
  const estilos = {
    primario: 'bg-marca text-white hover:bg-[#0b4a47]',
    secundario: 'border border-borde bg-white text-tinta hover:bg-papel',
    peligro: 'bg-alto text-white hover:bg-[#912018]',
  }[tipo];
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`inline-flex items-center justify-center rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${estilos}`}>
      {children}
    </button>
  );
}

export function Vacio({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-tinta-suave">{children}</p>;
}

export function Mensaje({ tipo, children }: { tipo: 'error' | 'aviso' | 'ok'; children: ReactNode }) {
  const c = { error: 'border-alto/30 bg-alto-claro text-alto', aviso: 'border-medio/30 bg-medio-claro text-medio', ok: 'border-bajo/30 bg-bajo-claro text-bajo' }[tipo];
  return <div className={`rounded-lg border px-4 py-3 text-sm ${c}`}>{children}</div>;
}

export const fecha = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-GT', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const moneda = (monto: number | null, mon: string) =>
  monto == null ? '—' : new Intl.NumberFormat('es-GT', { style: 'currency', currency: mon, maximumFractionDigits: 0 }).format(monto);

const ETIQUETAS: Record<string, string> = {
  nombre_completo: 'Nombre completo', fecha_nacimiento: 'Fecha de nacimiento', lugar_nacimiento: 'Lugar de nacimiento',
  documento_tipo: 'Tipo de documento', documento_numero: 'Número de documento', direccion_residencia: 'Dirección de residencia',
  cargo_publico: 'Cargo público (declarado)', familiar_cargo_publico: 'Familiar o socio con cargo público', ingresos_rango: 'Ingresos mensuales',
  actividad_economica: 'Actividad económica', estado_civil: 'Estado civil', razon_social: 'Razón social', nit: 'NIT',
  fecha_constitucion: 'Fecha de constitución', lugar_constitucion: 'Lugar de constitución', beneficiarios_finales: 'Beneficiarios finales',
  proposito: 'Propósito', descripcion: 'Origen de los fondos', forma_pago: 'Forma de pago', pagador: 'Quién paga',
  pagador_identificacion: 'Datos de quien paga', propietarios: 'Propietarios registrales', fecha_emision: 'Fecha de emisión',
};

export function etiquetaCampo(campo: string): string {
  const partes = campo.split('.');
  const ultimo = partes.at(-1)!;
  const base = ETIQUETAS[ultimo] ?? ultimo.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  return partes[0] === 'doc' ? `${base} (${partes[1].replace(/_/g, ' ')})` : base;
}

export const NOMBRE_DOCUMENTO: Record<string, string> = {
  dpi: 'DPI', pasaporte: 'Pasaporte', recibo_servicio: 'Recibo de servicio', nit_rtu: 'Constancia RTU/NIT',
  patente_empresa: 'Patente de empresa', patente_sociedad: 'Patente de sociedad', escritura_constitutiva: 'Escritura constitutiva',
  nombramiento_representante: 'Nombramiento del representante', dpi_representante: 'DPI del representante',
  registro_accionistas: 'Registro de accionistas', certificacion_registral: 'Certificación registral',
  soporte_origen_fondos: 'Soporte del origen de fondos', poder_representacion: 'Poder de representación',
};

export function mostrarValor(v: unknown): string {
  if (v == null || v === '') return '—';
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' && x ? Object.values(x).join(' · ') : String(x))).join('; ');
  if (typeof v === 'object') return Object.values(v as object).join(' · ');
  return String(v);
}
