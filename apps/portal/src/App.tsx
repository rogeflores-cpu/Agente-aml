import { useCallback, useEffect, useState } from 'react';
import { Conversacion } from './componentes/Conversacion';
import { Documentos } from './componentes/Documentos';
import { estiloMarca } from './componentes/marca';
import { Pendientes } from './componentes/Pendientes';
import { Whatsapp } from './componentes/Whatsapp';
import { ErrorPortal, type EstadoPortal, type FuentePortal } from './fuente/tipos';

type Pestana = 'conversacion' | 'documentos' | 'pendientes';
const FINALES = ['En revisión', 'Completado', 'Finalizado'];

export function App({ fuente }: { fuente: FuentePortal | null }) {
  const [estado, setEstado] = useState<EstadoPortal | null>(null);
  const [error, setError] = useState<{ texto: string; codigo: number } | null>(
    fuente ? null : { texto: 'Este enlace no es válido.', codigo: 401 },
  );
  const [iniciado, setIniciado] = useState(false);
  const [pestana, setPestana] = useState<Pestana>('conversacion');
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [resultadoEnvio, setResultadoEnvio] = useState<string[] | null>(null);

  const cargar = useCallback(async () => {
    if (!fuente) return;
    try {
      const e = await fuente.cargar();
      setEstado(e);
      if (e.conversacion.some((m) => m.rol === 'cliente')) setIniciado(true);
    } catch (x) {
      setError({ texto: (x as Error).message, codigo: x instanceof ErrorPortal ? x.estado : 500 });
    }
  }, [fuente]);
  useEffect(() => { cargar(); }, [cargar]);

  /** Ejecuta una acción, muestra el error si lo hay y recarga la vista. */
  const accion = async (f: () => Promise<unknown>) => {
    setOcupado(true);
    setAviso(null);
    try {
      await f();
    } catch (x) {
      if (x instanceof ErrorPortal && (x.estado === 401 || x.estado === 410)) setError({ texto: x.message, codigo: x.estado });
      else setAviso((x as Error).message);
    } finally {
      await cargar();
      setOcupado(false);
    }
  };

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <h1 className="text-xl font-semibold">{error.codigo === 410 ? 'El enlace venció' : error.codigo === 401 ? 'Enlace no válido' : 'No pudimos cargar su expediente'}</h1>
          <p className="mt-2 text-[15px] text-tinta-suave">
            {error.codigo === 410 || error.codigo === 401
              ? 'Por seguridad, los enlaces vencen. Pida a su asesor que le envíe uno nuevo.'
              : error.texto}
          </p>
        </div>
      </div>
    );
  }
  if (!estado || !fuente) return <p className="py-20 text-center text-sm text-tinta-suave">Cargando su expediente…</p>;

  const { marca, vista } = estado;
  const final = FINALES.includes(vista.estado) && vista.pendientes.length === 0;
  const primerNombre = vista.nombreCliente.split(' ')[0];

  return (
    <div style={estiloMarca(marca.colorPrimario)} className="min-h-screen">
      <header className="bg-marca text-sobre-marca">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-4">
          {marca.logoUrl
            ? <img src={marca.logoUrl} alt="" className="h-10 w-10 rounded-lg bg-white object-contain p-1" />
            : <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/20 text-lg font-semibold">{marca.nombreVisible.charAt(0)}</div>}
          <div className="min-w-0">
            <div className="truncate font-semibold">{marca.nombreVisible}</div>
            <div className="text-xs opacity-80">Expediente de {vista.parte === 'vendedor' ? 'venta' : 'compra'}</div>
          </div>
          {fuente.modoDemo && <span className="ml-auto rounded-full bg-white/20 px-2.5 py-0.5 text-xs">Demostración</span>}
        </div>
      </header>

      <main className="mx-auto max-w-xl space-y-4 px-4 py-5">
        {!iniciado && !final ? (
          <section className="space-y-4 rounded-2xl border border-borde bg-white p-5">
            <h1 className="text-xl font-semibold">Hola, {primerNombre}</h1>
            <p className="text-[15px] text-tinta-suave">
              {marca.nombreVisible} necesita algunos datos y documentos para completar su operación. La ley guatemalteca obliga a las inmobiliarias a identificar a sus clientes y conocer el origen de los fondos.
            </p>
            {vista.pendientes.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium">Le pediremos:</p>
                <ul className="list-disc space-y-1 pl-5 text-[15px]">{vista.pendientes.map((p, i) => <li key={i}>{p.descripcion}</li>)}</ul>
              </div>
            )}
            <p className="text-sm text-tinta-suave">Toma unos 10 minutos. Puede pausar y volver con el mismo enlace.</p>
            <button onClick={() => setIniciado(true)} className="w-full rounded-full bg-marca py-3 text-[15px] font-medium text-sobre-marca">Comenzar</button>
          </section>
        ) : final ? (
          <section className="rounded-2xl border border-borde bg-white p-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-marca-claro text-marca">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><path d="M5 13l4 4L19 7" /></svg>
            </div>
            <h1 className="text-lg font-semibold">Recibimos su información</h1>
            <p className="mt-2 text-[15px] text-tinta-suave">El equipo de {marca.nombreVisible} revisará su expediente y le avisará si necesita algo más.</p>
            <p className="mt-4 text-sm text-tinta-suave">Estado: {vista.estado}</p>
          </section>
        ) : (
          <>
            <div className="rounded-2xl border border-borde bg-white p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{vista.estado}</span>
                <span className="text-tinta-suave">{vista.pendientes.length === 0 ? 'Todo listo' : `${vista.pendientes.length} pendiente${vista.pendientes.length > 1 ? 's' : ''}`}</span>
              </div>
            </div>

            <nav className="grid grid-cols-3 gap-1 rounded-full border border-borde bg-white p-1 text-sm" role="tablist">
              {([['conversacion', 'Conversación'], ['documentos', 'Documentos'], ['pendientes', 'Pendientes']] as [Pestana, string][]).map(([clave, texto]) => (
                <button key={clave} role="tab" aria-selected={pestana === clave} onClick={() => setPestana(clave)}
                  className={`rounded-full py-2 ${pestana === clave ? 'bg-marca font-medium text-sobre-marca' : 'text-tinta-suave'}`}>
                  {texto}{clave === 'pendientes' && vista.pendientes.length > 0 ? ` (${vista.pendientes.length})` : ''}
                </button>
              ))}
            </nav>

            {aviso && <p className="rounded-xl bg-error-claro px-4 py-3 text-sm text-error" role="alert">{aviso}</p>}

            {pestana === 'conversacion' && (
              <Conversacion mensajes={estado.conversacion} ocupado={ocupado}
                alEnviar={(t) => {
                  setEstado({ ...estado, conversacion: [...estado.conversacion, { rol: 'cliente', texto: t }] });
                  accion(() => fuente.enviarMensaje(t));
                }}
                alAdjuntar={(f) => accion(() => fuente.subirDocumento(f))} />
            )}
            {pestana === 'documentos' && (
              <Documentos vista={vista} ocupado={ocupado} alSubir={(f) => accion(async () => { await fuente.subirDocumento(f); setPestana('conversacion'); })} />
            )}
            {pestana === 'pendientes' && (
              <Pendientes vista={vista} ocupado={ocupado} resultado={resultadoEnvio}
                alEnviarARevision={() => accion(async () => { const r = await fuente.enviarARevision(); setResultadoEnvio(r.enviado ? null : r.pendientes); })} />
            )}

            <Whatsapp obtener={() => fuente.codigoWhatsapp()} />
          </>
        )}
        <p className="pb-6 text-center text-xs text-tinta-suave">Su información se trata de forma confidencial y solo se usa para su operación.</p>
      </main>
    </div>
  );
}
