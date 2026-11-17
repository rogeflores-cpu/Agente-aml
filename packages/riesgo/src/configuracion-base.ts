import type { ConfiguracionRiesgo } from './tipos.js';

/**
 * Configuración base para inmobiliarias. Es un punto de partida: cada sujeto
 * obligado debe revisarla, ajustarla y aprobarla por su órgano de dirección
 * (art. 8) antes de usarla. Las listas del GAFI quedan vacías a propósito:
 * se cargan desde la publicación vigente y se actualizan con cada pleno.
 */
export const configuracionBaseInmobiliaria: ConfiguracionRiesgo = {
  version: 1,
  pesosFactores: { cliente: 0.4, geografia: 0.2, canal: 0.15, producto: 0.25 },
  umbrales: { medio: 30, alto: 55 },
  puntos: {
    // Cliente
    'cliente.individual': 10,
    'cliente.juridica': 25,
    'cliente.estructura': 45,
    'cliente.pep': 50,
    'cliente.vinculo_pep': 35,
    'cliente.contratista_estado': 20,
    'cliente.sin_fines_lucro': 20,
    'cliente.fideicomiso': 25,
    'cliente.no_domiciliado': 25,
    'cliente.sociedad_reciente': 20,
    'cliente.propiedad_compleja': 20,
    'cliente.bf_no_identificado': 40,
    'cliente.perfil_dudoso': 15,
    'cliente.perfil_incoherente': 35,
    // Geografía
    'geografia.gafi_alto_riesgo': 100,
    'geografia.gafi_monitoreo': 35,
    'geografia.extranjero': 15,
    // Canal
    'canal.no_presencial': 35,
    'canal.intermediario': 20,
    'canal.representacion': 20,
    // Producto u operación
    'producto.compraventa': 15,
    'producto.intermediacion': 10,
    'producto.efectivo': 35,
    'producto.efectivo_sobre_umbral': 30,
    'producto.pago_terceros': 30,
    'producto.transferencia_exterior': 15,
    'producto.activos_virtuales': 35,
    'producto.precio_desviado': 25,
    'producto.reventa_rapida': 20,
  },
  paisesAltoRiesgoGafi: [],
  paisesMonitoreoGafi: [],
  departamentos: {},
  actividades: {},
  nivelMinimoPep: 'alto',
  desviacionPrecio: 0.3,
  reventaRapidaDias: 365,
  sociedadRecienteMeses: 12,
  umbralEfectivoUsd: 10000,
  permitirSimplificada: true,
  actualizacionMeses: { bajo: 36, medio: 24, alto: 12 },
};
