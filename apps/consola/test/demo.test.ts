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
    // A6: el plazo corre desde la detección, no desde la confirmación
    const v = e.verificaciones.find((x) => x.id === 'ver-a1')!;
    expect(new Date(a.venceEn!).getTime() - new Date(v.consultadoEn).getTime()).toBe(24 * 3_600_000);
  });
  it('art. 43: la confirmación deja un bloqueo; la alerta no se cierra sin la comunicación al MP', async () => {
    const f = fuenteDemo();
    await f.disponer('ver-a1', 'coincidencia_confirmada', 'Nombre, fecha de nacimiento y documento coinciden con el listado.');
    let e = await f.expediente('exp-a');
    const b = e.bloqueos[0];
    expect(b.levantadoEn).toBeNull();
    const alerta = e.alertas.find((x) => x.senal === 'ONU_CONFIRMADA')!;
    await expect(f.cerrarAlerta(alerta.id, 'Cierre sin haber comunicado al Ministerio Público')).rejects.toThrow(/Ministerio Público/);
    await expect(f.levantarBloqueo(b.id, 'Exclusión de la persona de la lista del Comité', 'SC/1')).rejects.toThrow(/comunicación/);
    const futuro = new Date(Date.now() + 2 * 86_400_000).toISOString();
    await expect(f.registrarComunicacionMp(b.id, { comunicadoEn: futuro, referencia: 'Oficio 1' })).rejects.toThrow(/futura/);
    const r = await f.registrarComunicacionMp(b.id, { comunicadoEn: new Date().toISOString(), referencia: 'Oficio CUMP-15-2026' });
    expect(r.dentroDePlazo).toBe(true);
    await f.cerrarAlerta(alerta.id, 'Comunicado al Ministerio Público con oficio CUMP-15-2026');
    await f.levantarBloqueo(b.id, 'La persona fue excluida de la lista por el Comité de Sanciones', 'SC/99999');
    e = await f.expediente('exp-a');
    expect(e.bloqueos[0].levantadoEn).not.toBeNull();
  });
});
