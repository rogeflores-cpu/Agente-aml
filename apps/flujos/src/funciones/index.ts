import { anclaBitacora } from './ancla-bitacora.js';
import { actualizarListaYRecotejar, cotejoInicial, recotejarDesignacion } from './cotejo-onu.js';
import { expedienteCreado } from './expediente-creado.js';
import { revisarListaGafi } from './gafi.js';
import { actualizacionPeriodica, plazoOnu24h, posibleCoincidencia, verificacionDiferida } from './plazos.js';
import { whatsappEntrante } from './whatsapp-entrante.js';

export const funciones = [
  expedienteCreado,
  cotejoInicial,
  actualizarListaYRecotejar,
  recotejarDesignacion,
  plazoOnu24h,
  posibleCoincidencia,
  verificacionDiferida,
  actualizacionPeriodica,
  whatsappEntrante,
  revisarListaGafi,
  anclaBitacora,
];
