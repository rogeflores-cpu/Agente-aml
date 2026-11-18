import { configuracionBaseInmobiliaria, validarConfiguracion } from '@agente-aml/riesgo';
import { hoyLocal, nitConFormato, nitVerificadorCorrecto, subdominioValido } from '../validacion';
import type { AvisoPlataforma, Designacion1373, DetalleOrganizacion, EstadoAlta, Fuente, ListaGafi } from './tipos';

/**
 * Fuente de demostración: organizaciones ficticias en memoria, con las mismas
 * reglas que el servidor (subdominio, NIT, metodología sin aprobar al crear,
 * versiones aprobadas inmutables, WhatsApp verificado antes de activarse).
 */
const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString();

interface Registro { detalle: DetalleOrganizacion }

function recalcular(d: DetalleOrganizacion) {
  const e = d.estado;
  const activos = d.usuarios.filter((u) => u.activo);
  e.oficiales = activos.filter((u) => u.rol === 'oficial').length;
  e.suplentes = activos.filter((u) => u.rol === 'oficial_suplente').length;
  e.usuarios = activos.length;
  const aprobadas = d.configuraciones.filter((c) => c.aprobadaEn).map((c) => c.version);
  e.metodologiaVersionAprobada = aprobadas.length ? Math.max(...aprobadas) : null;
  e.metodologiaPendiente = d.configuraciones.some((c) => !c.aprobadaEn);
  e.whatsappEstado = (d.canal?.estado as EstadoAlta['whatsappEstado']) ?? null;
  e.whatsappNumero = d.canal?.numeroVisible ?? null;
  e.listaParaOperar = !!e.inscripcionIve && !!e.metodologiaVersionAprobada && e.oficiales > 0 && e.whatsappEstado === 'activo';
}

function organizacion(p: {
  id: string; nombre: string; legal: string; nit: string; sub: string; color: string; ive: string | null; dias: number;
  aprobada: boolean; usuarios: [string, DetalleOrganizacion['usuarios'][number]['rol']][]; whatsapp: 'activo' | 'pendiente' | null;
}): Registro {
  const detalle: DetalleOrganizacion = {
    estado: {
      id: p.id, nombreLegal: p.legal, nombreComercial: p.nombre, nit: p.nit, actividad: 'inmobiliaria', subdominio: p.sub,
      inscripcionIve: p.ive, marca: { nombreVisible: p.nombre, colorPrimario: p.color, logoUrl: null }, creadoEn: hace(p.dias),
      metodologiaVersionAprobada: null, metodologiaPendiente: false, oficiales: 0, suplentes: 0, usuarios: 0,
      whatsappEstado: null, whatsappNumero: null, listaParaOperar: false,
    },
    usuarios: p.usuarios.map(([correo, rol], i) => ({ usuarioId: `${p.id}-u${i}`, correo, rol, activo: true, invitacionPendiente: i > 0 })),
    configuraciones: [{
      id: `${p.id}-c1`, version: 1, creadoEn: hace(p.dias),
      aprobadaPor: p.aprobada ? 'Consejo de Administración · Acta 08-2026' : null,
      aprobadaEn: p.aprobada ? hace(p.dias - 2).slice(0, 10) : null, vigenteDesde: p.aprobada ? hace(p.dias - 2) : null,
    }],
    canal: p.whatsapp ? { wabaId: '100000000000001', phoneNumberId: '200000000000001', numeroVisible: '+502 5555 0100', nombreVisible: p.nombre, estado: p.whatsapp, tokenGuardado: true } : null,
  };
  recalcular(detalle);
  return { detalle };
}

export function fuenteDemo(): Fuente {
  let sesion: { correo: string } | null = null;
  const orgs: Registro[] = [
    organizacion({ id: 'org-a', nombre: 'Inmobiliaria Demostración', legal: 'Inmobiliaria Demostración, S.A.', nit: '576-2', sub: 'demo-inmuebles', color: '#0f5e5a', ive: 'IVE-PO-0001-2026', dias: 40, aprobada: true, usuarios: [['oficial@demo.example', 'oficial'], ['suplente@demo.example', 'oficial_suplente'], ['ventas@demo.example', 'ejecutivo']], whatsapp: 'activo' }),
    organizacion({ id: 'org-b', nombre: 'Casas del Lago', legal: 'Casas del Lago, Sociedad Anónima', nit: '11-6', sub: 'casas-del-lago', color: '#1d4ed8', ive: null, dias: 6, aprobada: false, usuarios: [['gerencia@casasdellago.example', 'administrador']], whatsapp: 'pendiente' }),
  ];
  const listas: ListaGafi[] = [];
  const designaciones: Designacion1373[] = [];
  const avisos: AvisoPlataforma[] = [
    { id: 'av-1', asunto: 'Cargar listas del GAFI', cuerpo: 'No hay listas del GAFI cargadas. El motor de riesgo no puede aplicar el art. 24 ii hasta cargarlas.', creadoEn: hace(1), atendidoEn: null },
  ];
  const buscar = (id: string) => {
    const o = orgs.find((x) => x.detalle.estado.id === id);
    if (!o) throw new Error('Organización no encontrada');
    return o.detalle;
  };
  const copia = <T>(x: T): T => structuredClone(x);

  return {
    modoDemo: true,
    async sesion() { return sesion; },
    async iniciarSesion(correo) { sesion = { correo: correo || 'admin@plataforma.example' }; },
    async cerrarSesion() { sesion = null; },

    async organizaciones() { return copia(orgs.map((o) => o.detalle.estado)); },
    async organizacion(id) { return copia(buscar(id)); },

    async crearOrganizacion(d) {
      const errores: string[] = [];
      if (d.nombreLegal.trim().length < 3) errores.push('Indique la razón social');
      if (!nitConFormato(d.nit)) errores.push('NIT con formato inválido (ej. 1234567-8)');
      if (!subdominioValido(d.subdominio)) errores.push('Subdominio inválido o reservado');
      if (errores.length) throw new Error(errores.join(' · '));
      if (orgs.some((o) => o.detalle.estado.subdominio === d.subdominio)) throw new Error('El subdominio ya está en uso');
      const id = `org-${Date.now()}`;
      const advertencias: string[] = [];
      if (!nitVerificadorCorrecto(d.nit)) advertencias.push('El dígito verificador del NIT no cuadra: confírmelo con la constancia de RTU.');
      if (!d.inscripcionIve) advertencias.push('Falta el número de inscripción ante la IVE (art. 5). La organización no podrá operar sin él.');
      const detalle: DetalleOrganizacion = {
        estado: {
          id, nombreLegal: d.nombreLegal, nombreComercial: d.nombreComercial, nit: d.nit.toUpperCase(), actividad: d.actividad,
          subdominio: d.subdominio, inscripcionIve: d.inscripcionIve ?? null, creadoEn: new Date().toISOString(),
          marca: { nombreVisible: d.marca.nombreVisible, colorPrimario: d.marca.colorPrimario, logoUrl: d.marca.logoUrl ?? null },
          metodologiaVersionAprobada: null, metodologiaPendiente: true, oficiales: 0, suplentes: 0, usuarios: 0,
          whatsappEstado: null, whatsappNumero: null, listaParaOperar: false,
        },
        usuarios: [],
        // La metodología nace como la base, sin aprobar (art. 8).
        configuraciones: [{ id: `${id}-c1`, version: 1, aprobadaPor: null, aprobadaEn: null, vigenteDesde: null, creadoEn: new Date().toISOString() }],
        canal: null,
      };
      orgs.unshift({ detalle });
      return { id, advertencias };
    },

    async actualizarOrganizacion(id, d) {
      const o = buscar(id);
      if (d.inscripcionIve) o.estado.inscripcionIve = d.inscripcionIve;
      recalcular(o);
    },

    async invitarUsuario(id, correo, rol) {
      const o = buscar(id);
      const c = correo.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) throw new Error('Correo inválido');
      const existente = o.usuarios.find((u) => u.correo === c);
      if (existente) Object.assign(existente, { rol, activo: true });
      else o.usuarios.push({ usuarioId: `${id}-u${Date.now()}`, correo: c, rol, activo: true, invitacionPendiente: true });
      recalcular(o);
      return { invitado: !existente };
    },

    async desactivarUsuario(id, usuarioId) {
      const o = buscar(id);
      const u = o.usuarios.find((x) => x.usuarioId === usuarioId);
      if (!u) throw new Error('Usuario no encontrado en la organización');
      u.activo = false;
      recalcular(o);
    },

    async aprobarMetodologia(id, d) {
      const o = buscar(id);
      if (d.organo.trim().length < 3) throw new Error('Indique el órgano de dirección que aprobó');
      if (!d.acta.trim()) throw new Error('Indique la referencia del acta');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fecha) || d.fecha > hoyLocal()) throw new Error('La fecha no puede ser futura');
      const pendiente = o.configuraciones.find((c) => !c.aprobadaEn);
      if (!pendiente) throw new Error('No hay una versión pendiente de aprobación.');
      validarConfiguracion(configuracionBaseInmobiliaria);
      Object.assign(pendiente, { aprobadaPor: `${d.organo} · ${d.acta}`, aprobadaEn: d.fecha, vigenteDesde: new Date().toISOString() });
      recalcular(o);
    },

    async conectarWhatsapp(id, d) {
      const o = buscar(id);
      if (!/^\d+$/.test(d.wabaId) || !/^\d+$/.test(d.phoneNumberId)) throw new Error('Los IDs de Meta deben tener solo dígitos');
      if (d.token.trim().length < 20) throw new Error('Token de acceso inválido');
      if (orgs.some((x) => x.detalle.estado.id !== id && x.detalle.canal?.phoneNumberId === d.phoneNumberId)) {
        throw new Error('Ese número ya está conectado a otra organización');
      }
      // En la demostración, un token que empieza con "invalido" simula el rechazo de Meta.
      const ok = !d.token.startsWith('invalido');
      o.canal = { wabaId: d.wabaId, phoneNumberId: d.phoneNumberId, numeroVisible: d.numeroVisible, nombreVisible: d.nombreVisible, estado: ok ? 'activo' : 'pendiente', tokenGuardado: true };
      recalcular(o);
      return { estado: o.canal.estado, error: ok ? undefined : 'Meta rechazó el token (simulado)' };
    },

    async listasGafi() { return copia(listas); },
    async cargarListaGafi(d) {
      if (listas.some((l) => l.plenario === d.plenario)) throw new Error('Ya hay una versión para ese pleno');
      if (d.altoRiesgo.some((p) => d.monitoreo.includes(p))) throw new Error('Un país no puede estar en ambas listas');
      listas.unshift({ id: `gafi-${Date.now()}`, ...d, cargadaPor: sesion?.correo ?? 'admin', cargadaEn: new Date().toISOString() });
      listas.sort((a, b) => b.plenario.localeCompare(a.plenario));
    },
    async designaciones1373() { return copia(designaciones); },
    async registrarDesignacion1373(d) {
      const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Guatemala' });
      if (d.designadaEl > hoy) throw new Error('La fecha de la designación no puede ser futura');
      if (d.nombre.trim().length < 3 || d.autoridad.trim().length < 3 || d.referencia.trim().length < 3) {
        throw new Error('Indique nombre, autoridad y referencia del documento');
      }
      designaciones.unshift({ id: `des-${Date.now()}`, ...d, fuenteUrl: d.fuenteUrl ?? null, cargadaPor: sesion?.correo ?? 'admin',
        cargadaEn: new Date().toISOString(), revocadaEl: null, revocacionReferencia: null });
    },
    async revocarDesignacion1373(id, revocadaEl, referencia) {
      const d = designaciones.find((x) => x.id === id);
      if (!d || d.revocadaEl) throw new Error('Designación no encontrada o ya revocada');
      if (referencia.trim().length < 3) throw new Error('Referencia del documento que revoca');
      Object.assign(d, { revocadaEl, revocacionReferencia: referencia.trim() });
    },
    async avisos() { return copia(avisos); },
    async atenderAviso(id) {
      const a = avisos.find((x) => x.id === id);
      if (!a || a.atendidoEn) throw new Error('Aviso no encontrado o ya atendido');
      a.atendidoEn = new Date().toISOString();
    },
  };
}
