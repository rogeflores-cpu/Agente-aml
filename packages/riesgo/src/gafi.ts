import type { ConfiguracionRiesgo } from './tipos.js';

export interface ListaGafi {
  /** Fecha de la declaración del pleno (AAAA-MM-DD). */
  plenario: string;
  altoRiesgo: string[];
  monitoreo: string[];
}

/**
 * Devuelve la configuración con las listas del GAFI de la versión vigente.
 * Las listas son las mismas para todas las organizaciones; la metodología de
 * cada una no las puede reducir.
 */
export function aplicarListaGafi(config: ConfiguracionRiesgo, lista: ListaGafi): ConfiguracionRiesgo {
  const norm = (v: string[]) => [...new Set(v.map((p) => p.trim().toUpperCase()))].sort();
  return {
    ...config,
    paisesAltoRiesgoGafi: norm([...lista.altoRiesgo, ...config.paisesAltoRiesgoGafi]),
    paisesMonitoreoGafi: norm([...lista.monitoreo, ...config.paisesMonitoreoGafi]).filter(
      (p) => !lista.altoRiesgo.map((x) => x.toUpperCase()).includes(p),
    ),
  };
}

/**
 * El GAFI celebra pleno en febrero, junio y octubre. Si la última versión
 * cargada tiene más de 5 meses, probablemente falta cargar un pleno.
 */
export function listaGafiDesactualizada(plenario: string, hoy = new Date()): boolean {
  const ultima = new Date(`${plenario}T00:00:00Z`);
  const limite = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 5, hoy.getUTCDate()));
  return ultima < limite;
}
