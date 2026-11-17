import { inngest } from '../cliente-inngest.js';
import { db, notificar, sinError } from '../datos.js';

const HORA = 3_600_000;

/**
 * Plazos del art. 43, contados desde la DETECCIÓN de la coincidencia (A6):
 * vence a las 24 horas; se escala si a las 4 horas el oficial no la ha
 * dispuesto, y otra vez cuando quedan 4 horas.
 */
export function plazosArt43(detectadaEn: string | Date) {
  const inicio = new Date(detectadaEn).getTime();
  return {
    vence: new Date(inicio + 24 * HORA),
    escalarSinDisponer: new Date(inicio + 4 * HORA),
    escalarFinal: new Date(inicio + 20 * HORA),
  };
}

/**
 * Posible coincidencia detectada: el plazo ya corre. Si el oficial no la
 * dispone en 4 horas se escala al titular y al suplente; si la descarta, la
 * alerta se cierra sola; si la confirma, sigue el flujo plazo-onu-24h con el
 * mismo vencimiento.
 */
export const posibleCoincidencia = inngest.createFunction(
  { id: 'onu-posible-coincidencia' },
  { event: 'aml/onu.posible_coincidencia' },
  async ({ event, step }) => {
    const { organizacionId, expedienteId, verificacionId, alertaId, detectadaEn } = event.data;
    const p = plazosArt43(detectadaEn);
    const dispuesta = (id: string, timeout: Date) =>
      step.waitForEvent(id, { event: 'aml/verificacion.dispuesta', timeout, if: `async.data.verificacionId == '${verificacionId}'` });

    let d = await dispuesta('esperar-disposicion', p.escalarSinDisponer);
    if (!d) {
      await step.run('escalar-sin-disponer', () =>
        notificar(organizacionId, 'cumplimiento', 'Posible coincidencia sin disponer después de 4 horas',
          `El plazo del art. 43 vence el ${p.vence.toISOString()}. Titular y suplente deben disponerla.`,
          { expedienteId, prioridad: 'urgente' }));
      d = await dispuesta('esperar-disposicion-2', p.escalarFinal);
    }
    if (!d) {
      await step.run('escalar-final', () =>
        notificar(organizacionId, 'cumplimiento', 'Quedan 4 horas del plazo del art. 43',
          'La posible coincidencia sigue sin disponer.', { expedienteId, prioridad: 'urgente' }));
      d = await dispuesta('esperar-disposicion-3', p.vence);
    }
    if (!d) {
      await step.run('constancia-vencimiento', async () => {
        await sinError(db().from('alertas')
          .update({ evidencia: { verificacionId, detectadaEn, plazoVencidoSinDisponer: new Date().toISOString() } })
          .eq('id', alertaId));
        await notificar(organizacionId, 'cumplimiento', 'Venció el plazo de 24 horas sin disponer la coincidencia',
          'Se dejó constancia en la alerta y en la bitácora.', { expedienteId, prioridad: 'urgente' });
      });
      return { resultado: 'vencido_sin_disponer' };
    }
    if (d.data.resultado === 'descartada') {
      await step.run('cerrar-alerta', () =>
        sinError(db().from('alertas')
          .update({ estado: 'cerrada', cierre: 'Coincidencia descartada por el oficial de cumplimiento (ver la justificación en la verificación).', cerrada_en: new Date().toISOString() })
          .eq('id', alertaId).neq('estado', 'cerrada')));
      return { resultado: 'descartada' };
    }
    return { resultado: 'confirmada' };
  },
);

/**
 * Art. 43: confirmada la coincidencia, limitar con efecto preventivo la
 * disposición de fondos o activos bajo su administración y comunicar por
 * escrito al Ministerio Público en un plazo que no exceda de 24 horas. El
 * plazo se cuenta desde la detección (consultado_en de la verificación), no
 * desde la confirmación. Reutiliza la alerta de la posible coincidencia.
 */
export const plazoOnu24h = inngest.createFunction(
  { id: 'plazo-onu-24h' },
  { event: 'aml/onu.coincidencia_confirmada' },
  async ({ event, step }) => {
    const { organizacionId, expedienteId, verificacionId, confirmadaEn } = event.data;

    const { alertaId, vence } = await step.run('abrir-alerta', async () => {
      const v = await sinError(db().from('verificaciones').select('consultado_en').eq('id', verificacionId).maybeSingle());
      const detectada = (v as { consultado_en?: string } | null)?.consultado_en ?? confirmadaEn;
      const p = plazosArt43(detectada);
      const descripcion = 'Coincidencia confirmada con las listas del Consejo de Seguridad (art. 43). Limite con efecto preventivo la disposición de fondos o activos bajo su administración y comunique por escrito al Ministerio Público, con la documentación, dentro de las 24 horas desde la detección.';
      const previa = (await sinError(
        db().from('alertas').select('id').eq('expediente_id', expedienteId).eq('senal', 'ONU_POSIBLE')
          .contains('evidencia', { verificacionId }).neq('estado', 'cerrada').limit(1).maybeSingle(),
      )) as { id: string } | null;
      let id = previa?.id;
      if (id) {
        await sinError(db().from('alertas').update({
          senal: 'ONU_CONFIRMADA', descripcion,
          evidencia: { verificacionId, detectadaEn: detectada, confirmadaEn },
        }).eq('id', id));
      } else {
        const a = await sinError(db().from('alertas').insert({
          organizacion_id: organizacionId, expediente_id: expedienteId, senal: 'ONU_CONFIRMADA', descripcion,
          evidencia: { verificacionId, detectadaEn: detectada, confirmadaEn }, vence_en: p.vence.toISOString(),
        }).select('id').single());
        id = (a as { id: string }).id;
      }
      await notificar(organizacionId, 'cumplimiento', 'Coincidencia confirmada: comunicación al Ministerio Público',
        `El plazo de 24 horas vence el ${p.vence.toISOString()} (contado desde la detección).`, { expedienteId, prioridad: 'urgente' });
      return { alertaId: id!, vence: p.vence.toISOString() };
    });
    const venceEn = new Date(vence);

    const cerrada = await step.waitForEvent('esperar-cierre', {
      event: 'aml/alerta.cerrada',
      timeout: new Date(Math.max(Date.now() + 60_000, venceEn.getTime() - 4 * HORA)),
      if: `async.data.alertaId == '${alertaId}'`,
    });
    if (cerrada) return { resultado: 'cerrada_a_tiempo' };

    await step.run('escalar', () =>
      notificar(organizacionId, 'cumplimiento', 'Quedan pocas horas para comunicar al Ministerio Público',
        'La alerta sigue abierta. Titular y suplente deben atenderla.', { expedienteId, prioridad: 'urgente' }));

    const cerradaFinal = await step.waitForEvent('esperar-cierre-final', {
      event: 'aml/alerta.cerrada',
      timeout: new Date(Math.max(Date.now() + 60_000, venceEn.getTime())),
      if: `async.data.alertaId == '${alertaId}'`,
    });
    if (cerradaFinal) return { resultado: 'cerrada_tras_escalar' };

    await step.run('constancia-vencimiento', async () => {
      await sinError(db().from('alertas')
        .update({ evidencia: { verificacionId, confirmadaEn, plazoVencido: new Date().toISOString() } })
        .eq('id', alertaId));
      await notificar(organizacionId, 'cumplimiento', 'Plazo de 24 horas vencido',
        'Se dejó constancia del vencimiento en la alerta y en la bitácora.', { expedienteId, prioridad: 'urgente' });
    });
    return { resultado: 'vencido' };
  },
);

/**
 * Art. 22: la verificación diferida no puede exceder 3 meses. Aviso 15 días
 * antes y, si vence sin completarse, propuesta de terminar la relación y
 * examinar la procedencia de un RTS (la decisión es del oficial).
 */
export const verificacionDiferida = inngest.createFunction(
  { id: 'verificacion-diferida' },
  { event: 'aml/expediente.aprobado_diferido' },
  async ({ event, step }) => {
    const { organizacionId, expedienteId, hasta } = event.data;
    const limite = new Date(`${hasta}T23:59:59-06:00`);

    const completado = await step.waitForEvent('esperar-completado', {
      event: 'aml/expediente.diferido_completado',
      timeout: new Date(limite.getTime() - 15 * 24 * HORA),
      if: `async.data.expedienteId == '${expedienteId}'`,
    });
    if (completado) return { resultado: 'completado' };

    await step.run('aviso-15-dias', () =>
      notificar(organizacionId, 'cumplimiento', 'Verificación diferida vence en 15 días',
        `El expediente debe completarse antes del ${hasta}.`, { expedienteId, prioridad: 'alta' }));

    const completadoFinal = await step.waitForEvent('esperar-completado-final', {
      event: 'aml/expediente.diferido_completado',
      timeout: limite,
      if: `async.data.expedienteId == '${expedienteId}'`,
    });
    if (completadoFinal) return { resultado: 'completado' };

    await step.run('vencimiento', async () => {
      await sinError(db().from('alertas').insert({
        organizacion_id: organizacionId,
        expediente_id: expedienteId,
        senal: 'DIFERIDA_VENCIDA',
        descripcion: 'Venció el plazo de verificación diferida. Evaluar terminar la relación y examinar la procedencia de un RTS (art. 22).',
        evidencia: { hasta },
      }));
      await notificar(organizacionId, 'cumplimiento', 'Verificación diferida vencida',
        'Se abrió una alerta para su decisión.', { expedienteId, prioridad: 'urgente' });
    });
    return { resultado: 'vencido' };
  },
);

/** Art. 22: actualización periódica. Avisa 30 días antes de la fecha programada. */
export const actualizacionPeriodica = inngest.createFunction(
  { id: 'actualizacion-periodica' },
  { cron: 'TZ=America/Guatemala 0 7 * * 1' },
  async ({ step }) => {
    return step.run('buscar-vencimientos', async () => {
      const limite = new Date(Date.now() + 30 * 24 * HORA).toISOString().slice(0, 10);
      const clientes = await sinError(
        db().from('clientes').select('id, organizacion_id, nombre, nivel_riesgo, proxima_actualizacion')
          .lte('proxima_actualizacion', limite),
      );
      for (const c of clientes as any[]) {
        await notificar(c.organizacion_id, 'cumplimiento', 'Actualización de cliente próxima',
          `${c.nombre} (riesgo ${c.nivel_riesgo ?? 'sin calificar'}) debe actualizarse antes del ${c.proxima_actualizacion}.`);
      }
      return { avisos: (clientes as any[]).length };
    });
  },
);
