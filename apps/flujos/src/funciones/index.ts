import { actualizarListaYRecotejar, cotejoInicial } from './cotejo-onu.js';
import { expedienteCreado } from './expediente-creado.js';
import { revisarListaGafi } from './gafi.js';
import { actualizacionPeriodica, plazoOnu24h, verificacionDiferida } from './plazos.js';
import { whatsappEntrante } from './whatsapp-entrante.js';

export const funciones = [
  expedienteCreado,
  cotejoInicial,
  actualizarListaYRecotejar,
  plazoOnu24h,
  verificacionDiferida,
  actualizacionPeriodica,
  whatsappEntrante,
  revisarListaGafi,
];
