import { describe, expect, it } from 'vitest';
import { camposPara, CAMPOS, DOCUMENTOS, documentosPara, revisar, terminoReservado, type Dato } from '../src/index.js';

const d = (valor: unknown, origen: Dato['origen'] = 'cliente'): Dato => ({ valor, origen, confirmado: true });
const hoy = new Date('2026-11-11T12:00:00Z');

/** Comprador individual con todo completo. */
function compradorCompleto(): Record<string, Dato> {
  const datos: Record<string, Dato> = {};
  for (const c of camposPara({ parte: 'comprador', tipoPersona: 'individual' })) {
    if (!c.opcional) datos[c.campo] = d(c.opciones ? c.opciones[0] : 'x');
  }
  datos['cliente.nombre_completo'] = d('Ana Lucía Pérez Gómez');
  datos['cliente.documento_numero'] = d('2345 67890 0101');
  datos['cliente.fecha_nacimiento'] = d('1985-04-12');
  datos['doc.dpi.nombre_completo'] = d('ANA LUCIA PEREZ GOMEZ', 'documento');
  datos['doc.dpi.cui'] = d('2345678900101', 'documento');
  datos['doc.dpi.fecha_nacimiento'] = d('12/04/1985', 'documento');
  datos['doc.dpi.fecha_vencimiento'] = d('2030-04-12', 'documento');
  datos['doc.recibo_servicio.fecha_emision'] = d('2026-10-20', 'documento');
  return datos;
}
const docsComprador = ['dpi', 'recibo_servicio', 'nit_rtu', 'soporte_origen_fondos'].map((clave) => ({ clave, estado: 'extraido' as const }));

describe('catálogo', () => {
  it('ningún texto que ve el cliente contiene términos reservados (art. 38)', () => {
    for (const c of CAMPOS) {
      expect(terminoReservado(c.pregunta), c.campo).toBeNull();
      expect(terminoReservado(c.etiqueta), c.campo).toBeNull();
    }
    for (const doc of DOCUMENTOS) {
      expect(terminoReservado(doc.nombre), doc.clave).toBeNull();
      expect(terminoReservado(doc.explicacion), doc.clave).toBeNull();
    }
  });

  it('origen de fondos solo para el comprador; certificación registral solo para el vendedor', () => {
    const c = camposPara({ parte: 'comprador', tipoPersona: 'individual' }).map((x) => x.campo);
    const v = camposPara({ parte: 'vendedor', tipoPersona: 'individual' }).map((x) => x.campo);
    expect(c).toContain('origen_fondos.descripcion');
    expect(v).not.toContain('origen_fondos.descripcion');
    expect(documentosPara({ parte: 'vendedor', tipoPersona: 'individual' }).map((x) => x.clave)).toContain('certificacion_registral');
    expect(documentosPara({ parte: 'comprador', tipoPersona: 'individual' }).map((x) => x.clave)).not.toContain('certificacion_registral');
  });

  it('persona jurídica pide beneficiarios finales y documentos societarios', () => {
    const c = camposPara({ parte: 'comprador', tipoPersona: 'juridica' }).map((x) => x.campo);
    expect(c).toContain('beneficiarios_finales');
    expect(documentosPara({ parte: 'comprador', tipoPersona: 'juridica' }).map((x) => x.clave))
      .toEqual(expect.arrayContaining(['escritura_constitutiva', 'nombramiento_representante', 'registro_accionistas']));
  });
});

describe('revisor', () => {
  it('expediente completo y coherente: sin pendientes', () => {
    const r = revisar({ contexto: { parte: 'comprador', tipoPersona: 'individual' }, datos: compradorCompleto(), documentos: docsComprador, hoy });
    expect(r.pendientes).toEqual([]);
    expect(r.completo).toBe(true);
  });

  it('expediente vacío: todo faltante', () => {
    const r = revisar({ contexto: { parte: 'comprador', tipoPersona: 'individual' }, datos: {}, documentos: [], hoy });
    expect(r.completo).toBe(false);
    expect(r.pendientes.every((p) => p.tipo === 'faltante')).toBe(true);
    expect(r.avance.campos[0]).toBe(0);
  });

  it('pasaporte sustituye al DPI', () => {
    const docs = docsComprador.map((x) => (x.clave === 'dpi' ? { ...x, clave: 'pasaporte' } : x));
    const r = revisar({ contexto: { parte: 'comprador', tipoPersona: 'individual' }, datos: compradorCompleto(), documentos: docs, hoy });
    expect(r.pendientes.find((p) => p.referencia === 'dpi')).toBeUndefined();
  });

  it('documento ilegible pide reenvío', () => {
    const docs = docsComprador.map((x) => (x.clave === 'dpi' ? { clave: 'dpi', estado: 'observado' as const, motivo: 'La foto está borrosa.' } : x));
    const r = revisar({ contexto: { parte: 'comprador', tipoPersona: 'individual' }, datos: compradorCompleto(), documentos: docs, hoy });
    expect(r.pendientes).toContainEqual({ tipo: 'ilegible', referencia: 'dpi', descripcion: 'DPI (ambos lados): La foto está borrosa.' });
  });

  it('detecta contradicciones entre lo declarado y el DPI', () => {
    const datos = compradorCompleto();
    datos['cliente.nombre_completo'] = d('Ana María López Ruiz');
    datos['cliente.documento_numero'] = d('2345678900199');
    datos['cliente.fecha_nacimiento'] = d('1986-04-12');
    const r = revisar({ contexto: { parte: 'comprador', tipoPersona: 'individual' }, datos, documentos: docsComprador, hoy });
    expect(r.pendientes.filter((p) => p.tipo === 'contradiccion').map((p) => p.referencia).sort())
      .toEqual(['cliente.documento_numero', 'cliente.fecha_nacimiento', 'cliente.nombre_completo']);
  });

  it('acepta diferencias de tildes, mayúsculas y orden en el nombre', () => {
    const datos = compradorCompleto();
    datos['cliente.nombre_completo'] = d('Pérez Gómez, Ana Lucía');
    const r = revisar({ contexto: { parte: 'comprador', tipoPersona: 'individual' }, datos, documentos: docsComprador, hoy });
    expect(r.pendientes.find((p) => p.tipo === 'contradiccion')).toBeUndefined();
  });

  it('DPI vencido y recibo antiguo', () => {
    const datos = compradorCompleto();
    datos['doc.dpi.fecha_vencimiento'] = d('2026-01-01', 'documento');
    datos['doc.recibo_servicio.fecha_emision'] = d('2026-05-01', 'documento');
    const r = revisar({ contexto: { parte: 'comprador', tipoPersona: 'individual' }, datos, documentos: docsComprador, hoy });
    expect(r.pendientes.filter((p) => p.tipo === 'vencido').map((p) => p.referencia)).toEqual(['dpi', 'recibo_servicio']);
  });

  it('pago por un tercero exige identificarlo', () => {
    const datos = compradorCompleto();
    datos['origen_fondos.pagador'] = d('otra persona o empresa');
    const r = revisar({ contexto: { parte: 'comprador', tipoPersona: 'individual' }, datos, documentos: docsComprador, hoy });
    expect(r.pendientes.map((p) => p.referencia)).toContain('origen_fondos.pagador_identificacion');
    datos['origen_fondos.pagador_identificacion'] = d('Carlos Pérez, DPI 1234567890101, padre');
    expect(revisar({ contexto: { parte: 'comprador', tipoPersona: 'individual' }, datos, documentos: docsComprador, hoy }).completo).toBe(true);
  });

  it('vendedor que no es el titular registral: pide aclaración', () => {
    const datos: Record<string, Dato> = {
      'cliente.nombre_completo': d('Luis Gómez Ramírez'),
      'doc.certificacion_registral.propietarios': d(['MARTA ELENA SOTO DE LEON'], 'documento'),
    };
    const r = revisar({ contexto: { parte: 'vendedor', tipoPersona: 'individual' }, datos, documentos: [], hoy });
    expect(r.pendientes.find((p) => p.referencia === 'certificacion_registral' && p.tipo === 'aclaracion')).toBeDefined();
  });

  it('todas las descripciones de pendientes son neutras', () => {
    const datos = compradorCompleto();
    datos['cliente.nombre_completo'] = d('Otra Persona');
    datos['doc.dpi.fecha_vencimiento'] = d('2020-01-01', 'documento');
    datos['origen_fondos.pagador'] = d('otra persona o empresa');
    const r = revisar({ contexto: { parte: 'comprador', tipoPersona: 'individual' }, datos, documentos: [], hoy });
    for (const p of r.pendientes) expect(terminoReservado(p.descripcion)).toBeNull();
  });
});
