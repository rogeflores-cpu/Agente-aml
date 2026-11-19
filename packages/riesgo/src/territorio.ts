/**
 * División político-administrativa de Guatemala: 22 departamentos y 340
 * municipios (incluidos los creados más recientemente: San José La Máquina,
 * Suchitepéquez; Petatán, Huehuetenango; Sipacate, Escuintla; Las Cruces y
 * El Chal, Petén; La Blanca, San Marcos). Nombres según el uso del INE.
 *
 * Si el Congreso crea un municipio nuevo, se agrega aquí y en la prueba de
 * conteo (packages/riesgo/test/territorio.test.ts).
 */
export const MUNICIPIOS_POR_DEPARTAMENTO: Readonly<Record<string, readonly string[]>> = {
  'Alta Verapaz': [
    'Cobán', 'Santa Cruz Verapaz', 'San Cristóbal Verapaz', 'Tactic', 'Tamahú', 'Tucurú', 'Panzós', 'Senahú',
    'San Pedro Carchá', 'San Juan Chamelco', 'Lanquín', 'Cahabón', 'Chisec', 'Chahal', 'Fray Bartolomé de las Casas',
    'Santa Catalina La Tinta', 'Raxruhá',
  ],
  'Baja Verapaz': ['Salamá', 'San Miguel Chicaj', 'Rabinal', 'Cubulco', 'Granados', 'El Chol', 'San Jerónimo', 'Purulhá'],
  'Chimaltenango': [
    'Chimaltenango', 'San José Poaquil', 'San Martín Jilotepeque', 'San Juan Comalapa', 'Santa Apolonia', 'Tecpán Guatemala',
    'Patzún', 'San Miguel Pochuta', 'Patzicía', 'Santa Cruz Balanyá', 'Acatenango', 'San Pedro Yepocapa', 'San Andrés Itzapa',
    'Parramos', 'Zaragoza', 'El Tejar',
  ],
  'Chiquimula': [
    'Chiquimula', 'San José La Arada', 'San Juan Ermita', 'Jocotán', 'Camotán', 'Olopa', 'Esquipulas', 'Concepción Las Minas',
    'Quezaltepeque', 'San Jacinto', 'Ipala',
  ],
  'El Progreso': [
    'Guastatoya', 'Morazán', 'San Agustín Acasaguastlán', 'San Cristóbal Acasaguastlán', 'El Jícaro', 'Sansare', 'Sanarate',
    'San Antonio La Paz',
  ],
  'Escuintla': [
    'Escuintla', 'Santa Lucía Cotzumalguapa', 'La Democracia', 'Siquinalá', 'Masagua', 'Tiquisate', 'La Gomera', 'Guanagazapa',
    'San José', 'Iztapa', 'Palín', 'San Vicente Pacaya', 'Nueva Concepción', 'Sipacate',
  ],
  'Guatemala': [
    'Guatemala', 'Santa Catarina Pinula', 'San José Pinula', 'San José del Golfo', 'Palencia', 'Chinautla', 'San Pedro Ayampuc',
    'Mixco', 'San Pedro Sacatepéquez', 'San Juan Sacatepéquez', 'San Raymundo', 'Chuarrancho', 'Fraijanes', 'Amatitlán',
    'Villa Nueva', 'Villa Canales', 'San Miguel Petapa',
  ],
  'Huehuetenango': [
    'Huehuetenango', 'Chiantla', 'Malacatancito', 'Cuilco', 'Nentón', 'San Pedro Necta', 'Jacaltenango', 'Soloma', 'Ixtahuacán',
    'Santa Bárbara', 'La Libertad', 'La Democracia', 'San Miguel Acatán', 'San Rafael La Independencia', 'Todos Santos Cuchumatán',
    'San Juan Atitán', 'Santa Eulalia', 'San Mateo Ixtatán', 'Colotenango', 'San Sebastián Huehuetenango', 'Tectitán',
    'Concepción Huista', 'San Juan Ixcoy', 'San Antonio Huista', 'San Sebastián Coatán', 'Barillas', 'Aguacatán',
    'San Rafael Petzal', 'San Gaspar Ixchil', 'Santiago Chimaltenango', 'Santa Ana Huista', 'Unión Cantinil', 'Petatán',
  ],
  'Izabal': ['Puerto Barrios', 'Livingston', 'El Estor', 'Morales', 'Los Amates'],
  'Jalapa': ['Jalapa', 'San Pedro Pinula', 'San Luis Jilotepeque', 'San Manuel Chaparrón', 'San Carlos Alzatate', 'Monjas', 'Mataquescuintla'],
  'Jutiapa': [
    'Jutiapa', 'El Progreso', 'Santa Catarina Mita', 'Agua Blanca', 'Asunción Mita', 'Yupiltepeque', 'Atescatempa', 'Jerez',
    'El Adelanto', 'Zapotitlán', 'Comapa', 'Jalpatagua', 'Conguaco', 'Moyuta', 'Pasaco', 'San José Acatempa', 'Quesada',
  ],
  'Petén': [
    'Flores', 'San José', 'San Benito', 'San Andrés', 'La Libertad', 'San Francisco', 'Santa Ana', 'Dolores', 'San Luis',
    'Sayaxché', 'Melchor de Mencos', 'Poptún', 'Las Cruces', 'El Chal',
  ],
  'Quetzaltenango': [
    'Quetzaltenango', 'Salcajá', 'Olintepeque', 'San Carlos Sija', 'Sibilia', 'Cabricán', 'Cajolá', 'San Miguel Sigüilá',
    'San Juan Ostuncalco', 'San Mateo', 'Concepción Chiquirichapa', 'San Martín Sacatepéquez', 'Almolonga', 'Cantel', 'Huitán',
    'Zunil', 'Colomba Costa Cuca', 'San Francisco La Unión', 'El Palmar', 'Coatepeque', 'Génova', 'Flores Costa Cuca',
    'La Esperanza', 'Palestina de Los Altos',
  ],
  'Quiché': [
    'Santa Cruz del Quiché', 'Chiché', 'Chinique', 'Zacualpa', 'Chajul', 'Chichicastenango', 'Patzité', 'San Antonio Ilotenango',
    'San Pedro Jocopilas', 'Cunén', 'San Juan Cotzal', 'Joyabaj', 'Nebaj', 'San Andrés Sajcabajá', 'Uspantán', 'Sacapulas',
    'San Bartolomé Jocotenango', 'Canillá', 'Chicamán', 'Ixcán', 'Pachalum',
  ],
  'Retalhuleu': [
    'Retalhuleu', 'San Sebastián', 'Santa Cruz Muluá', 'San Martín Zapotitlán', 'San Felipe', 'San Andrés Villa Seca',
    'Champerico', 'Nuevo San Carlos', 'El Asintal',
  ],
  'Sacatepéquez': [
    'Antigua Guatemala', 'Jocotenango', 'Pastores', 'Sumpango', 'Santo Domingo Xenacoj', 'Santiago Sacatepéquez',
    'San Bartolomé Milpas Altas', 'San Lucas Sacatepéquez', 'Santa Lucía Milpas Altas', 'Magdalena Milpas Altas',
    'Santa María de Jesús', 'Ciudad Vieja', 'San Miguel Dueñas', 'Alotenango', 'San Antonio Aguas Calientes',
    'Santa Catarina Barahona',
  ],
  'San Marcos': [
    'San Marcos', 'San Pedro Sacatepéquez', 'San Antonio Sacatepéquez', 'Comitancillo', 'San Miguel Ixtahuacán',
    'Concepción Tutuapa', 'Tacaná', 'Sibinal', 'Tajumulco', 'Tejutla', 'San Rafael Pie de la Cuesta', 'Nuevo Progreso',
    'El Tumbador', 'El Rodeo', 'Malacatán', 'Catarina', 'Ayutla', 'Ocós', 'San Pablo', 'El Quetzal', 'La Reforma', 'Pajapita',
    'Ixchiguán', 'San José Ojetenam', 'San Cristóbal Cucho', 'Sipacapa', 'Esquipulas Palo Gordo', 'Río Blanco', 'San Lorenzo',
    'La Blanca',
  ],
  'Santa Rosa': [
    'Cuilapa', 'Barberena', 'Santa Rosa de Lima', 'Casillas', 'San Rafael Las Flores', 'Oratorio', 'San Juan Tecuaco',
    'Chiquimulilla', 'Taxisco', 'Santa María Ixhuatán', 'Guazacapán', 'Santa Cruz Naranjo', 'Pueblo Nuevo Viñas',
    'Nueva Santa Rosa',
  ],
  'Sololá': [
    'Sololá', 'San José Chacayá', 'Santa María Visitación', 'Santa Lucía Utatlán', 'Nahualá', 'Santa Catarina Ixtahuacán',
    'Santa Clara La Laguna', 'Concepción', 'San Andrés Semetabaj', 'Panajachel', 'Santa Catarina Palopó', 'San Antonio Palopó',
    'San Lucas Tolimán', 'Santa Cruz La Laguna', 'San Pablo La Laguna', 'San Marcos La Laguna', 'San Juan La Laguna',
    'San Pedro La Laguna', 'Santiago Atitlán',
  ],
  'Suchitepéquez': [
    'Mazatenango', 'Cuyotenango', 'San Francisco Zapotitlán', 'San Bernardino', 'San José El Ídolo', 'Santo Domingo Suchitepéquez',
    'San Lorenzo', 'Samayac', 'San Pablo Jocopilas', 'San Antonio Suchitepéquez', 'San Miguel Panán', 'San Gabriel', 'Chicacao',
    'Patulul', 'Santa Bárbara', 'San Juan Bautista', 'Santo Tomás La Unión', 'Zunilito', 'Pueblo Nuevo', 'Río Bravo',
    'San José La Máquina',
  ],
  'Totonicapán': [
    'Totonicapán', 'San Cristóbal Totonicapán', 'San Francisco El Alto', 'San Andrés Xecul', 'Momostenango',
    'Santa María Chiquimula', 'Santa Lucía La Reforma', 'San Bartolo',
  ],
  'Zacapa': ['Zacapa', 'Estanzuela', 'Río Hondo', 'Gualán', 'Teculután', 'Usumatlán', 'Cabañas', 'San Diego', 'La Unión', 'Huité', 'San Jorge'],
};

export const DEPARTAMENTOS_GUATEMALA: readonly string[] = Object.keys(MUNICIPIOS_POR_DEPARTAMENTO);

export const municipiosDe = (departamento: string): readonly string[] => MUNICIPIOS_POR_DEPARTAMENTO[departamento] ?? [];

export const municipioValido = (departamento: string, municipio: string): boolean => municipiosDe(departamento).includes(municipio);

/** Datos registrales del inmueble (Registro General de la Propiedad), siempre por separado. */
export interface DatosRegistrales { finca?: string; folio?: string; libro?: string }

/** "Finca 1234, folio 56, libro 789E" (solo las partes que existan). */
export function textoRegistral(r: DatosRegistrales): string {
  return [r.finca && `Finca ${r.finca}`, r.folio && `folio ${r.folio}`, r.libro && `libro ${r.libro}`].filter(Boolean).join(', ');
}

/** Finca y folio: solo dígitos (se quitan comas, puntos y espacios). Libro: letras y números en mayúsculas, sin espacios. */
export const normalizarFinca = (s: string) => s.replace(/[\s.,]/g, '');
export const normalizarLibro = (s: string) => s.replace(/\s+/g, '').toUpperCase();

/** Error de los datos registrales o null. Si se indica uno, se exigen los tres. */
export function errorRegistral(r: DatosRegistrales): { campo: 'finca' | 'folio' | 'libro'; mensaje: string } | null {
  const finca = normalizarFinca(r.finca ?? '');
  const folio = normalizarFinca(r.folio ?? '');
  const libro = normalizarLibro(r.libro ?? '');
  if (!finca && !folio && !libro) return null;
  if (!/^\d{1,8}$/.test(finca)) return { campo: 'finca', mensaje: finca ? 'Número de finca: solo dígitos' : 'Indique el número de finca' };
  if (!/^\d{1,6}$/.test(folio)) return { campo: 'folio', mensaje: folio ? 'Folio: solo dígitos' : 'Indique el folio' };
  if (!/^[0-9A-Z]{1,10}$/.test(libro)) return { campo: 'libro', mensaje: libro ? 'Libro: solo letras y números (p. ej. 789 o 45E)' : 'Indique el libro' };
  return null;
}
