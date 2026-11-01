// Invoice details in the document form: who sent it (letterhead and imprint), VAT per rate, the line items and the
// labour and travel share for § 35a. Recognised by electron/belege.cjs, always editable here.
import { euro, parseCent, zahl, type Row } from '../api';

export const ctText = (ct: number | null | undefined) => (ct == null ? '' : (ct / 100).toFixed(2).replace('.', ','));
const ctAus = (s: string) => (s && s.trim() ? parseCent(s) : null);

export type Steuerzeile = { satz: string; netto: string; ust: string };
export type Position = { text: string; menge: string; einheit: string; betrag: string; art: string };
export type BelegWerte = { steller: Row; steuer: Steuerzeile[]; positionen: Position[]; lohn: string };

export const STELLER_FELDER: [string, string, string?][] = [
  ['name', 'Firma / Name', 'breit'], ['strasse', 'Straße'], ['plz', 'PLZ'], ['ort', 'Ort', 'breit'],
  ['telefon', 'Telefon'], ['email', 'E-Mail'], ['web', 'Website', 'breit'],
  ['ust_id', 'USt-IdNr.'], ['steuernr', 'Steuernummer'], ['register', 'Handelsregister', 'breit'],
  ['inhaber', 'Inhaber / Geschäftsführung', 'breit'], ['bank', 'Bank'], ['bic', 'BIC'], ['iban', 'IBAN', 'breit'],
];
const ARTEN: [string, string][] = [['', '–'], ['arbeit', 'Arbeit'], ['anfahrt', 'Anfahrt'], ['material', 'Material']];

export function belegWerte(d: Row): BelegWerte {
  return {
    steller: { ...(d.steller ?? {}) },
    steuer: (d.steuer ?? []).map((t: Row) => ({ satz: String(t.satz ?? ''), netto: ctText(t.netto_ct), ust: ctText(t.ust_ct) })),
    positionen: (d.positionen ?? []).map((p: Row) => ({ text: p.text ?? '', menge: p.menge != null ? zahl(p.menge) : '', einheit: p.einheit ?? '', betrag: ctText(p.betrag_ct), art: p.art ?? '' })),
    lohn: ctText(d.lohn_ct),
  };
}

// The fields as dokumentSpeichern takes them.
export function belegDaten(w: BelegWerte) {
  const steller = Object.fromEntries(Object.entries(w.steller).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]).filter(([, v]) => v));
  return {
    steller: Object.keys(steller).length ? steller : null,
    steuer: w.steuer.filter((t) => t.satz !== '' || t.netto || t.ust)
      .map((t) => ({ satz: Number(String(t.satz).replace(',', '.')) || 0, netto_ct: ctAus(t.netto) ?? 0, ust_ct: ctAus(t.ust) ?? 0 })),
    positionen: w.positionen.filter((p) => p.text.trim() || p.betrag)
      .map((p) => ({ text: p.text.trim(), menge: p.menge ? Number(p.menge.replace(/\./g, '').replace(',', '.')) || null : null, einheit: p.einheit.trim() || null,
        betrag_ct: ctAus(p.betrag), satz: null, art: p.art || null })),
    lohn_ct: ctAus(w.lohn),
  };
}

// Labour and travel of the items, gross: items printed net are scaled up when their sum is the net amount.
function lohnAusPositionen(w: BelegWerte, brutto: number | null) {
  const pos = belegDaten(w).positionen;
  const lohn = pos.filter((p) => p.art === 'arbeit' || p.art === 'anfahrt').reduce((s, p) => s + (p.betrag_ct ?? 0), 0);
  if (!lohn) return null;
  const summe = pos.reduce((s, p) => s + (p.betrag_ct ?? 0), 0);
  const netto = belegDaten(w).steuer.reduce((s, t) => s + t.netto_ct, 0);
  return brutto && netto && Math.abs(summe - netto) <= Math.max(5, netto * 0.005) && Math.abs(summe - brutto) > 5 ? Math.round(lohn * brutto / netto) : lohn;
}

export function Rechnungssteller(props: { w: BelegWerte; set: (w: BelegWerte) => void; offen?: boolean; kontakt?: { id: number | null; name?: string | null }; onKontakt?: () => void }) {
  const st = props.w.steller;
  const kurz = [st.name, [st.plz, st.ort].filter(Boolean).join(' '), st.ust_id && `USt-IdNr. ${st.ust_id}`].filter(Boolean).join(' · ');
  return (
    <details className="beleg-teil" open={props.offen}>
      <summary><b>Rechnungssteller</b> <span className="klein hinweis">{kurz || 'nicht erkannt – bitte eintragen'}</span></summary>
      <div className="maske zwei">
        {STELLER_FELDER.map(([k, l, breit]) => (
          <label key={k} className={breit ? 'breit' : ''}>{l}
            <input value={st[k] ?? ''} onChange={(e) => props.set({ ...props.w, steller: { ...st, [k]: e.target.value } })} />
          </label>
        ))}
      </div>
      {props.onKontakt && !props.kontakt?.id && st.name && (
        <p className="klein"><button className="link" onClick={props.onKontakt}>Als Kontakt anlegen</button>
          <span className="hinweis"> – dann wird die nächste Rechnung dieser Firma sicher zugeordnet.</span></p>
      )}
    </details>
  );
}

export function BetraegeUndPositionen(props: { w: BelegWerte; set: (w: BelegWerte) => void; brutto: number | null; offen?: boolean }) {
  const { w, set, brutto } = props;
  const d = belegDaten(w);
  const netto = d.steuer.reduce((s, t) => s + t.netto_ct, 0);
  const ust = d.steuer.reduce((s, t) => s + t.ust_ct, 0);
  const summeStimmt = !d.steuer.length || !brutto || Math.abs(netto + ust - brutto) <= 2 * d.steuer.length;
  const satzFalsch = d.steuer.some((t) => t.satz > 0 && t.netto_ct && Math.abs(Math.round(t.netto_ct * t.satz / 100) - t.ust_ct) > 2);
  const posSumme = d.positionen.reduce((s, p) => s + (p.betrag_ct ?? 0), 0);
  const posPasst = !d.positionen.length || [brutto, netto].some((x) => x && Math.abs(posSumme - x) <= Math.max(5, x * 0.005));
  const lohnVorschlag = lohnAusPositionen(w, brutto);
  const setSteuer = (i: number, k: keyof Steuerzeile, v: string) => set({ ...w, steuer: w.steuer.map((t, j) => (j === i ? { ...t, [k]: v } : t)) });
  const setPos = (i: number, k: keyof Position, v: string) => set({ ...w, positionen: w.positionen.map((p, j) => (j === i ? { ...p, [k]: v } : p)) });
  // One rate out of the gross amount (0 % for small businesses and authorities).
  const ausBrutto = (satz: number) => {
    if (!brutto) return;
    const u = Math.round(brutto * satz / (100 + satz));
    set({ ...w, steuer: [{ satz: String(satz), netto: ctText(brutto - u), ust: ctText(u) }] });
  };
  const kurz = [d.steuer.length ? d.steuer.map((t) => `${zahl(t.satz)} % MwSt ${euro(t.ust_ct)}`).join(', ') : 'MwSt unbekannt',
    d.positionen.length ? `${d.positionen.length} Position(en)` : null, d.lohn_ct != null ? `Arbeit ${euro(d.lohn_ct)}` : null].filter(Boolean).join(' · ');
  return (
    <details className="beleg-teil" open={props.offen}>
      <summary><b>Beträge & Positionen</b> <span className="klein hinweis">{kurz}</span></summary>
      <table className="beleg-tabelle">
        <thead><tr><th>MwSt-Satz %</th><th className="num">Netto €</th><th className="num">MwSt €</th><th className="num">Brutto</th><th /></tr></thead>
        <tbody>
          {w.steuer.map((t, i) => (
            <tr key={i}>
              <td><input inputMode="decimal" value={t.satz} onChange={(e) => setSteuer(i, 'satz', e.target.value)} /></td>
              <td><input className="num" inputMode="decimal" value={t.netto} onChange={(e) => setSteuer(i, 'netto', e.target.value)} /></td>
              <td><input className="num" inputMode="decimal" value={t.ust} onChange={(e) => setSteuer(i, 'ust', e.target.value)} /></td>
              <td className="num">{euro((ctAus(t.netto) ?? 0) + (ctAus(t.ust) ?? 0))}</td>
              <td><button className="link klein" title="Zeile entfernen" onClick={() => set({ ...w, steuer: w.steuer.filter((_, j) => j !== i) })}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="buttons klein">
        <button className="link" onClick={() => set({ ...w, steuer: [...w.steuer, { satz: '19', netto: '', ust: '' }] })}>+ Satz</button>
        {brutto ? <>
          <span className="hinweis">aus dem Betrag {euro(brutto)}:</span>
          <button className="link" onClick={() => ausBrutto(19)}>19 %</button>
          <button className="link" onClick={() => ausBrutto(7)}>7 %</button>
          <button className="link" onClick={() => ausBrutto(0)} title="Kleinunternehmer (§ 19 UStG), Behörden, steuerfreie Leistungen">ohne MwSt</button>
        </> : null}
      </p>
      {!summeStimmt && <p className="fehlertext klein">Netto + MwSt ({euro(netto + ust)}) ergibt nicht den Betrag ({euro(brutto)}).</p>}
      {satzFalsch && <p className="fehlertext klein">Die MwSt passt nicht zum Satz – bitte prüfen.</p>}

      {/* Two lines per item, the description on its own line: the form column is narrow. */}
      {w.positionen.length > 0 && <div className="beleg-pos kopf klein"><span>Menge</span><span>Einheit</span><span className="num">Betrag €</span><span>Art</span><span /></div>}
      {w.positionen.map((p, i) => (
        <div key={i} className="beleg-pos">
          <input className="text" placeholder="Bezeichnung" aria-label="Bezeichnung" value={p.text} onChange={(e) => setPos(i, 'text', e.target.value)} />
          <input className="num" inputMode="decimal" aria-label="Menge" value={p.menge} onChange={(e) => setPos(i, 'menge', e.target.value)} />
          <input aria-label="Einheit" value={p.einheit} onChange={(e) => setPos(i, 'einheit', e.target.value)} />
          <input className="num" inputMode="decimal" aria-label="Betrag" value={p.betrag} onChange={(e) => setPos(i, 'betrag', e.target.value)} />
          <select aria-label="Art" value={p.art} onChange={(e) => setPos(i, 'art', e.target.value)}>{ARTEN.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <button className="link klein" title="Position entfernen" onClick={() => set({ ...w, positionen: w.positionen.filter((_, j) => j !== i) })}>✕</button>
        </div>
      ))}
      <p className="buttons klein">
        <button className="link" onClick={() => set({ ...w, positionen: [...w.positionen, { text: '', menge: '', einheit: '', betrag: '', art: '' }] })}>+ Position</button>
        {d.positionen.length > 0 && <span className={posPasst ? 'hinweis' : 'fehlertext'}>Summe der Positionen {euro(posSumme)}
          {posPasst ? '' : ` – passt weder zu netto (${euro(netto || null)}) noch zum Betrag (${euro(brutto)}); vielleicht fehlt eine Position`}</span>}
      </p>
      <div className="maske zwei">
        <label className="breit">davon Arbeits- und Fahrtkosten, brutto (§ 35a)
          <input className="num" inputMode="decimal" value={w.lohn} onChange={(e) => set({ ...w, lohn: e.target.value })} placeholder="unbekannt" />
        </label>
        <p className="klein hinweis" style={{ gridColumn: 'span 2', margin: 0 }}>
          {lohnVorschlag != null && lohnVorschlag !== d.lohn_ct
            ? <>Aus den Positionen: {euro(lohnVorschlag)} <button className="link" onClick={() => set({ ...w, lohn: ctText(lohnVorschlag) })}>übernehmen</button></>
            : 'Mieter können nur Arbeits- und Fahrtkosten absetzen, kein Material.'}
        </p>
      </div>
    </details>
  );
}
