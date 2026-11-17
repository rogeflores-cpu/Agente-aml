import { describe, expect, it } from 'vitest';
import { cambiosEntreVersiones, cotejar, jaroWinkler, parsearListaOnu, tokensEntidad, tokensPersona } from '../src/index.js';

// Lista de ejemplo con nombres ficticios y la estructura del XML de la ONU.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<CONSOLIDATED_LIST dateGenerated="2026-11-10T00:00:00Z">
  <INDIVIDUALS>
    <INDIVIDUAL>
      <DATAID>1</DATAID>
      <FIRST_NAME>Marcos</FIRST_NAME><SECOND_NAME>Ernesto</SECOND_NAME><THIRD_NAME>Villatoro</THIRD_NAME>
      <UN_LIST_TYPE>Ficticia</UN_LIST_TYPE><REFERENCE_NUMBER>XXi.001</REFERENCE_NUMBER><LISTED_ON>2020-01-15</LISTED_ON>
      <NATIONALITY><VALUE>Ficticia</VALUE></NATIONALITY>
      <INDIVIDUAL_ALIAS><QUALITY>Good</QUALITY><ALIAS_NAME>El Contador</ALIAS_NAME></INDIVIDUAL_ALIAS>
      <INDIVIDUAL_ALIAS><QUALITY>Low</QUALITY><ALIAS_NAME>Marco Villatoro</ALIAS_NAME></INDIVIDUAL_ALIAS>
      <INDIVIDUAL_DATE_OF_BIRTH><TYPE_OF_DATE>EXACT</TYPE_OF_DATE><DATE>1975-03-02</DATE></INDIVIDUAL_DATE_OF_BIRTH>
      <INDIVIDUAL_DOCUMENT><TYPE_OF_DOCUMENT>Passport</TYPE_OF_DOCUMENT><NUMBER>P000111</NUMBER></INDIVIDUAL_DOCUMENT>
    </INDIVIDUAL>
    <INDIVIDUAL>
      <DATAID>2</DATAID>
      <FIRST_NAME>Rosa</FIRST_NAME><SECOND_NAME>Amelia</SECOND_NAME><THIRD_NAME>Quintanilla</THIRD_NAME>
      <UN_LIST_TYPE>Ficticia</UN_LIST_TYPE><REFERENCE_NUMBER>XXi.002</REFERENCE_NUMBER>
      <INDIVIDUAL_DATE_OF_BIRTH><TYPE_OF_DATE>APPROXIMATELY</TYPE_OF_DATE><YEAR>1981</YEAR></INDIVIDUAL_DATE_OF_BIRTH>
    </INDIVIDUAL>
  </INDIVIDUALS>
  <ENTITIES>
    <ENTITY>
      <DATAID>3</DATAID><FIRST_NAME>Inversiones Caribe Norte, S.A.</FIRST_NAME>
      <UN_LIST_TYPE>Ficticia</UN_LIST_TYPE><REFERENCE_NUMBER>XXe.001</REFERENCE_NUMBER>
      <ENTITY_ALIAS><QUALITY>Good</QUALITY><ALIAS_NAME>Caribe Norte Holdings Ltd</ALIAS_NAME></ENTITY_ALIAS>
    </ENTITY>
  </ENTITIES>
</CONSOLIDATED_LIST>`;

const lista = parsearListaOnu(XML);

describe('normalización', () => {
  it('quita tildes, signos y partículas', () => {
    expect(tokensPersona('José de la Cruz Pérez-López')).toEqual(['JOSE', 'CRUZ', 'PEREZ', 'LOPEZ']);
    expect(tokensEntidad('Inversiones Caribe Norte, S.A.')).toEqual(['INVERSIONES', 'CARIBE', 'NORTE']);
  });
  it('Jaro-Winkler en rangos esperados', () => {
    expect(jaroWinkler('MARTHA', 'MARHTA')).toBeCloseTo(0.961, 3);
    expect(jaroWinkler('PEREZ', 'PEREZ')).toBe(1);
    expect(jaroWinkler('PEREZ', 'LOPEZ')).toBeLessThan(0.8);
  });
});

describe('lista ONU', () => {
  it('interpreta individuos, alias, fechas y entidades', () => {
    expect(lista.generadaEl).toBe('2026-11-10T00:00:00Z');
    expect(lista.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(lista.registros).toHaveLength(3);
    const m = lista.registros[0];
    expect(m.nombre).toBe('Marcos Ernesto Villatoro');
    expect(m.alias).toEqual(['El Contador', 'Marco Villatoro']);
    expect(m.fechasNacimiento).toEqual(['1975-03-02']);
    expect(lista.registros[1].fechasNacimiento).toEqual(['1981']);
  });

  it('detecta el nombre con distinto orden, sin tildes y con un apellido adicional', () => {
    const r = cotejar({ nombre: 'Villatoro Marcos Ernésto Ramírez', tipo: 'individual', fechaNacimiento: '1975-03-02' }, lista.registros);
    expect(r[0]?.referencia).toBe('XXi.001');
    expect(r[0]?.fechaNacimiento).toBe('coincide');
    expect(r[0]?.prioridad).toBe('alta');
  });

  it('detecta variantes ortográficas y marca la fecha distinta sin descartar', () => {
    const r = cotejar({ nombre: 'Rosa Amelia Kintanilla', tipo: 'individual', fechaNacimiento: '1990-06-01' }, lista.registros);
    expect(r[0]?.referencia).toBe('XXi.002');
    expect(r[0]?.fechaNacimiento).toBe('difiere');
  });

  it('coteja entidades por alias ignorando la forma societaria', () => {
    const r = cotejar({ nombre: 'CARIBE NORTE HOLDINGS LIMITADA', tipo: 'entidad' }, lista.registros);
    expect(r[0]?.referencia).toBe('XXe.001');
  });

  it('no reporta coincidencias por un solo nombre de pila', () => {
    expect(cotejar({ nombre: 'Marcos Gutiérrez Pineda', tipo: 'individual' }, lista.registros)).toEqual([]);
    expect(cotejar({ nombre: 'Rosa María López', tipo: 'individual' }, lista.registros)).toEqual([]);
  });

  it('no mezcla personas con entidades', () => {
    expect(cotejar({ nombre: 'Marcos Ernesto Villatoro', tipo: 'entidad' }, lista.registros)).toEqual([]);
  });

  it('identifica altas, cambios y bajas entre versiones', () => {
    const nueva = parsearListaOnu(XML.replace('Quintanilla', 'Quintanilla Ruiz').replace(/<ENTITIES>[\s\S]*<\/ENTITIES>/, '<ENTITIES/>'));
    const c = cambiosEntreVersiones(lista.registros, nueva.registros);
    expect(c.modificados.map((r) => r.referencia)).toEqual(['XXi.002']);
    expect(c.retirados).toEqual(['XXe.001']);
    expect(c.agregados).toEqual([]);
  });
});
