import { describe, expect, it } from 'vitest';
import { fuenteDemo } from '../src/fuente/demo';
import { leerCodigosIso, nitVerificadorCorrecto, subdominioValido, sugerirSubdominio } from '../src/validacion';

const nueva = {
  nombreLegal: 'Inmuebles del Valle, S.A.', nombreComercial: 'Inmuebles del Valle', nit: '576-2', actividad: 'inmobiliaria',
  subdominio: 'inmuebles-del-valle', marca: { nombreVisible: 'Inmuebles del Valle', colorPrimario: '#1d4ed8' },
};

describe('validaciones de la interfaz', () => {
  it('sugiere un subdominio válido a partir del nombre', () => {
    const s = sugerirSubdominio('Bienes Raíces Ñandú & Asociados, S.A.');
    expect(s).toBe('bienes-raices-nandu-asociados-s-a');
    expect(subdominioValido(s)).toBe(true);
  });
  it('lee códigos ISO y separa los inválidos', () => {
    expect(leerCodigosIso('kp, IR mm;  xyz 1A')).toEqual({ validos: ['KP', 'IR', 'MM'], invalidos: ['XYZ', '1A'] });
  });
  it('dígito verificador del NIT', () => {
    expect(nitVerificadorCorrecto('576-2')).toBe(true);
    expect(nitVerificadorCorrecto('576-9')).toBe(false);
  });
});

describe('fuente de demostración: mismas reglas que el servidor', () => {
  it('una organización nueva nace con la metodología sin aprobar y no lista para operar', async () => {
    const f = fuenteDemo();
    const r = await f.crearOrganizacion(nueva);
    expect(r.advertencias.join(' ')).toMatch(/IVE/);
    const d = await f.organizacion(r.id);
    expect(d.configuraciones).toHaveLength(1);
    expect(d.configuraciones[0].aprobadaEn).toBeNull();
    expect(d.estado.listaParaOperar).toBe(false);
  });

  it('rechaza subdominio repetido o reservado', async () => {
    const f = fuenteDemo();
    await expect(f.crearOrganizacion({ ...nueva, subdominio: 'demo-inmuebles' })).rejects.toThrow(/en uso/);
    await expect(f.crearOrganizacion({ ...nueva, subdominio: 'consola' })).rejects.toThrow(/Subdominio/);
  });

  it('queda lista para operar con metodología aprobada, oficial, WhatsApp activo e inscripción IVE', async () => {
    const f = fuenteDemo();
    const { id } = await f.crearOrganizacion(nueva);
    await f.invitarUsuario(id, 'oficial@valle.example', 'oficial');
    await f.aprobarMetodologia(id, { organo: 'Consejo de Administración', fecha: '2026-11-10', acta: '15-2026' });
    await expect(f.aprobarMetodologia(id, { organo: 'Consejo', fecha: '2026-11-10', acta: '1' })).rejects.toThrow(/pendiente/);
    const w = await f.conectarWhatsapp(id, { wabaId: '1', phoneNumberId: '999', numeroVisible: '+502 5555 0001', nombreVisible: 'Valle', token: 'x'.repeat(30) });
    expect(w.estado).toBe('activo');
    expect((await f.organizacion(id)).estado.listaParaOperar).toBe(false);
    await f.actualizarOrganizacion(id, { inscripcionIve: 'IVE-PO-0099-2026' });
    expect((await f.organizacion(id)).estado.listaParaOperar).toBe(true);
  });

  it('no conecta un número de otra organización y no acepta fechas futuras de aprobación', async () => {
    const f = fuenteDemo();
    const { id } = await f.crearOrganizacion(nueva);
    await expect(f.conectarWhatsapp(id, { wabaId: '1', phoneNumberId: '200000000000001', numeroVisible: '+502 5555 0002', nombreVisible: 'x', token: 'x'.repeat(30) }))
      .rejects.toThrow(/otra organización/);
    await expect(f.aprobarMetodologia(id, { organo: 'Consejo', fecha: '2999-01-01', acta: '1' })).rejects.toThrow(/futura/);
  });

  it('listas GAFI: sin traslape y una versión por pleno', async () => {
    const f = fuenteDemo();
    const base = { plenario: '2026-10-30', altoRiesgo: ['AA'], monitoreo: ['BB'], fuenteAltoRiesgo: 'https://www.fatf-gafi.org/a', fuenteMonitoreo: 'https://www.fatf-gafi.org/b' };
    await expect(f.cargarListaGafi({ ...base, monitoreo: ['AA'] })).rejects.toThrow(/ambas/);
    await f.cargarListaGafi(base);
    await expect(f.cargarListaGafi(base)).rejects.toThrow(/pleno/);
    expect((await f.listasGafi())[0].plenario).toBe('2026-10-30');
  });
});
