import { describe, expect, it } from 'vitest';
import { fuenteDemo } from '../src/fuente/demo';
import { enmascararEstado, hoyGuatemala, validarOperacion, validarPagoEfectivo } from '../src/fuente/validacion';
import type { NuevaOperacion } from '../src/fuente/tipos';

const CAMPOS_RESERVADOS = /nivel|riesgo|verific|coincid|alerta|decisi|evaluac|examen|bitacora|justific/i;

const nueva: NuevaOperacion = {
  tipo: 'compraventa',
  inmueble: { departamento: 'Escuintla', municipio: 'Puerto San José' },
  precio: 750000,
  moneda: 'GTQ',
  formaPago: [{ medio: 'financiamiento_bancario', monto: 600000, pagador: 'cliente' }, { medio: 'efectivo', monto: 150000, pagador: 'cliente' }],
  partes: [
    { parte: 'comprador', tipoPersona: 'individual', nombre: 'Comprador de Prueba', telefono: '+50255551111' },
    { parte: 'vendedor', tipoPersona: 'individual', nombre: 'Vendedora de Prueba', correo: 'vendedora@example.com' },
  ],
};

async function comoEjecutivo() {
  const f = fuenteDemo();
  await f.iniciarSesion('ejecutivo@demo.example', 'demo', 'ejecutivo');
  return f;
}

describe('vista operativa (art. 38)', () => {
  it('el ejecutivo no recibe ningún campo de cumplimiento', async () => {
    const f = await comoEjecutivo();
    const ops = await f.operaciones('org-demo');
    expect(ops.length).toBeGreaterThan(0);
    for (const o of ops) {
      for (const p of o.partes) {
        expect(Object.keys(p).filter((k) => CAMPOS_RESERVADOS.test(k))).toEqual([]);
        expect(['invitado', 'en_captura', 'en_revision', 'aprobado', 'no_aprobado']).toContain(p.estado);
      }
    }
    expect(JSON.stringify(ops)).not.toMatch(/en_examen|listo_para_decision|posible_coincidencia|ONU/);
  });

  it('un expediente en examen se ve como en revisión', async () => {
    const f = fuenteDemo();
    await f.iniciarSesion('oficial@demo.example', 'demo', 'oficial');
    await f.decidir('exp-c', { tipo: 'abrir_examen', justificacion: 'Pago de tercero desde el exterior sin relación clara.' });
    expect((await f.expediente('exp-c')).estado).toBe('en_examen');
    await f.iniciarSesion('ejecutivo@demo.example', 'demo', 'ejecutivo');
    const parte = (await f.operaciones('org-demo')).flatMap((o) => o.partes).find((p) => p.expedienteId === 'exp-c')!;
    expect(parte.estado).toBe('en_revision');
  });

  it('el ejecutivo no puede abrir la bandeja ni el expediente de cumplimiento', async () => {
    const f = await comoEjecutivo();
    await expect(f.bandeja('org-demo')).rejects.toThrow(/cumplimiento/);
    await expect(f.expediente('exp-a')).rejects.toThrow(/cumplimiento/);
    await expect(f.decidir('exp-a', { tipo: 'aprobar', justificacion: 'Intento del área comercial sin permiso.' })).rejects.toThrow(/cumplimiento/);
  });

  it('los avisos del ejecutivo no incluyen avisos de cumplimiento', async () => {
    const f = await comoEjecutivo();
    const avisos = await f.avisos('org-demo');
    expect(JSON.stringify(avisos)).not.toMatch(/coincidencia|ONU|riesgo/i);
  });

  it('registra una operación: aparece para el ejecutivo y en la bandeja del oficial', async () => {
    const f = await comoEjecutivo();
    const { codigo } = await f.registrarOperacion('org-demo', nueva);
    const op = (await f.operaciones('org-demo')).find((o) => o.codigo === codigo)!;
    expect(op.partes.map((p) => p.estado)).toEqual(['invitado', 'invitado']);
    await f.iniciarSesion('oficial@demo.example', 'demo', 'oficial');
    expect((await f.bandeja('org-demo')).filter((x) => x.codigoOperacion === codigo)).toHaveLength(2);
  });

  it('reenviar enlace: por WhatsApp si hay teléfono, manual si no; no en expedientes resueltos', async () => {
    const f = await comoEjecutivo();
    expect((await f.reenviarEnlace('exp-e')).canal).toBe('whatsapp');
    const manual = await f.reenviarEnlace('exp-b');
    expect(manual.canal).toBe('manual');
    expect(manual.url).toMatch(/^https:\/\//);
    await expect(f.reenviarEnlace('exp-d')).rejects.toThrow(/resuelto/);
  });

  it('efectivo del mismo día que supera USD 10,000 genera aviso para cumplimiento, no para el ejecutivo', async () => {
    const f = await comoEjecutivo();
    const hoy = hoyGuatemala();
    await f.registrarPagoEfectivo({ expedienteId: 'exp-e', fecha: hoy, monto: 40000, moneda: 'GTQ', tipoCambioUsd: 7.7 });
    await f.registrarPagoEfectivo({ expedienteId: 'exp-e', fecha: hoy, monto: 40000, moneda: 'GTQ', tipoCambioUsd: 7.7 });
    expect(JSON.stringify(await f.avisos('org-demo'))).not.toMatch(/art\. 31/);
    await f.iniciarSesion('oficial@demo.example', 'demo', 'oficial');
    expect((await f.avisos('org-demo')).some((a) => /art\. 31/.test(a.asunto))).toBe(true);
  });
});

describe('validaciones', () => {
  it('máscara de estados', () => {
    expect(enmascararEstado('en_examen')).toBe('en_revision');
    expect(enmascararEstado('listo_para_decision')).toBe('en_revision');
    expect(enmascararEstado('aprobado_condicionado')).toBe('aprobado');
    expect(enmascararEstado('abstenido')).toBe('no_aprobado');
    expect(enmascararEstado('en_captura')).toBe('en_captura');
  });

  it('operación: contacto obligatorio, teléfono internacional y pagos no mayores al precio', () => {
    expect(validarOperacion(nueva)).toEqual({});
    const e = validarOperacion({
      ...nueva,
      formaPago: [{ medio: 'efectivo', monto: 800000, pagador: 'cliente' }],
      partes: [{ parte: 'comprador', tipoPersona: 'individual', nombre: 'Ab', telefono: '5555' }, { parte: 'vendedor', tipoPersona: 'individual', nombre: 'Sin Contacto' }],
    });
    expect(Object.keys(e).sort()).toEqual(['formaPago', 'partes.0.nombre', 'partes.0.telefono', 'partes.1.telefono']);
  });

  it('la fecha de hoy es la de Guatemala, no la de UTC', () => {
    // 17 nov 02:00 UTC = 16 nov 20:00 en Guatemala
    expect(hoyGuatemala(new Date('2026-11-17T02:00:00Z'))).toBe('2026-11-16');
    expect(validarPagoEfectivo({ expedienteId: 'x', fecha: '2026-11-17', monto: 1, moneda: 'GTQ', tipoCambioUsd: 7.7 }, new Date('2026-11-17T02:00:00Z')).fecha)
      .toBe('La fecha no puede ser futura');
  });

  it('pago en efectivo: sin fechas futuras ni montos inválidos', () => {
    const hoy = new Date('2026-11-16T12:00:00Z');
    expect(validarPagoEfectivo({ expedienteId: 'x', fecha: '2026-11-16', monto: 10, moneda: 'GTQ', tipoCambioUsd: 7.7 }, hoy)).toEqual({});
    expect(Object.keys(validarPagoEfectivo({ expedienteId: 'x', fecha: '2026-12-01', monto: 0, moneda: 'Q', tipoCambioUsd: 0 }, hoy)).sort())
      .toEqual(['fecha', 'moneda', 'monto', 'tipoCambioUsd']);
  });
});
