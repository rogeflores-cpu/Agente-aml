import { useEffect, useState } from 'react';
import { Avisos } from './componentes/Avisos';
import { Mensaje, Vacio } from './componentes/ui';
import { ROLES_CUMPLIMIENTO, ROLES_OPERATIVOS, type Fuente, type Organizacion, type Rol, type Sesion } from './fuente/tipos';
import { Bandeja } from './paginas/Bandeja';
import { Expediente } from './paginas/Expediente';
import { FijarClave } from './paginas/FijarClave';
import { Ingreso } from './paginas/Ingreso';
import { Operaciones } from './paginas/Operaciones';

const ROLES_CONSOLA: Rol[] = [...ROLES_CUMPLIMIENTO, ...ROLES_OPERATIVOS];
const NOMBRE_ROL: Record<string, string> = { oficial: 'Oficial de cumplimiento', oficial_suplente: 'Oficial suplente', auditor: 'Auditor', administrador: 'Administrador', ejecutivo: 'Ejecutivo' };

export function App({ fuente }: { fuente: Fuente }) {
  const [sesion, setSesion] = useState<Sesion | null | undefined>(undefined);
  const [orgs, setOrgs] = useState<Organizacion[]>([]);
  const [org, setOrg] = useState<Organizacion | null>(null);
  // Los avisos por correo enlazan a /?expediente=<id>: se abre después de iniciar sesión
  const [expediente, setExpediente] = useState<string | null>(() => {
    const id = new URLSearchParams(window.location.search).get('expediente');
    if (id) window.history.replaceState(null, '', window.location.pathname);
    return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
  });

  const [enlace, setEnlace] = useState(() => fuente.enlace());
  useEffect(() => { fuente.sesion().then(setSesion); }, [fuente]);
  useEffect(() => {
    if (!sesion) return;
    fuente.organizaciones().then((o) => { setOrgs(o); setOrg(o.find((x) => ROLES_CONSOLA.includes(x.rol)) ?? null); });
  }, [fuente, sesion]);

  if (sesion === undefined) return <Vacio>Cargando…</Vacio>;
  if (!sesion) {
    return <Ingreso modoDemo={fuente.modoDemo} avisoInicial={enlace?.tipo === 'error' ? enlace.mensaje : null}
      alRecuperar={(c) => fuente.recuperarClave(c)}
      alIngresar={async (c, k, r) => { await fuente.iniciarSesion(c, k, r); setEnlace(null); setSesion(await fuente.sesion()); }} />;
  }
  if (enlace?.tipo === 'clave') {
    return <FijarClave correo={sesion.correo} motivo={enlace.motivo} alGuardar={async (k) => { await fuente.fijarClave(k); setEnlace(null); }} />;
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-borde bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-marca text-xs font-bold text-white">AML</div>
            <div>
              <div className="text-sm font-semibold">{org && ROLES_OPERATIVOS.includes(org.rol) ? 'Operaciones inmobiliarias' : 'Consola de cumplimiento'}</div>
              {org && orgs.length > 1 ? (
                <select value={org.id} onChange={(e) => { setOrg(orgs.find((o) => o.id === e.target.value)!); setExpediente(null); }} className="text-xs text-tinta-suave">
                  {orgs.filter((o) => ROLES_CONSOLA.includes(o.rol)).map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                </select>
              ) : <div className="text-xs text-tinta-suave">{org?.nombre}</div>}
            </div>
            {fuente.modoDemo && <span className="rounded-full bg-medio-claro px-2.5 py-0.5 text-xs font-medium text-medio">Demostración · datos ficticios</span>}
          </div>
          <div className="flex items-center gap-3">
            {org && <Avisos fuente={fuente} organizacionId={org.id} abrir={setExpediente} />}
            <div className="text-right text-xs">
              <div className="font-medium">{sesion.correo}</div>
              <div className="text-tinta-suave">{org ? NOMBRE_ROL[org.rol] : ''}</div>
            </div>
            <button className="text-xs text-tinta-suave hover:text-tinta" onClick={async () => { await fuente.cerrarSesion(); setSesion(null); }}>Salir</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6">
        {!org ? (
          <Mensaje tipo="aviso">Su usuario no tiene un rol asignado en ninguna organización. Solicite acceso al administrador de su inmobiliaria.</Mensaje>
        ) : ROLES_OPERATIVOS.includes(org.rol) ? (
          // Art. 38: los roles operativos solo ven la vista operativa enmascarada.
          <Operaciones fuente={fuente} organizacionId={org.id} />
        ) : expediente ? (
          <Expediente fuente={fuente} id={expediente} rol={org.rol} volver={() => setExpediente(null)} />
        ) : (
          <Bandeja fuente={fuente} organizacionId={org.id} abrir={setExpediente} />
        )}
      </main>
    </div>
  );
}
