import { useEffect, useState } from 'react';
import { Boton, Campo, Insignia, Mensaje, Tarjeta, Vacio, fecha } from '../componentes/ui';
import type { Designacion1373, Fuente } from '../fuente/tipos';
import { leerCodigosIso } from '../validacion';

const hoy = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Guatemala' });
const lista = (t: string) => t.split(/[;\n]/).map((x) => x.trim()).filter(Boolean);

/**
 * Designaciones de la resolución S/RES/1373(2001) (art. 43 c). No están en la
 * lista consolidada de la ONU: las hace Guatemala u otro Estado y llegan por
 * comunicación oficial. Al registrar una, se coteja de inmediato toda la
 * cartera activa de todas las organizaciones.
 */
export function Designaciones1373({ fuente }: { fuente: Fuente }) {
  const [filas, setFilas] = useState<Designacion1373[] | null>(null);
  const [tipo, setTipo] = useState<'individual' | 'entidad'>('individual');
  const [nombre, setNombre] = useState('');
  const [alias, setAlias] = useState('');
  const [documentos, setDocumentos] = useState('');
  const [fechas, setFechas] = useState('');
  const [nacionalidades, setNacionalidades] = useState('');
  const [autoridad, setAutoridad] = useState('');
  const [referencia, setReferencia] = useState('');
  const [fuenteUrl, setFuenteUrl] = useState('');
  const [designadaEl, setDesignadaEl] = useState('');
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const cargar = () => fuente.designaciones1373().then(setFilas).catch((x) => setAviso({ tipo: 'error', texto: x.message }));
  useEffect(() => { cargar(); }, [fuente]);

  const nac = leerCodigosIso(nacionalidades);
  const fechasLista = lista(fechas);
  const fechasMal = fechasLista.filter((f) => !/^\d{4}(-\d{2}-\d{2})?$/.test(f));
  const urlMal = fuenteUrl.trim() !== '' && !/^https?:\/\/\S+$/.test(fuenteUrl.trim());
  const valido = nombre.trim().length >= 3 && autoridad.trim().length >= 3 && referencia.trim().length >= 3
    && /^\d{4}-\d{2}-\d{2}$/.test(designadaEl) && designadaEl <= hoy() && !nac.invalidos.length && !fechasMal.length && !urlMal;
  const vigentes = filas?.filter((d) => !d.revocadaEl).length ?? 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Designaciones S/RES/1373</h1>
        <p className="mt-1 text-sm text-tinta-suave">
          El art. 43 incluye las designaciones hechas en virtud de la resolución S/RES/1373(2001), que no están en la lista consolidada
          de la ONU ni tienen descarga automática. Regístrelas aquí con la autoridad y el documento que las comunica. Al registrar una,
          se coteja de inmediato la cartera activa de todas las organizaciones. Una designación no se modifica ni se borra: se revoca.
        </p>
      </div>
      <div className="grid gap-5 lg:grid-cols-5">
        <Tarjeta titulo="Registrar designación" className="lg:col-span-3">
          <div className="space-y-3">
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="radio" checked={tipo === 'individual'} onChange={() => setTipo('individual')} /> Persona individual</label>
              <label className="flex items-center gap-2"><input type="radio" checked={tipo === 'entidad'} onChange={() => setTipo('entidad')} /> Entidad</label>
            </div>
            <Campo etiqueta={tipo === 'individual' ? 'Nombre completo' : 'Nombre o razón social'} valor={nombre} setValor={setNombre} />
            <Campo etiqueta="Alias (separados por punto y coma)" valor={alias} setValor={setAlias} placeholder="Opcional" />
            <Campo etiqueta="Documentos de identificación (separados por punto y coma)" valor={documentos} setValor={setDocumentos} placeholder="Opcional" />
            {tipo === 'individual' && (
              <Campo etiqueta="Fechas de nacimiento (AAAA o AAAA-MM-DD, separadas por punto y coma)" valor={fechas} setValor={setFechas}
                error={fechasMal.length ? `Formato inválido: ${fechasMal.join(', ')}` : null} ayuda="Mejora la precisión del cotejo" />
            )}
            <Campo etiqueta="Nacionalidades (códigos ISO de 2 letras)" valor={nacionalidades} setValor={setNacionalidades} placeholder="Ej.: GT, MX"
              error={nac.invalidos.length ? `Códigos inválidos: ${nac.invalidos.join(', ')}` : null} />
            <Campo etiqueta="Autoridad o Estado que designa" valor={autoridad} setValor={setAutoridad} placeholder="Ej.: Guatemala · Ministerio Público" />
            <Campo etiqueta="Referencia del documento (resolución, oficio)" valor={referencia} setValor={setReferencia} />
            <Campo etiqueta="Fecha de la designación" tipo="date" valor={designadaEl} setValor={setDesignadaEl}
              error={designadaEl && designadaEl > hoy() ? 'No puede ser futura' : null} />
            <Campo etiqueta="Enlace a la fuente oficial" valor={fuenteUrl} setValor={setFuenteUrl} placeholder="Opcional"
              error={urlMal ? 'Indique una dirección http(s) válida' : null} />
            {aviso && <Mensaje tipo={aviso.tipo}>{aviso.texto}</Mensaje>}
            <Boton disabled={!valido} onClick={async () => {
              setAviso(null);
              try {
                await fuente.registrarDesignacion1373({
                  tipo, nombre: nombre.trim(), alias: lista(alias), documentos: lista(documentos), fechasNacimiento: tipo === 'individual' ? fechasLista : [],
                  nacionalidades: nac.validos, autoridad: autoridad.trim(), referencia: referencia.trim(),
                  fuenteUrl: fuenteUrl.trim() || undefined, designadaEl,
                });
                setAviso({ tipo: 'ok', texto: `${nombre.trim()} registrada. La cartera activa se está cotejando contra esta designación.` });
                setNombre(''); setAlias(''); setDocumentos(''); setFechas(''); setNacionalidades(''); setReferencia(''); setFuenteUrl(''); setDesignadaEl('');
                cargar();
              } catch (x) { setAviso({ tipo: 'error', texto: (x as Error).message }); }
            }}>Registrar designación</Boton>
            <p className="text-xs text-tinta-suave">Revise los datos contra el documento oficial: una designación registrada no se corrige; si hay un error, revóquela y registre la correcta.</p>
          </div>
        </Tarjeta>
        <Tarjeta titulo="Registradas" className="lg:col-span-2"
          accion={<Insignia clase={vigentes ? 'bg-alto-claro text-alto' : 'bg-slate-100 text-slate-700'}>{vigentes} vigente(s)</Insignia>}>
          {!filas ? <Vacio>Cargando…</Vacio> : !filas.length ? (
            <Vacio>No hay designaciones registradas. Mientras no haya ninguna, los expedientes solo se cotejan con la lista de la ONU.</Vacio>
          ) : (
            <ul className="space-y-3 text-sm">
              {filas.map((d) => <FilaDesignacion key={d.id} d={d} fuente={fuente} alCambiar={cargar} />)}
            </ul>
          )}
        </Tarjeta>
      </div>
    </div>
  );
}

function FilaDesignacion({ d, fuente, alCambiar }: { d: Designacion1373; fuente: Fuente; alCambiar: () => void }) {
  const [abierta, setAbierta] = useState(false);
  const [revocadaEl, setRevocadaEl] = useState(hoy());
  const [referencia, setReferencia] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <li className={`rounded-lg border px-3 py-2 ${d.revocadaEl ? 'border-borde opacity-60' : 'border-alto/40'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium">{d.nombre}</div>
        <Insignia clase={d.revocadaEl ? 'bg-slate-100 text-slate-700' : 'bg-alto-claro text-alto'}>{d.revocadaEl ? `Revocada ${d.revocadaEl}` : 'Vigente'}</Insignia>
      </div>
      <div className="text-xs text-tinta-suave">{d.tipo === 'individual' ? 'Persona individual' : 'Entidad'} · {d.autoridad} · {d.referencia} · {d.designadaEl}</div>
      {d.alias.length > 0 && <div className="text-xs text-tinta-suave">Alias: {d.alias.join('; ')}</div>}
      {d.revocacionReferencia && <div className="text-xs text-tinta-suave">Revocación: {d.revocacionReferencia}</div>}
      <div className="mt-1 text-xs text-tinta-suave">Registrada por {d.cargadaPor} · {fecha(d.cargadaEn)}</div>
      {!d.revocadaEl && (abierta ? (
        <div className="mt-2 space-y-2">
          <Campo etiqueta="Fecha de la revocación" tipo="date" valor={revocadaEl} setValor={setRevocadaEl} />
          <Campo etiqueta="Referencia del documento que revoca" valor={referencia} setValor={setReferencia} />
          {error && <Mensaje tipo="error">{error}</Mensaje>}
          <Boton tipo="secundario" disabled={referencia.trim().length < 3 || !revocadaEl || revocadaEl > hoy()} onClick={async () => {
            try { await fuente.revocarDesignacion1373(d.id, revocadaEl, referencia); alCambiar(); } catch (x) { setError((x as Error).message); }
          }}>Confirmar revocación</Boton>
        </div>
      ) : (
        <button className="mt-1 text-xs text-tinta-suave underline hover:text-tinta" onClick={() => setAbierta(true)}>Revocar…</button>
      ))}
    </li>
  );
}
