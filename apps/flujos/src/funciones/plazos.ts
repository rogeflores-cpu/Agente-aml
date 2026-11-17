import { inngest } from '../cliente-inngest.js';
import { db, notificar, sinError } from '../datos.js';

const HORA = 3_600_000;

/**
 * Art. 43: confirmada la coincidencia, limitar la disposición de fondos bajo
 * administración y comunicar por escrito al Ministerio Público en un plazo que
 * no exceda 24 horas. El flujo abre la alerta, escala a las 20 horas y deja
 * constancia si vence sin cierre.
 */
export const plazoOnu24h = inngest.createFunction(
  { id: 'plazo-onu-24h' },
  { event: 'aml/onu.coincidencia_confirmada' },
  async ({ event, step }) => {
    const { organizacionId, expedienteId, verificacionId, confirmadaEn } = event.data;
    const vence = new Date(new Date(confirmadaEn).getTime() + 24 * HORA);

    const alertaId = await step.run('abrir-alerta', async () => {
      const a = await sinError(db().from('alertas').insert({
        organizacion_id: organizacionId,
        expediente_id: expedienteId,
        senal: 'ONU_CONFIRMADA',
        descripcion: 'Coincidencia confirmada con lista del Consejo de Seguridad. Limitar disposición de fondos y comunicar al Ministerio Público.',
        evidencia: { verificacionId, confirmadaEn },
        vence_en: vence.toISOString(),
      }).select('id').single());
      await notificar(organizacionId, 'cumplimiento', 'Plazo de 24 horas iniciado',
        `Comunicación al Ministerio Público vence el ${vence.toISOString()}.`, { expedienteId, prioridad: 'urgente' });
      return (a as any).id as string;
    });

    const cerrada = await step.waitForEvent('esperar-cierre', {
      event: 'aml/alerta.cerrada',
      timeout: new Date(vence.getTime() - 4 * HORA),
      if: `async.data.alertaId == '${alertaId}'`,
    });
    if (cerrada) return { resultado: 'cerrada_a_tiempo' };

    await step.run('escalar', () =>
      notificar(organizacionId, 'cumplimiento', 'Quedan 4 horas para comunicar al Ministerio Público',
        'La alerta sigue abierta. Titular y suplente deben atenderla.', { expedienteId, prioridad: 'urgente' }));

    const cerradaFinal = await step.waitForEvent('esperar-cierre-final', {
      event: 'aml/alerta.cerrada',
      timeout: vence,
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
