import { describe, expect, it } from 'vitest';
import { fuenteDemo } from '../src/fuente/demo';

describe('fuente de demostración: mismas reglas que la base', () => {
  it('no aprueba con una coincidencia sin disponer ni sin evaluación', async () => {
    const f = fuenteDemo();
    await expect(f.decidir('exp-a', { tipo: 'aprobar', justificacion: 'Expediente completo y coherente con el monto.' }))
      .rejects.toThrow(/coincidencia/);
    await f.disponer('ver-a1', 'descartada', 'Fecha de nacimiento distinta a la del listado.');
    await expect(f.decidir('exp-a', { tipo: 'aprobar', justificacion: 'Expediente completo y coherente con el monto.' }))
      .rejects.toThrow(/Evalúe/);
    await f.evaluar('exp-a', {});
    await f.decidir('exp-a', { tipo: 'aprobar', justificacion: 'Expediente completo y coherente con el monto.' });
    expect((await f.expediente('exp-a')).estado).toBe('aprobado');
  });

  it('el oficial suplente debe indicar el motivo de la suplencia', async () => {
    const f = fuenteDemo();
    await f.iniciarSesion('suplente@example.com', 'x', 'oficial_suplente');
    await f.disponer('ver-a1', 'descartada', 'Fecha de nacimiento distinta a la del listado.');
    await f.evaluar('exp-a', {});
    await expect(f.decidir('exp-a', { tipo: 'aprobar', justificacion: 'Expediente completo y coherente con el monto.' }))
      .rejects.toThrow(/suplente/);
    await f.decidir('exp-a', { tipo: 'aprobar', justificacion: 'Expediente completo y coherente con el monto.', motivoSuplencia: 'Titular de vacaciones esta semana.' });
    expect((await f.expediente('exp-a')).estado).toBe('aprobado');
  });

  it('exige justificación y respeta el máximo de 3 meses de la verificación diferida', async () => {
    const f = fuenteDemo();
    await expect(f.cerrarAlerta('al-b1', 'corto')).rejects.toThrow(/20 caracteres/);
    await f.evaluar('exp-c', {});
    const lejos = new Date(); lejos.setMonth(lejos.getMonth() + 5);
    await expect(f.decidir('exp-c', { tipo: 'aprobar_diferida', justificacion: 'Pendiente solo la apostilla del accionista.', verificacionDiferidaHasta: lejos.toISOString().slice(0, 10) }))
      .rejects.toThrow(/3 meses/);
  });

  it('confirmar una coincidencia abre una alerta con plazo de 24 horas', async () => {
    const f = fuenteDemo();
    await f.disponer('ver-a1', 'coincidencia_confirmada', 'Nombre, fecha de nacimiento y documento coinciden con el listado.');
    const e = await f.expediente('exp-a');
    const a = e.alertas.find((x) => x.senal === 'ONU_CONFIRMADA')!;
    const horas = (new Date(a.venceEn!).getTime() - Date.now()) / 3_600_000;
    expect(Math.round(horas)).toBe(24);
  });
});
