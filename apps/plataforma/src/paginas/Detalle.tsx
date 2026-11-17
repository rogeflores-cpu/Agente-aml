import { useCallback, useEffect, useState } from 'react';
import { ListaAlta } from '../componentes/Lista';
import { Boton, Campo, Insignia, Mensaje, Tarjeta, Vacio, fecha } from '../componentes/ui';
import type { DetalleOrganizacion, Fuente, Rol } from '../fuente/tipos';
import { correoValido, hoyLocal } from '../validacion';

const ROLES: Record<Rol, string> = {
  oficial: 'Oficial de cumplimiento', oficial_suplente: 'Oficial suplente', administrador: 'Administrador',
  ejecutivo: 'Ejecutivo comercial', auditor: 'Auditor',
};

export function Detalle({ fuente, id, volver }: { fuente: Fuente; id: string; volver: () => void }) {
  const [d, setD] = useState<DetalleOrganizacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recargar = useCallback(() => fuente.organizacion(id).then(setD).catch((x) => setError(x.message)), [fuente, id]);
  useEffect(() => { recargar(); }, [recargar]);
  if (error) return <Mensaje tipo="error">{error}</Mensaje>;
  if (!d) return <Vacio>Cargando…</Vacio>;
  const e = d.estado;

  return (
    <div className="space-y-5">
      <button onClick={volver} className="text-sm text-tinta-suave hover:text-tinta">← Organizaciones</button>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold text-white" style={{ background: e.marca.colorPrimario }}>
            {e.marca.nombreVisible.slice(0, 2).toUpperCase()}
          </span>
          <div>
            <h1 className="text-2xl font-semibold">{e.nombreComercial}</h1>
            <p className="text-sm text-tinta-suave">{e.nombreLegal} · NIT {e.nit} · {e.subdominio}</p>
          </div>
        </div>
        {e.listaParaOperar
          ? <Insignia clase="bg-bajo-claro text-bajo">Lista para operar</Insignia>
          : <Insignia clase="bg-medio-claro text-medio">Alta en proceso</Insignia>}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Tarjeta titulo="Estado del alta"><ListaAlta e={e} /></Tarjeta>
        <div className="lg:col-span-2"><Inscripcion d={d} fuente={fuente} alCambiar={recargar} /></div>
      </div>
      <Metodologia d={d} fuente={fuente} alCambiar={recargar} />
      <Usuarios d={d} fuente={fuente} alCambiar={recargar} />
      <Whatsapp d={d} fuente={fuente} alCambiar={recargar} />
    </div>
  );
}

function Inscripcion({ d, fuente, alCambiar }: { d: DetalleOrganizacion; fuente: Fuente; alCambiar: () => void }) {
  const [ive, setIve] = useState('');
  const [error, setError] = useState<string | null>(null);
  const e = d.estado;
  return (
    <Tarjeta titulo="Datos de la organización">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <dt className="text-tinta-suave">Actividad</dt><dd className="capitalize">{e.actividad.replace(/_/g, ' ')}</dd>
        <dt className="text-tinta-suave">Nombre visible</dt><dd>{e.marca.nombreVisible}</dd>
        <dt className="text-tinta-suave">Color</dt><dd className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: e.marca.colorPrimario }} />{e.marca.colorPrimario}</dd>
        <dt className="text-tinta-suave">Inscripción IVE</dt><dd>{e.inscripcionIve ?? <span className="text-medio">Pendiente</span>}</dd>
        <dt className="text-tinta-suave">Creada</dt><dd>{fecha(e.creadoEn)}</dd>
      </dl>
      {!e.inscripcionIve && (
        <div className="mt-4 flex items-end gap-3">
          <div className="flex-1"><Campo etiqueta="Registrar número de inscripción ante la IVE (art. 5)" valor={ive} setValor={setIve} /></div>
          <Boton disabled={!ive.trim()} onClick={async () => {
            try { await fuente.actualizarOrganizacion(e.id, { inscripcionIve: ive.trim() }); setIve(''); alCambiar(); } catch (x) { setError((x as Error).message); }
          }}>Guardar</Boton>
        </div>
      )}
      {error && <div className="mt-3"><Mensaje tipo="error">{error}</Mensaje></div>}
    </Tarjeta>
  );
}

function Metodologia({ d, fuente, alCambiar }: { d: DetalleOrganizacion; fuente: Fuente; alCambiar: () => void }) {
  const hoy = hoyLocal();
  const [organo, setOrgano] = useState('Consejo de Administración');
  const [fechaAprobacion, setFecha] = useState(hoy);
  const [acta, setActa] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pendiente = d.configuraciones.find((c) => !c.aprobadaEn);
  return (
    <Tarjeta titulo="Metodología de riesgo (art. 8)">
      <table className="mb-4 w-full text-sm">
        <thead><tr className="text-left text-xs text-tinta-suave"><th className="pb-2 font-medium">Versión</th><th className="pb-2 font-medium">Estado</th><th className="pb-2 font-medium">Aprobada por</th><th className="pb-2 font-medium">Fecha</th></tr></thead>
        <tbody>
          {d.configuraciones.map((c) => (
            <tr key={c.id} className="border-t border-borde">
              <td className="py-2">v{c.version}</td>
              <td className="py-2">{c.aprobadaEn ? <Insignia clase="bg-bajo-claro text-bajo">Aprobada</Insignia> : <Insignia clase="bg-medio-claro text-medio">Pendiente</Insignia>}</td>
              <td className="py-2">{c.aprobadaPor ?? '—'}</td>
              <td className="py-2">{c.aprobadaEn ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {pendiente ? (
        <div className="space-y-3 rounded-lg bg-papel p-4">
          <p className="text-sm">Registre la aprobación de la versión v{pendiente.version} por el órgano de dirección. Una vez aprobada no se modifica: los cambios se hacen en una versión nueva.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo etiqueta="Órgano de dirección" valor={organo} setValor={setOrgano} />
            <Campo etiqueta="Fecha de aprobación" tipo="date" valor={fechaAprobacion} setValor={setFecha} />
            <Campo etiqueta="Referencia del acta" valor={acta} setValor={setActa} placeholder="Acta 15-2026, punto 4" ayuda="Tal como se citará: p. ej. Acta 15-2026, punto 4" />
          </div>
          {error && <Mensaje tipo="error">{error}</Mensaje>}
          <Boton disabled={organo.trim().length < 3 || !acta.trim() || !fechaAprobacion || fechaAprobacion > hoy} onClick={async () => {
            setError(null);
            try { await fuente.aprobarMetodologia(d.estado.id, { organo: organo.trim(), fecha: fechaAprobacion, acta: acta.trim() }); setActa(''); alCambiar(); } catch (x) { setError((x as Error).message); }
          }}>Registrar aprobación</Boton>
        </div>
      ) : <p className="text-sm text-tinta-suave">No hay versiones pendientes de aprobación.</p>}
    </Tarjeta>
  );
}

function Usuarios({ d, fuente, alCambiar }: { d: DetalleOrganizacion; fuente: Fuente; alCambiar: () => void }) {
  const [correo, setCorreo] = useState('');
  const [rol, setRol] = useState<Rol>('ejecutivo');
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  return (
    <Tarjeta titulo="Usuarios">
      {d.usuarios.length ? (
        <table className="mb-4 w-full text-sm">
          <thead><tr className="text-left text-xs text-tinta-suave"><th className="pb-2 font-medium">Correo</th><th className="pb-2 font-medium">Rol</th><th className="pb-2 font-medium">Estado</th><th /></tr></thead>
          <tbody>
            {d.usuarios.map((u) => (
              <tr key={u.usuarioId} className={`border-t border-borde ${u.activo ? '' : 'opacity-50'}`}>
                <td className="py-2">{u.correo ?? u.usuarioId}</td>
                <td className="py-2">{ROLES[u.rol]}</td>
                <td className="py-2">{!u.activo ? 'Desactivado' : u.invitacionPendiente ? <span className="text-medio">Invitación enviada</span> : 'Activo'}</td>
                <td className="py-2 text-right">
                  {u.activo && <button className="text-xs text-tinta-suave hover:text-alto" onClick={async () => {
                    try { await fuente.desactivarUsuario(d.estado.id, u.usuarioId); alCambiar(); } catch (x) { setAviso({ tipo: 'error', texto: (x as Error).message }); }
                  }}>Desactivar</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <Vacio>Sin usuarios.</Vacio>}
      <div className="grid grid-cols-[1fr_14rem_auto] items-end gap-3">
        <Campo etiqueta="Invitar por correo" valor={correo} setValor={setCorreo} error={correo && !correoValido(correo) ? 'Correo inválido' : null} />
        <select value={rol} onChange={(e) => setRol(e.target.value as Rol)} className="h-[42px] rounded-lg border border-borde px-3 text-sm">
          {Object.entries(ROLES).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
        <Boton disabled={!correoValido(correo)} onClick={async () => {
          try {
            const r = await fuente.invitarUsuario(d.estado.id, correo.trim(), rol);
            setAviso({ tipo: 'ok', texto: r.invitado ? `Invitación enviada a ${correo}.` : `${correo} ya tenía cuenta: quedó vinculado con el nuevo rol.` });
            setCorreo(''); alCambiar();
          } catch (x) { setAviso({ tipo: 'error', texto: (x as Error).message }); }
        }}>Invitar</Boton>
      </div>
      {aviso && <div className="mt-3"><Mensaje tipo={aviso.tipo}>{aviso.texto}</Mensaje></div>}
    </Tarjeta>
  );
}

function Whatsapp({ d, fuente, alCambiar }: { d: DetalleOrganizacion; fuente: Fuente; alCambiar: () => void }) {
  const [f, setF] = useState({ wabaId: '', phoneNumberId: '', numeroVisible: '', nombreVisible: d.estado.marca.nombreVisible, token: '' });
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error' | 'aviso'; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const c = d.canal;
  const valido = /^\d+$/.test(f.wabaId) && /^\d+$/.test(f.phoneNumberId) && f.numeroVisible.trim().length >= 8 && f.nombreVisible.trim().length >= 2 && f.token.trim().length >= 20;
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  return (
    <Tarjeta titulo="WhatsApp de la organización" accion={c ? <Insignia clase={c.estado === 'activo' ? 'bg-bajo-claro text-bajo' : 'bg-medio-claro text-medio'}>{c.estado === 'activo' ? 'Activo' : 'Pendiente de verificación'}</Insignia> : undefined}>
      {c && (
        <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-tinta-suave">Número</dt><dd>{c.numeroVisible}</dd>
          <dt className="text-tinta-suave">Nombre visible</dt><dd>{c.nombreVisible}</dd>
          <dt className="text-tinta-suave">ID de la cuenta (WABA)</dt><dd className="font-mono text-xs">{c.wabaId}</dd>
          <dt className="text-tinta-suave">ID del número</dt><dd className="font-mono text-xs">{c.phoneNumberId}</dd>
          <dt className="text-tinta-suave">Token</dt><dd>{c.tokenGuardado ? 'Guardado en el almacén cifrado' : 'Falta'}</dd>
        </dl>
      )}
      <p className="mb-3 text-sm text-tinta-suave">
        {c ? 'Para reemplazar la conexión, ingrese los datos de nuevo.' : 'Cada organización usa su propio número, a nombre de su empresa.'} Lo recomendable es conectarlo con el registro integrado de Meta;
        mientras tanto, copie los datos del administrador de WhatsApp Business. El token se guarda cifrado y no vuelve a mostrarse.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="ID de la cuenta de WhatsApp Business" valor={f.wabaId} setValor={set('wabaId')} />
        <Campo etiqueta="ID del número de teléfono" valor={f.phoneNumberId} setValor={set('phoneNumberId')} />
        <Campo etiqueta="Número visible" valor={f.numeroVisible} setValor={set('numeroVisible')} placeholder="+502 5555 0000" />
        <Campo etiqueta="Nombre visible" valor={f.nombreVisible} setValor={set('nombreVisible')} />
        <div className="sm:col-span-2"><Campo etiqueta="Token de acceso" tipo="password" valor={f.token} setValor={set('token')} /></div>
      </div>
      {aviso && <div className="mt-3"><Mensaje tipo={aviso.tipo}>{aviso.texto}</Mensaje></div>}
      <div className="mt-4">
        <Boton disabled={!valido || enviando} onClick={async () => {
          setEnviando(true); setAviso(null);
          try {
            const r = await fuente.conectarWhatsapp(d.estado.id, f);
            setAviso(r.estado === 'activo'
              ? { tipo: 'ok', texto: 'Número verificado con Meta y activo.' }
              : { tipo: 'aviso', texto: `Se guardó, pero Meta no confirmó el número: ${r.error ?? 'sin detalle'}. El canal queda pendiente.` });
            setF({ ...f, token: '' }); alCambiar();
          } catch (x) { setAviso({ tipo: 'error', texto: (x as Error).message }); } finally { setEnviando(false); }
        }}>{enviando ? 'Verificando…' : 'Guardar y verificar'}</Boton>
      </div>
    </Tarjeta>
  );
}
