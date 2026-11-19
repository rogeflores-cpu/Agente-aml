import { describe, expect, it } from 'vitest';
import { cotejar, fechaOfac, parsearListaOfac } from '../src/index.js';

const XML = `<?xml version="1.0" standalone="yes"?>
<sdnList xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/XML">
  <publshInformation><Publish_Date>11/18/2026</Publish_Date><Record_Count>3</Record_Count></publshInformation>
  <sdnEntry>
    <uid>1001</uid><firstName>Juan Carlos</firstName><lastName>MENDEZ ORELLANA</lastName><sdnType>Individual</sdnType>
    <programList><program>SDNTK</program><program>ILLICIT-DRUGS-EO14059</program></programList>
    <idList><id><uid>1</uid><idType>Passport</idType><idNumber>A1234567</idNumber><idCountry>Guatemala</idCountry></id></idList>
    <akaList><aka><uid>2</uid><type>a.k.a.</type><category>strong</category><lastName>EL CONTADOR</lastName></aka></akaList>
    <dateOfBirthList><dateOfBirthItem><uid>3</uid><dateOfBirth>14 Mar 1975</dateOfBirth><mainEntry>true</mainEntry></dateOfBirthItem></dateOfBirthList>
    <nationalityList><nationality><uid>4</uid><country>Guatemala</country><mainEntry>true</mainEntry></nationality></nationalityList>
  </sdnEntry>
  <sdnEntry>
    <uid>1002</uid><lastName>INVERSIONES EJEMPLO, S.A.</lastName><sdnType>Entity</sdnType>
    <programList><program>SDNTK</program></programList>
  </sdnEntry>
  <sdnEntry>
    <uid>1003</uid><lastName>BARCO EJEMPLO</lastName><sdnType>Vessel</sdnType>
    <programList><program>IRAN</program></programList>
  </sdnEntry>
</sdnList>`;

describe('lista SDN de OFAC', () => {
  it('lee personas y entidades, con alias, documentos, fechas y programas; omite buques', () => {
    const l = parsearListaOfac(XML);
    expect(l.generadaEl).toBe('11/18/2026');
    expect(l.registros).toHaveLength(2);
    const [p, e] = l.registros;
    expect(p).toMatchObject({
      referencia: 'OFAC-1001', tipo: 'individual', nombre: 'Juan Carlos MENDEZ ORELLANA', alias: ['EL CONTADOR'],
      documentos: ['A1234567'], fechasNacimiento: ['1975-03-14'], nacionalidades: ['Guatemala'],
    });
    expect(p.lista).toBe('OFAC SDN · SDNTK, ILLICIT-DRUGS-EO14059');
    expect(e).toMatchObject({ referencia: 'OFAC-1002', tipo: 'entidad', nombre: 'INVERSIONES EJEMPLO, S.A.' });
    expect(l.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('se coteja con el mismo motor que la ONU', () => {
    const { registros } = parsearListaOfac(XML);
    const r = cotejar({ nombre: 'Juan Carlos Méndez Orellana', tipo: 'individual', fechaNacimiento: '1975-03-14' }, registros);
    expect(r[0]).toMatchObject({ referencia: 'OFAC-1001', prioridad: 'alta' });
  });
  it('rechaza un archivo con otro formato o sin registros', () => {
    expect(() => parsearListaOfac('<otro/>')).toThrow();
    expect(() => parsearListaOfac('<sdnList><publshInformation/></sdnList>')).toThrow();
  });
  it('convierte las fechas de OFAC', () => {
    expect(fechaOfac('05 Jul 1962')).toBe('1962-07-05');
    expect(fechaOfac('circa 1970')).toBe('1970');
    expect(fechaOfac('1970 to 1975')).toBe('1970');
    expect(fechaOfac('Jan 1980')).toBe('1980');
    expect(fechaOfac('sin fecha')).toBeNull();
  });
});
