// PDF layouts for statements and budget plans.
import { anrede, datum, euro, zahl, type Row } from './api';
import { absaetze, bericht, brief, esc, tabelle, type Absender } from './dokument';
import { girocode } from './girocode';

const z = (n: number) => zahl(Math.round(n * 1000) / 1000);

function p35aTabelle(p: Row) {
  if (!p.dienstleistung && !p.handwerker) return '';
  return `<h2>Steuerermäßigung nach § 35a EStG</h2>${tabelle(['Art', '#rIhr Anteil (Arbeits- und Fahrtkosten, ohne Material)'], [
    ...(p.dienstleistung ? [['Haushaltsnahe Dienstleistungen (§ 35a Abs. 2)', `#r${euro(p.dienstleistung)}`]] : []),
    ...(p.handwerker ? [['Handwerkerleistungen (§ 35a Abs. 3)', `#r${euro(p.handwerker)}`]] : []),
  ])}<p class="klein">Begünstigt sind nur Arbeits- und Fahrtkosten, nicht das Material; die Beträge enthalten nur diesen Anteil. Die Rechnungen können Sie bei uns einsehen.</p>`;
}

// A tenancy whose operating costs are a flat fee or part of the rent: only heating and hot water are settled.
export const nurHeizung = (e: Row) => !!e.segment?.vertrag && !!e.bk_art && e.bk_art !== 'vorauszahlung';

export function nkBrief(a: Row, e: Row, absender: Absender, objekt: Row, mieter: Row, neu: { bk: number | null; hk: number; ab: string } | null, vzOffen = 0) {
  const s = e.segment;
  const nurHz = nurHeizung(e);
  const kosten = e.umgelegt_ct ?? e.kosten_ct;
  const zeilen = a.posten.map((p: Row, i: number) => [esc(p.label), `#r${euro(p.gesamt_ct)}`, esc(p.schluessel),
    `#r${p.gesamt_einheiten ? z(p.gesamt_einheiten) : ''}`, `#r${e.anteile[i].einheiten ? z(e.anteile[i].einheiten) : ''}`, `#r${euro(e.anteile[i].ct)}`])
    .filter((_: unknown, i: number) => a.posten[i].gesamt_ct !== 0 && (!nurHz || a.posten[i].heizung || a.posten[i].co2));
  const brutto = e.ergebnis_ct + (e.ust_ct ?? 0);
  const ergebnis = brutto > 0
    ? `Aus der Abrechnung ergibt sich eine <b>Nachzahlung von ${euro(brutto)}</b>. Bitte überweisen Sie den Betrag innerhalb von 30 Tagen nach Zugang dieser Abrechnung auf das unten genannte Konto.`
    : brutto < 0
      ? `Aus der Abrechnung ergibt sich ein <b>Guthaben von ${euro(-brutto)}</b> zu Ihren Gunsten. Wir überweisen Ihnen den Betrag bzw. verrechnen ihn mit der nächsten Mietzahlung.`
      : 'Ihre Vorauszahlungen decken die Kosten genau.';
  const inhalt = `
    <p>${esc(anrede(mieter))}</p>
    <p>hiermit erhalten Sie die ${nurHz ? 'Heizkostenabrechnung' : 'Betriebs- und Heizkostenabrechnung'} für den Zeitraum ${datum(a.von)} bis ${datum(a.bis)}.
    Ihr Nutzungszeitraum: ${datum(s.von)} bis ${datum(s.bis)} (${s.tage} Tage).</p>
    ${nurHz ? `<p>Ihre Betriebskosten sind ${e.bk_art === 'inklusiv' ? 'in der Miete enthalten' : 'mit der vereinbarten Pauschale abgegolten'} und werden nicht abgerechnet;
      abgerechnet werden nur Heizung und Warmwasser nach der Heizkostenverordnung.</p>` : ''}
    ${tabelle(['Kostenart', '#rGesamtkosten', 'Verteilung nach', '#rGesamt', '#rIhr Anteil', '#rIhre Kosten'], zeilen,
      { summe: ['Summe Ihrer Kosten', '', '', '', '', `#r${euro(kosten)}`] })}
    ${tabelle(['Abrechnung', '#rBetrag'], [
      ['Ihre Kosten', `#r${euro(kosten)}`],
      ...(nurHz ? [] : [[`abzüglich Betriebskosten-Vorauszahlungen${e.ust_ct ? ' (netto)' : ''}`, `#r${euro(-e.bk_vz_ct)}`]]),
      [`abzüglich Heizkosten-Vorauszahlungen${e.ust_ct ? ' (netto)' : ''}`, `#r${euro(-e.hk_vz_ct)}`],
      ...(e.ust_ct ? [[`Ergebnis netto`, `#r${euro(e.ergebnis_ct)}`], [`zuzüglich ${e.ust_satz} % Umsatzsteuer`, `#r${euro(e.ust_ct)}`]] : []),
    ], { summe: [e.ergebnis_ct > 0 ? 'Nachzahlung' : 'Guthaben', `#r${euro(Math.abs(e.ergebnis_ct + (e.ust_ct ?? 0)))}`] })}
    <p>${ergebnis}</p>
    ${e.ausgeschlossen_ct > 0 ? `<p>Rechnerisch ergäbe sich eine Nachzahlung von ${euro(e.ausgeschlossen_ct)}. Da die Abrechnungsfrist abgelaufen ist, verlangen wir sie nicht (§ 556 Abs. 3 Satz 3 BGB).</p>` : ''}
    ${a.frist?.abgelaufen && a.frist.grund && brutto > 0 ? `<p>Diese Abrechnung erreicht Sie nach Ablauf der Abrechnungsfrist. Die Verspätung haben wir nicht zu vertreten: ${esc(a.frist.grund)} (§ 556 Abs. 3 Satz 3 BGB).</p>` : ''}
    ${vzOffen > 0 ? `<p>Bitte beachten Sie: Von den Vorauszahlungen für diesen Zeitraum sind ${euro(vzOffen)} noch nicht bei uns eingegangen. Die Abrechnung berücksichtigt die vereinbarten Vorauszahlungen;
      ${brutto + vzOffen > 0 ? `insgesamt sind damit noch <b>${euro(brutto + vzOffen)}</b> zu zahlen.` : `nach Verrechnung mit den offenen Vorauszahlungen verbleibt ein Guthaben von <b>${euro(-(brutto + vzOffen))}</b>.`}</p>` : ''}
    ${girocode(absender, brutto + vzOffen, `${nurHz ? 'Heizkostenabrechnung' : 'Betriebskostenabrechnung'} ${a.von.slice(0, 4)} ${s.einheit.bezeichnung} ${objekt.bezeichnung}`)}
    ${heizAngaben(a, e)}
    ${neu ? (neu.bk == null || nurHz ? `<p>Ab dem ${datum(neu.ab)} beträgt Ihre monatliche Vorauszahlung für Heizkosten <b>${euro(neu.hk)}</b>.</p>`
      : `<p>Ab dem ${datum(neu.ab)} betragen Ihre monatlichen Vorauszahlungen für Betriebskosten <b>${euro(neu.bk)}</b> und für Heizkosten <b>${euro(neu.hk)}</b>.</p>`) : ''}
    ${p35aTabelle(e.p35a)}
    <p class="klein">Die Belege können Sie nach Terminvereinbarung bei uns einsehen. Einwendungen gegen die Abrechnung sind spätestens bis zum Ablauf des zwölften Monats nach Zugang mitzuteilen (§ 556 Abs. 3 BGB).</p>
    <p class="unterschrift">Mit freundlichen Grüßen<br><br>${esc(absender.name)}</p>`;
  return brief({ absender, empfaenger: mieter, betreff: `${nurHz ? 'Heizkostenabrechnung' : 'Betriebskostenabrechnung'} ${a.von.slice(0, 4)} – ${objekt.bezeichnung}, ${s.einheit.bezeichnung}`,
    info: [['Objekt', objekt.bezeichnung], ['Einheit', s.einheit.bezeichnung]], inhalt });
}

// Information a heating statement must give: the CO2 split (§ 7 CO2KostAufG) and, when the landlord bills heating himself,
// fuel, taxes, comparison with last year and with the house, contacts (§ 6a Abs. 3 HeizkostenV) – else 3 % reduction each.
function heizAngaben(a: Row, e: Row) {
  const k = (x: number) => x.toFixed(1).replace('.', ',');
  const teile: string[] = [];
  if (a.co2) {
    const c = a.co2;
    const grundlage = [c.brennstoff && `Brennstoff ${esc(c.brennstoff)}`, c.menge && `Menge ${esc(c.menge)}`, c.faktor && `Emissionsfaktor ${esc(c.faktor)}`].filter(Boolean).join(', ');
    teile.push(`<b>CO₂-Kosten (CO2KostAufG):</b> Das Gebäude hat im Abrechnungszeitraum ${Math.round(c.kg).toLocaleString('de-DE')} kg CO₂ ausgestoßen${c.nichtwohn ? '' : `, das sind ${k(c.kg_pro_qm)} kg je m² Wohnfläche und Jahr`}${grundlage ? ` (${grundlage})` : ''}. `
      + `CO₂-Kosten des Gebäudes: ${euro(c.kosten_ct)}. ${c.nichtwohn ? 'Für Nichtwohngebäude tragen Vermieter und Mieter je die Hälfte' : `Nach dem Stufenmodell trägt der Vermieter ${String(c.stufe_prozent).replace('.', ',')} %`}`
      + `${c.halbiert ? `, wegen öffentlich-rechtlicher Vorgaben halbiert auf ${String(c.vermieter_prozent).replace('.', ',')} %` : ''}.`
      + (e.co2 ? ` Auf Sie entfallen CO₂-Kosten von ${euro(e.co2.brutto_ct)}; davon trägt der Vermieter ${euro(e.co2.vermieter_ct)} (oben abgezogen), Sie tragen ${euro(e.co2.mieter_ct)}.` : ''));
  }
  if (a.heizung?.modus === 'intern' && e.heiz_ct) {
    const v = e.vergleich;
    const verbrauch = v ? `Ihr Verbrauch: ${Math.round(v.jetzt).toLocaleString('de-DE')} ${esc(v.einheit)}${v.vorher != null ? ` (Vorjahr ${Math.round(v.vorher).toLocaleString('de-DE')} ${esc(v.einheit)})` : ' (kein Vorjahreswert)'}`
      + `${v.je_qm != null && v.haus_je_qm != null ? `; je m² ${k(v.je_qm)}, Durchschnitt des Hauses ${k(v.haus_je_qm)} ${esc(v.einheit)}` : ''}. `.replace(/\.\. $/, '. ') : '';
    teile.push(`<b>Angaben nach § 6a HeizkostenV:</b> ${verbrauch}Energieträger: ${esc(a.optionen?.brennstoff || 'siehe Brennstoffrechnung')}. `
      + `Im Preis enthalten sind Energiesteuer, CO₂-Preis nach dem Brennstoffemissionshandelsgesetz und Umsatzsteuer${a.optionen?.abgaben_ct ? ` (zusammen ${euro(a.optionen.abgaben_ct)})` : ''}. `
      + 'Beratung und Informationen zum Energiesparen: Verbraucherzentrale (verbraucherzentrale.de), Deutsche Energie-Agentur (dena.de), Energieberatung der Verbraucherzentralen (verbraucherzentrale-energieberatung.de).');
  }
  return teile.length ? `<div class="klein">${teile.map((t) => `<p>${t}</p>`).join('')}</div>` : '';
}

export function nkUebersicht(a: Row, objekt: Row) {
  const posten = tabelle(['Kostenart', 'Schlüssel', '#rGesamteinheiten', '#rBetrag'],
    a.posten.map((p: Row) => [esc(p.label), esc(p.schluessel), `#r${p.gesamt_einheiten ? z(p.gesamt_einheiten) : ''}`, `#r${euro(p.gesamt_ct)}`]),
    { summe: ['Summe', '', '', `#r${euro(a.summe_ct)}`] });
  const erg = tabelle(['Einheit', 'Nutzer', 'Zeitraum', '#rKosten', '#rVorauszahlungen', '#rErgebnis'],
    a.ergebnisse.map((e: Row) => [esc(e.segment.einheit.bezeichnung), e.segment.vertrag
      ? `${esc(e.segment.vertrag.name)}${nurHeizung(e) ? ` <i>(${e.bk_art === 'inklusiv' ? 'Inklusivmiete' : 'BK-Pauschale'}: nur Heizung, ${euro(e.nicht_umgelegt_ct)} trägt der Vermieter)</i>` : ''}`
      : e.segment.selbst ? '<i>selbst genutzt (Eigenanteil)</i>' : '<i>Leerstand (Vermieter)</i>',
      `${datum(e.segment.von)} – ${datum(e.segment.bis)}`, `#r${euro(e.umgelegt_ct ?? e.kosten_ct)}`, `#r${euro(e.bk_vz_ct + e.hk_vz_ct)}`, `#r${euro(e.ergebnis_ct)}`]));
  return bericht(`Betriebskostenabrechnung – Gesamtübersicht`, `${objekt.bezeichnung} · ${datum(a.von)} – ${datum(a.bis)}`, `<h2>Kosten</h2>${posten}<h2>Verteilung</h2>${erg}`);
}

export function wegEinzel(a: Row, e: Row, absender: Absender, objekt: Row, eigentuemer: Row) {
  const s = e.segment;
  const zeilen = a.posten.map((p: Row, i: number) => [esc(p.label) + (p.umlagefaehig ? ' *' : ''), `#r${euro(p.gesamt_ct)}`, esc(p.schluessel),
    `#r${p.gesamt_einheiten ? z(p.gesamt_einheiten) : ''}`, `#r${e.anteile[i].einheiten ? z(e.anteile[i].einheiten) : ''}`, `#r${euro(e.anteile[i].ct)}`]);
  const r = a.ruecklage;
  // Change of owner: the whole Abrechnungsspitze of the unit is owed by the owner on the day of the resolution
  // (Fälligkeitstheorie); the other owner's share is information for the settlement between seller and buyer.
  const sp = (a.spitzen ?? []).find((x: Row) => x.einheit.id === s.einheit.id);
  const schuldner = !sp || !sp.wechsel || sp.schuldner.id === s.vertrag.id;
  const spitzeText = !sp?.wechsel ? '' : schuldner
    ? `<p>Die Einheit hat im Abrechnungsjahr den Eigentümer gewechselt. Die Abrechnungsspitze der ganzen Einheit schuldet bzw. erhält, wer am Tag des Beschlusses Eigentümer ist (Fälligkeitstheorie): <b>${sp.ergebnis_ct > 0 ? 'Nachschuss' : 'Guthaben'} ${euro(Math.abs(sp.ergebnis_ct))}</b> für das ganze Jahr. Ihr eigener Zeitraum oben dient dem Ausgleich mit dem bisherigen Eigentümer laut Kaufvertrag.</p>`
    : `<p>Sie waren nur einen Teil des Jahres Eigentümer. Die Abrechnungsspitze der Einheit schuldet bzw. erhält, wer am Tag des Beschlusses Eigentümer ist (Fälligkeitstheorie), gegenüber der Gemeinschaft also: ${esc(sp.schuldner.name)}. Ihr Anteil oben ist eine Information für den Ausgleich laut Kaufvertrag; wir buchen ihn nicht auf Ihr Konto.</p>`;
  const inhalt = `
    <p>${esc(anrede(eigentuemer))}</p>
    <p>anbei erhalten Sie die Einzelabrechnung zur Jahresabrechnung ${a.von.slice(0, 4)} für Ihre Einheit ${esc(s.einheit.bezeichnung)}
    (Zeitraum ${datum(s.von)} – ${datum(s.bis)}).</p>
    <h2>Kosten und Erträge der Gemeinschaft</h2>
    ${tabelle(['Kostenart', '#rGesamt', 'Verteilung nach', '#rGesamteinheiten', '#rIhre Einheiten', '#rIhr Anteil'], zeilen,
      { summe: ['Summe', `#r${euro(a.summe_ct)}`, '', '', '', `#r${euro(e.kosten_ct)}`] })}
    <p class="klein">* auf Mieter umlegbare Betriebskosten: ${euro(e.umlagefaehig_ct)} – Zuordnung ohne Gewähr; für die Abrechnung mit Ihrem Mieter sind die Kosten nach dem Verbrauchszeitraum abzugrenzen.</p>
    ${tabelle(['Abrechnung', '#rBetrag'], [
      ['Ihr Kostenanteil', `#r${euro(e.kosten_ct)}`],
      ['abzüglich Hausgeld-Vorschüsse lt. Wirtschaftsplan (ohne Rücklage)', `#r${euro(-e.hausgeld_soll_ct)}`],
      ...(e.sonderumlage_ct ? [['abzüglich Sonderumlagen', `#r${euro(-e.sonderumlage_ct)}`]] : []),
    ], { summe: [(e.ergebnis_ct > 0 ? 'Nachschuss (Abrechnungsspitze)' : 'Guthaben') + (schuldner ? '' : ' – Information'), `#r${euro(Math.abs(e.ergebnis_ct))}`] })}
    ${spitzeText}
    ${e.gezahlt_ct != null ? tabelle(['Ihr Hausgeldkonto', '#rBetrag'], [['Im Abrechnungszeitraum gezahlt', `#r${euro(e.gezahlt_ct)}`], ['Rückstand bzw. Guthaben am ' + datum(s.bis), `#r${euro(e.rueckstand_ct ?? 0)}`]]) : ''}
    <h2>Erhaltungsrücklage</h2>
    ${tabelle(['', '#rBetrag'], [['Ihre Soll-Zuführung im Abrechnungsjahr', `#r${euro(e.ruecklage_soll_ct)}`], ...(e.ruecklage_ist_ct != null ? [['davon gezahlt', `#r${euro(e.ruecklage_ist_ct)}`]] : []),
      ['Stand der Rücklage der Gemeinschaft am ' + datum(a.bis) + ' (Soll)', `#r${euro(r.ende_ct)}`],
      ['Stand der Rücklage der Gemeinschaft am ' + datum(a.bis) + ' (Ist, gezahlt und mit Zinsen)', `#r${euro(r.ist_ende_ct ?? r.ende_ct)}`]])}
    ${p35aTabelle(e.p35a)}
    <p class="klein">Über die Einforderung von Nachschüssen bzw. die Anpassung der Vorschüsse beschließt die Eigentümerversammlung (§ 28 Abs. 2 WEG).</p>
    <p class="unterschrift">Mit freundlichen Grüßen<br><br>${esc(absender.name)}</p>`;
  return brief({ absender, empfaenger: eigentuemer, betreff: `Hausgeld-Einzelabrechnung ${a.von.slice(0, 4)} – ${objekt.bezeichnung}`,
    info: [['Objekt', objekt.bezeichnung], ['Einheit', s.einheit.bezeichnung]], inhalt });
}

export function wegGesamt(a: Row, objekt: Row) {
  const r = a.ruecklage;
  const kosten = tabelle(['Kostenart', 'Verteilerschlüssel', '#rBetrag'], a.posten.map((p: Row) => [esc(p.label), esc(p.schluessel), `#r${euro(p.gesamt_ct)}`]),
    { summe: ['Summe Kosten abzüglich Einnahmen', '', `#r${euro(a.summe_ct)}`] });
  const einzel = tabelle(['Einheit', 'Eigentümer', '#rKosten', '#rHausgeld-Soll', '#rErgebnis'],
    a.ergebnisse.map((e: Row) => [esc(e.segment.einheit.bezeichnung), esc(e.segment.vertrag.name), `#r${euro(e.kosten_ct)}`, `#r${euro(e.hausgeld_soll_ct)}`, `#r${euro(e.ergebnis_ct)}`]));
  const rl = tabelle(['Erhaltungsrücklage', '#rBetrag'], [
    ['Stand zu Beginn', `#r${euro(r.anfang_ct)}`], ['Soll-Zuführungen', `#r${euro(r.zufuehrung_soll_ct)}`],
    ['Entnahmen', `#r${euro(-r.entnahmen_ct)}`], ...(r.eroeffnung_ct ? [['Eröffnung / Übernahme', `#r${euro(r.eroeffnung_ct)}`]] : []),
    ['Soll-Stand am Ende', `#r${euro(r.ende_ct)}`],
    ...(r.offen_zufuehrung_ct ? [['noch nicht gezahlte Zuführungen', `#r${euro(-r.offen_zufuehrung_ct)}`]] : []),
    ...(r.zinsen_ct ? [['Zinserträge im Jahr', `#r${euro(r.zinsen_ct)}`]] : []),
  ], { summe: ['Ist-Stand am Ende', `#r${euro(r.ist_ende_ct ?? r.ende_ct)}`] });
  const v = a.vermoegen;
  const verm = tabelle(['Vermögen am ' + datum(v.stichtag), '#rBetrag'], [
    ...v.geld.map((g: Row) => [esc(g.bezeichnung), `#r${euro(g.saldo_ct)}`]),
    ...v.forderungen.map((f: Row) => [`Forderung/Guthaben ${esc(f.bezeichnung)}`, `#r${euro(f.saldo_ct)}`]),
    ...(v.forderungen_nach_art ?? []).map((x: Row) => [`davon offen: ${esc(x.art)}`, `#r${euro(x.ct)}`]),
    ...(v.verbindlichkeiten ?? []).map((x: Row) => [`Verbindlichkeit: ${esc(x.titel || x.absender || 'Rechnung')}${x.datum ? ` vom ${datum(x.datum)}` : ''}`, `#r${euro(-x.betrag_ct)}`]),
    ['Erhaltungsrücklage (Ist)', `#r${euro(r.ist_ende_ct ?? r.ende_ct)}`],
  ]);
  const kontenEntw = (a.konten_entwicklung ?? []).length ? tabelle(['Konto', '#rAnfang', '#rEingänge', '#rAusgänge', '#rEnde'],
    a.konten_entwicklung.map((k: Row) => [esc(k.bezeichnung), `#r${euro(k.anfang_ct)}`, `#r${euro(k.ein_ct)}`, `#r${euro(-k.aus_ct)}`, `#r${euro(k.ende_ct)}`])) : '';
  const wechsel = (a.spitzen ?? []).filter((x: Row) => x.wechsel);
  const einzelPlus = wechsel.length ? einzel + `<p class="klein">Eigentümerwechsel – die Abrechnungsspitze schuldet der Eigentümer am Tag des Beschlusses (Fälligkeitstheorie): ${wechsel.map((x: Row) => `${esc(x.einheit.bezeichnung)} ${esc(x.schuldner.name)} ${euro(x.ergebnis_ct)}`).join('; ')}. Die Zeilen je Eigentümer dienen dem Ausgleich zwischen Verkäufer und Käufer.</p>` : einzel;
  return bericht('Jahresabrechnung und Vermögensbericht', `${objekt.bezeichnung} · ${datum(a.von)} – ${datum(a.bis)}`,
    `<h2>Gesamtkosten und Einnahmen</h2>${kosten}<h2>Kontenentwicklung</h2>${kontenEntw}<h2>Einzelergebnisse</h2>${einzelPlus}<h2>Rücklage</h2>${rl}<h2>Vermögensbericht (§ 28 Abs. 4 WEG)</h2>${verm}`);
}

export function wiplEinzel(w: Row, zeile: Row, absender: Absender, objekt: Row, eigentuemer: Row, ab: string) {
  const posten = tabelle(['Kostenart', '#rGesamt', 'Schlüssel', '#rGesamteinheiten', '#rIhre Einheiten', '#rIhr Anteil'],
    w.posten.map((p: Row, i: number) => [esc(p.label), `#r${euro(p.gesamt_ct)}`, esc(p.schluessel),
      `#r${p.gesamt_einheiten ? z(p.gesamt_einheiten) : ''}`, `#r${zeile.einheiten_je_posten?.[i] ? z(zeile.einheiten_je_posten[i]) : ''}`, `#r${euro(zeile.anteile[i])}`]),
    { summe: ['Summe', `#r${euro(w.summe_ct)}`, '', '', '', `#r${euro(zeile.kosten_ct)}`] });
  const tag = zeile.eigentum?.faelligkeitstag || 3;
  const konto = absender.iban ? ` auf das Konto ${absender.kontoinhaber ? `${esc(absender.kontoinhaber)}, ` : ''}IBAN ${esc(absender.iban)}` : '';
  const inhalt = `<p>${esc(anrede(eigentuemer))}</p>
    <p>anbei erhalten Sie den Wirtschaftsplan ${w.jahr} für Ihre Einheit ${esc(zeile.einheit.bezeichnung)}.</p>
    ${posten}
    ${tabelle(['Jahresbetrag', '#rBetrag'], [['Kostenanteil', `#r${euro(zeile.kosten_ct)}`], ['Zuführung Erhaltungsrücklage', `#r${euro(zeile.ruecklage_ct)}`]],
      { summe: ['Summe', `#r${euro(zeile.kosten_ct + zeile.ruecklage_ct)}`] })}
    <p class="hervor">Monatlicher Vorschuss (Hausgeld) ab ${datum(ab)}: ${euro(zeile.monat_hausgeld_ct)} (davon Rücklage ${euro(zeile.monat_ruecklage_ct)}), fällig jeweils bis zum ${tag}. eines Monats${konto}.</p>
    ${absaetze('Beschlossen werden die Vorschüsse nach diesem Plan (§ 28 Abs. 1 WEG); sie gelten ab dem Beschluss der Eigentümerversammlung. Die Monatsbeträge sind aufgerundet – Unterschiede gleicht die Jahresabrechnung aus.')}
    <p class="unterschrift">Mit freundlichen Grüßen<br><br>${esc(absender.name)}</p>`;
  return brief({ absender, empfaenger: eigentuemer, betreff: `Wirtschaftsplan ${w.jahr} – ${objekt.bezeichnung}`,
    info: [['Objekt', objekt.bezeichnung], ['Einheit', zeile.einheit.bezeichnung]], inhalt });
}
