import { useEffect, useState } from 'react';
import { Boton, Campo, Insignia, Mensaje, Tarjeta, Vacio, fecha } from '../componentes/ui';
import type { Fuente, ListaGafi } from '../fuente/tipos';
import { leerCodigosIso } from '../validacion';

const FUENTE_ALTO = 'https://www.fatf-gafi.org/en/publications/High-risk-and-other-monitored-jurisdictions.html';

export function ListasGafi({ fuente }: { fuente: Fuente }) {
  const [listas, setListas] = useState<ListaGafi[] | null>(null);
  const [plenario, setPlenario] = useState('');
  const [alto, setAlto] = useState('');
  const [monitoreo, setMonitoreo] = useState('');
  const [fuenteAlto, setFuenteAlto] = useState('');
  const [fuenteMon, setFuenteMon] = useState('');
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const cargar = () => fuente.listasGafi().then(setListas).catch((x) => setAviso({ tipo: 'error', texto: x.message }));
  useEffect(() => { cargar(); }, [fuente]);

  const a = leerCodigosIso(alto);
  const m = leerCodigosIso(monitoreo);
  const traslape = a.validos.filter((p) => m.validos.includes(p));
  const url = (u: string) => /^https:\/\/(www\.)?fatf-gafi\.org\//.test(u);
  const valido = /^\d{4}-\d{2}-\d{2}$/.test(plenario) && !a.invalidos.length && !m.invalidos.length && !traslape.length
    && a.validos.length > 0 && url(fuenteAlto) && url(fuenteMon);
  const vigente = listas?.[0];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Listas del GAFI</h1>
        <p className="mt-1 text-sm text-tinta-suave">
          El GAFI no publica un archivo descargable: después de cada pleno (febrero, junio y octubre) se cargan aquí sus dos declaraciones.
          Las versiones no se modifican y el motor de riesgo usa siempre la más reciente (art. 24 ii).
        </p>
      </div>
      <div className="grid gap-5 lg:grid-cols-5">
        <Tarjeta titulo="Cargar versión de un pleno" className="lg:col-span-3">
          <div className="space-y-3">
            <Campo etiqueta="Fecha de la declaración del pleno" tipo="date" valor={plenario} setValor={setPlenario} />
            <Campo etiqueta="Alto riesgo, llamado a la acción (códigos ISO de 2 letras)" valor={alto} setValor={setAlto} placeholder="Ej.: XX, YY"
              error={a.invalidos.length ? `Códigos inválidos: ${a.invalidos.join(', ')}` : null} ayuda={a.validos.length ? `${a.validos.length} país(es): ${a.validos.join(', ')}` : undefined} />
            <Campo etiqueta="Monitoreo intensificado (códigos ISO de 2 letras)" valor={monitoreo} setValor={setMonitoreo}
              error={m.invalidos.length ? `Códigos inválidos: ${m.invalidos.join(', ')}` : traslape.length ? `En ambas listas: ${traslape.join(', ')}` : null}
              ayuda={m.validos.length ? `${m.validos.length} país(es)` : undefined} />
            <Campo etiqueta="URL oficial de la declaración de alto riesgo" valor={fuenteAlto} setValor={setFuenteAlto} placeholder={FUENTE_ALTO}
              error={fuenteAlto && !url(fuenteAlto) ? 'Debe ser una página de fatf-gafi.org' : null} />
            <Campo etiqueta="URL oficial de la declaración de monitoreo intensificado" valor={fuenteMon} setValor={setFuenteMon}
              error={fuenteMon && !url(fuenteMon) ? 'Debe ser una página de fatf-gafi.org' : null} />
            {aviso && <Mensaje tipo={aviso.tipo}>{aviso.texto}</Mensaje>}
            <Boton disabled={!valido} onClick={async () => {
              setAviso(null);
              try {
                await fuente.cargarListaGafi({ plenario, altoRiesgo: a.validos, monitoreo: m.validos, fuenteAltoRiesgo: fuenteAlto, fuenteMonitoreo: fuenteMon });
                setAviso({ tipo: 'ok', texto: `Versión del pleno del ${plenario} cargada.` });
                setPlenario(''); setAlto(''); setMonitoreo(''); cargar();
              } catch (x) { setAviso({ tipo: 'error', texto: (x as Error).message }); }
            }}>Cargar versión</Boton>
            <p className="text-xs text-tinta-suave">Revise los códigos contra el texto oficial antes de cargar: una versión cargada no se puede corregir, solo reemplazar con la de un pleno posterior.</p>
          </div>
        </Tarjeta>
        <Tarjeta titulo="Versiones cargadas" className="lg:col-span-2"
          accion={vigente ? <Insignia clase="bg-bajo-claro text-bajo">Vigente: {vigente.plenario}</Insignia> : <Insignia clase="bg-alto-claro text-alto">Sin listas</Insignia>}>
          {!listas ? <Vacio>Cargando…</Vacio> : !listas.length ? <Vacio>No hay listas cargadas. El motor de riesgo no puede evaluar hasta cargarlas.</Vacio> : (
            <ul className="space-y-3 text-sm">
              {listas.map((l, i) => (
                <li key={l.id} className={`rounded-lg border px-3 py-2 ${i === 0 ? 'border-marca' : 'border-borde opacity-70'}`}>
                  <div className="font-medium">Pleno del {l.plenario}{i === 0 && ' · vigente'}</div>
                  <div className="text-xs text-tinta-suave">Alto riesgo: {l.altoRiesgo.join(', ') || '—'}</div>
                  <div className="text-xs text-tinta-suave">Monitoreo: {l.monitoreo.join(', ') || '—'}</div>
                  <div className="mt-1 text-xs text-tinta-suave">Cargada por {l.cargadaPor} · {fecha(l.cargadaEn)}</div>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
      </div>
    </div>
  );
}
