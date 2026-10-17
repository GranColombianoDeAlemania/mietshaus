// PDF layouts for statements and budget plans.
import { anrede, datum, euro, zahl, type Row } from './api';
import { absaetze, bericht, brief, esc, tabelle, type Absender } from './dokument';

const z = (n: number) => zahl(Math.round(n * 1000) / 1000);

function p35aTabelle(p: Row) {
  if (!p.dienstleistung && !p.handwerker) return '';
  return `<h2>Steuerermäßigung nach § 35a EStG</h2>${tabelle(['Art', '#rIhr Anteil (inkl. Material)'], [
    ...(p.dienstleistung ? [['Haushaltsnahe Dienstleistungen (§ 35a Abs. 2)', `#r${euro(p.dienstleistung)}`]] : []),
    ...(p.handwerker ? [['Handwerkerleistungen (§ 35a Abs. 3)', `#r${euro(p.handwerker)}`]] : []),
  ])}<p class="klein">Bei Handwerkerleistungen ist nur der Lohnanteil begünstigt; bitte prüfen Sie die Rechnungen bei Bedarf bei uns.</p>`;
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
    ${vzOffen > 0 ? `<p>Bitte beachten Sie: Von den Vorauszahlungen für diesen Zeitraum sind ${euro(vzOffen)} noch nicht bei uns eingegangen. Die Abrechnung berücksichtigt die vereinbarten Vorauszahlungen;
      ${brutto + vzOffen > 0 ? `insgesamt sind damit noch <b>${euro(brutto + vzOffen)}</b> zu zahlen.` : `nach Verrechnung mit den offenen Vorauszahlungen verbleibt ein Guthaben von <b>${euro(-(brutto + vzOffen))}</b>.`}</p>` : ''}
    ${a.co2 ? `<p class="klein">CO₂-Kostenaufteilung: Das Gebäude verursacht ${a.co2.kg_pro_qm.toFixed(1).replace('.', ',')} kg CO₂ je m² Wohnfläche und Jahr. Der Vermieter trägt daher ${a.co2.vermieter_prozent} % der CO₂-Kosten (${euro(a.co2.kosten_ct)} gesamt); dieser Anteil ist oben bereits abgezogen.</p>` : ''}
    ${neu ? (neu.bk == null || nurHz ? `<p>Ab dem ${datum(neu.ab)} beträgt Ihre monatliche Vorauszahlung für Heizkosten <b>${euro(neu.hk)}</b>.</p>`
      : `<p>Ab dem ${datum(neu.ab)} betragen Ihre monatlichen Vorauszahlungen für Betriebskosten <b>${euro(neu.bk)}</b> und für Heizkosten <b>${euro(neu.hk)}</b>.</p>`) : ''}
    ${p35aTabelle(e.p35a)}
    <p class="klein">Die Belege können Sie nach Terminvereinbarung bei uns einsehen. Einwendungen gegen die Abrechnung sind spätestens bis zum Ablauf des zwölften Monats nach Zugang mitzuteilen (§ 556 Abs. 3 BGB).</p>
    <p class="unterschrift">Mit freundlichen Grüßen<br><br>${esc(absender.name)}</p>`;
  return brief({ absender, empfaenger: mieter, betreff: `${nurHz ? 'Heizkostenabrechnung' : 'Betriebskostenabrechnung'} ${a.von.slice(0, 4)} – ${objekt.bezeichnung}, ${s.einheit.bezeichnung}`,
    info: [['Objekt', objekt.bezeichnung], ['Einheit', s.einheit.bezeichnung]], inhalt });
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
  const inhalt = `
    <p>${esc(anrede(eigentuemer))}</p>
    <p>anbei erhalten Sie die Einzelabrechnung zur Jahresabrechnung ${a.von.slice(0, 4)} für Ihre Einheit ${esc(s.einheit.bezeichnung)}
    (Zeitraum ${datum(s.von)} – ${datum(s.bis)}).</p>
    <h2>Kosten und Erträge der Gemeinschaft</h2>
    ${tabelle(['Kostenart', '#rGesamt', 'Verteilung nach', '#rGesamteinheiten', '#rIhre Einheiten', '#rIhr Anteil'], zeilen,
      { summe: ['Summe', `#r${euro(a.summe_ct)}`, '', '', '', `#r${euro(e.kosten_ct)}`] })}
    <p class="klein">* auf Mieter umlegbare Betriebskosten: ${euro(e.umlagefaehig_ct)}</p>
    ${tabelle(['Abrechnung', '#rBetrag'], [
      ['Ihr Kostenanteil', `#r${euro(e.kosten_ct)}`],
      ['abzüglich Hausgeld-Vorschüsse lt. Wirtschaftsplan (ohne Rücklage)', `#r${euro(-e.hausgeld_soll_ct)}`],
    ], { summe: [e.ergebnis_ct > 0 ? 'Nachschuss (Abrechnungsspitze)' : 'Guthaben', `#r${euro(Math.abs(e.ergebnis_ct))}`] })}
    <h2>Erhaltungsrücklage</h2>
    ${tabelle(['', '#rBetrag'], [['Ihre Soll-Zuführung im Abrechnungsjahr', `#r${euro(e.ruecklage_soll_ct)}`],
      ['Stand der Rücklage der Gemeinschaft am ' + datum(a.bis), `#r${euro(r.ende_ct)}`]])}
    ${p35aTabelle(e.p35a)}
    <p class="klein">Über die Einforderung von Nachschüssen bzw. die Anpassung der Vorschüsse beschließt die Eigentümerversammlung (§ 28 Abs. 2 WEG).</p>
    <p class="unterschrift">Mit freundlichen Grüßen<br><br>${esc(absender.name)}</p>`;
  return brief({ absender, empfaenger: eigentuemer, betreff: `Hausgeld-Einzelabrechnung ${a.von.slice(0, 4)} – ${objekt.bezeichnung}`,
    info: [['Objekt', objekt.bezeichnung], ['Einheit', s.einheit.bezeichnung]], inhalt });
}

export function wegGesamt(a: Row, objekt: Row) {
  const r = a.ruecklage;
  const kosten = tabelle(['Kostenart', 'Verteilerschlüssel', '#rBetrag'], a.posten.map((p: Row) => [esc(p.label), esc(p.schluessel), `#r${euro(p.gesamt_ct)}`]),
    { summe: ['Summe Kosten', '', `#r${euro(a.summe_ct)}`] });
  const einzel = tabelle(['Einheit', 'Eigentümer', '#rKosten', '#rHausgeld-Soll', '#rErgebnis'],
    a.ergebnisse.map((e: Row) => [esc(e.segment.einheit.bezeichnung), esc(e.segment.vertrag.name), `#r${euro(e.kosten_ct)}`, `#r${euro(e.hausgeld_soll_ct)}`, `#r${euro(e.ergebnis_ct)}`]));
  const rl = tabelle(['Erhaltungsrücklage', '#rBetrag'], [
    ['Stand zu Beginn', `#r${euro(r.anfang_ct)}`], ['Soll-Zuführungen', `#r${euro(r.zufuehrung_soll_ct)}`],
    ['Entnahmen', `#r${euro(-r.entnahmen_ct)}`], ...(r.eroeffnung_ct ? [['Eröffnung / Übernahme', `#r${euro(r.eroeffnung_ct)}`]] : []),
  ], { summe: ['Stand am Ende', `#r${euro(r.ende_ct)}`] });
  const v = a.vermoegen;
  const verm = tabelle(['Vermögen am ' + datum(v.stichtag), '#rBetrag'], [
    ...v.geld.map((g: Row) => [esc(g.bezeichnung), `#r${euro(g.saldo_ct)}`]),
    ...v.forderungen.map((f: Row) => [`Forderung/Guthaben ${esc(f.bezeichnung)}`, `#r${euro(f.saldo_ct)}`]),
  ]);
  return bericht('Jahresabrechnung und Vermögensbericht', `${objekt.bezeichnung} · ${datum(a.von)} – ${datum(a.bis)}`,
    `<h2>Gesamtkosten</h2>${kosten}<h2>Einzelergebnisse</h2>${einzel}<h2>Rücklage</h2>${rl}<h2>Vermögensbericht (§ 28 Abs. 4 WEG)</h2>${verm}`);
}

export function wiplEinzel(w: Row, zeile: Row, absender: Absender, objekt: Row, eigentuemer: Row, ab: string) {
  const posten = tabelle(['Kostenart', '#rGesamt', 'Schlüssel', '#rIhr Anteil'],
    w.posten.map((p: Row, i: number) => [esc(p.label), `#r${euro(p.gesamt_ct)}`, esc(p.schluessel), `#r${euro(zeile.anteile[i])}`]),
    { summe: ['Summe Kosten', `#r${euro(w.summe_ct)}`, '', `#r${euro(zeile.kosten_ct)}`] });
  const inhalt = `<p>${esc(anrede(eigentuemer))}</p>
    <p>anbei erhalten Sie den Wirtschaftsplan ${w.jahr} für Ihre Einheit ${esc(zeile.einheit.bezeichnung)}.</p>
    ${posten}
    ${tabelle(['Jahresbetrag', '#rBetrag'], [['Kostenanteil', `#r${euro(zeile.kosten_ct)}`], ['Zuführung Erhaltungsrücklage', `#r${euro(zeile.ruecklage_ct)}`]],
      { summe: ['Summe', `#r${euro(zeile.kosten_ct + zeile.ruecklage_ct)}`] })}
    <p class="hervor">Monatliches Hausgeld ab ${datum(ab)}: ${euro(zeile.monat_hausgeld_ct)} (davon Rücklage ${euro(zeile.monat_ruecklage_ct)})</p>
    ${absaetze('Der Wirtschaftsplan wird mit Beschluss der Eigentümerversammlung verbindlich.')}
    <p class="unterschrift">Mit freundlichen Grüßen<br><br>${esc(absender.name)}</p>`;
  return brief({ absender, empfaenger: eigentuemer, betreff: `Wirtschaftsplan ${w.jahr} – ${objekt.bezeichnung}`,
    info: [['Objekt', objekt.bezeichnung], ['Einheit', zeile.einheit.bezeichnung]], inhalt });
}
