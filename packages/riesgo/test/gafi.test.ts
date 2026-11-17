import { describe, expect, it } from 'vitest';
import { aplicarListaGafi, configuracionBaseInmobiliaria as base, evaluar, listaGafiDesactualizada } from '../src/index.js';

describe('listas GAFI', () => {
  const lista = { plenario: '2026-10-30', altoRiesgo: ['aa', 'BB'], monitoreo: ['CC', 'BB'] };

  it('incorpora la versión vigente y normaliza los códigos', () => {
    const c = aplicarListaGafi(base, lista);
    expect(c.paisesAltoRiesgoGafi).toEqual(['AA', 'BB']);
    expect(c.paisesMonitoreoGafi).toEqual(['CC']); // un país de alto riesgo no queda también en monitoreo
  });

  it('el motor aplica intensificada con la lista cargada', () => {
    const c = aplicarListaGafi(base, lista);
    const r = evaluar({
      parte: 'comprador', tipoPersona: 'individual', esPep: false, vinculoPep: false,
      contratistaOProveedorEstado: false, sinFinesDeLucro: false, fideicomiso: false, noDomiciliado: false,
      beneficiarioFinalIdentificado: true, nacionalidad: 'AA', presencial: true, intermediario: false,
      actuaPorRepresentacion: false, tipoOperacion: 'compraventa', pagos: [], origenFondosDeclarado: true,
      ddcCompleta: true, transaccionInusual: false, coincidenciaOnu: 'ninguna',
    }, c);
    expect(r.medidas).toBe('intensificada');
  });

  it('detecta cuando falta cargar un pleno', () => {
    expect(listaGafiDesactualizada('2026-10-30', new Date('2027-01-15T00:00:00Z'))).toBe(false);
    expect(listaGafiDesactualizada('2026-06-19', new Date('2026-11-25T00:00:00Z'))).toBe(true);
  });
});
