import type { CSSProperties } from 'react';

/** Blanco o tinta según el contraste con el color de la marca. */
export function textoSobre(hex: string): string {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return '#ffffff';
  const [r, g, b] = m.slice(1).map((x) => {
    const c = parseInt(x, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminancia = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminancia > 0.45 ? '#14213d' : '#ffffff';
}

/** Variables CSS de la marca para el contenedor principal. */
export function estiloMarca(color: string): CSSProperties {
  const valido = /^#[0-9a-f]{6}$/i.test(color) ? color : '#0f5e5a';
  return {
    '--color-marca': valido,
    '--color-marca-claro': `color-mix(in srgb, ${valido} 10%, white)`,
    '--color-sobre-marca': textoSobre(valido),
  } as CSSProperties;
}

export const NOMBRE_DOCUMENTO: Record<string, string> = {
  dpi: 'DPI', pasaporte: 'Pasaporte', recibo_servicio: 'Recibo de servicio', nit_rtu: 'Constancia de RTU o NIT',
  patente_empresa: 'Patente de empresa', patente_sociedad: 'Patente de sociedad', escritura_constitutiva: 'Escritura de constitución',
  nombramiento_representante: 'Nombramiento del representante', dpi_representante: 'DPI del representante',
  registro_accionistas: 'Registro de accionistas', certificacion_registral: 'Certificación del Registro de la Propiedad',
  soporte_origen_fondos: 'Respaldo del origen de los fondos', poder_representacion: 'Poder de representación',
};
