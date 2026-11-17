import { describe, expect, it } from 'vitest';
import { terminoReservado } from '../../../packages/agente/src/neutralidad';
import { textoSobre } from '../src/componentes/marca';
import { fuenteDemo } from '../src/fuente/demo';
import { validarArchivo } from '../src/fuente/tipos';

const archivo = (nombre: string, tipo = 'image/jpeg', tamano = 1000) =>
  new File([new Uint8Array(tamano)], nombre, { type: tipo });

describe('validación de archivos en el navegador', () => {
  it('acepta fotos y PDF de hasta 10 MB', () => {
    expect(validarArchivo({ size: 1000, type: 'image/jpeg' })).toBeNull();
    expect(validarArchivo({ size: 1000, type: 'application/pdf' })).toBeNull();
  });
  it('rechaza vacíos, grandes y otros formatos', () => {
    expect(validarArchivo({ size: 0, type: 'image/png' })).toMatch(/vacío/);
    expect(validarArchivo({ size: 10 * 1024 * 1024 + 1, type: 'image/png' })).toMatch(/10 MB/);
    expect(validarArchivo({ size: 10, type: 'application/zip' })).toMatch(/Formato/);
  });
});

describe('marca', () => {
  it('elige texto legible sobre el color de la organización', () => {
    expect(textoSobre('#1d4ed8')).toBe('#ffffff');
    expect(textoSobre('#facc15')).toBe('#14213d');
    expect(textoSobre('rojo')).toBe('#ffffff');
  });
});

describe('fuente de demostración', () => {
  it('recorre el flujo completo: datos, documentos, confirmación y envío a revisión', async () => {
    const f = fuenteDemo({ demora: 0 });
    const inicial = await f.cargar();
    expect(inicial.vista.pendientes.length).toBe(7);

    expect(await f.enviarMensaje('Casada')).toMatch(/profesión/);
    await f.enviarMensaje('Arquitecta');
    await f.enviarMensaje('Préstamo bancario y ahorros');
    await f.enviarMensaje('Transferencia desde Guatemala');

    expect((await f.enviarARevision()).enviado).toBe(false);

    expect(await f.subirDocumento(archivo('dpi-frente.jpg'))).toMatch(/correctos/);
    expect((await f.cargar()).vista.pendientes.some((p) => p.tipo === 'aclaracion')).toBe(true);
    await f.enviarMensaje('Sí, son correctos');
    await f.subirDocumento(archivo('recibo-luz.pdf', 'application/pdf'));
    await f.subirDocumento(archivo('carta-prestamo.pdf', 'application/pdf'));

    expect((await f.cargar()).vista.pendientes).toEqual([]);
    expect((await f.enviarARevision()).enviado).toBe(true);
    expect((await f.cargar()).vista.estado).toBe('En revisión');
  });

  it('rechaza archivos no válidos', async () => {
    await expect(fuenteDemo({ demora: 0 }).subirDocumento(archivo('virus.exe', 'application/x-msdownload'))).rejects.toThrow(/Formato/);
  });

  it('el código de WhatsApp tiene 6 dígitos y un enlace wa.me', async () => {
    const c = await fuenteDemo({ demora: 0 }).codigoWhatsapp();
    expect(c.codigo).toMatch(/^\d{6}$/);
    expect(c.enlaceWhatsapp).toBe(`https://wa.me/50255550000?text=${c.codigo}`);
  });

  it('art. 38: ningún texto de la demostración contiene términos reservados', async () => {
    const f = fuenteDemo({ demora: 0 });
    for (const t of ['Soltero', 'Contador', 'Ahorros', 'Cheque']) await f.enviarMensaje(t);
    await f.subirDocumento(archivo('dpi.jpg'));
    await f.enviarMensaje('no');
    const e = await f.cargar();
    for (const m of e.conversacion) expect(terminoReservado(m.texto), m.texto).toBeNull();
    for (const p of e.vista.pendientes) expect(terminoReservado(p.descripcion)).toBeNull();
  });
});
