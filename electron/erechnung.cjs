// E-invoices (EN 16931): ZUGFeRD / Factur-X (XML embedded in a PDF) and XRechnung, in both syntaxes –
// UN/CEFACT CII (CrossIndustryInvoice) and OASIS UBL (Invoice / CreditNote). Reads the fields the archive and
// the bookkeeping need; amounts are returned in cents.

// Small XML reader: elements with attributes and text, namespace prefixes dropped. Enough for invoice data.
function xmlBaum(xml) {
  const wurzel = { name: '#', kinder: [], attr: {}, text: '' };
  const stapel = [wurzel];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  const lokal = (n) => n.replace(/^.*:/, '');
  const entitaet = (s) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => (
    e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'amp' ? '&' : e === 'quot' ? '"' : e === 'apos' ? "'"
      : e[1] === 'x' || e[1] === 'X' ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(Number(e.slice(1)))));
  let m;
  while ((m = re.exec(xml))) {
    const oben = stapel[stapel.length - 1];
    if (m[1] != null) oben.text += m[1];
    else if (m[2]) { if (stapel.length > 1) stapel.pop(); }
    else if (m[3]) {
      const attr = {};
      for (const a of (m[4] ?? '').matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attr[lokal(a[1])] = entitaet(a[2] ?? a[3] ?? '');
      const knoten = { name: lokal(m[3]), attr, kinder: [], text: '' };
      oben.kinder.push(knoten);
      if (!m[5]) stapel.push(knoten);
    } else if (m[6]) oben.text += entitaet(m[6]);
  }
  return wurzel.kinder[0] ?? null;
}

// Path access: "A/B/C" finds the first match; alle() every match of the last step.
const kind = (k, n) => k?.kinder.find((x) => x.name === n) ?? null;
const pfad = (k, p) => p.split('/').reduce((x, n) => (x ? kind(x, n) : null), k);
const txt = (k, p) => { const x = p ? pfad(k, p) : k; return x ? x.text.trim() : null; };
const alle = (k, p) => {
  const teile = p.split('/');
  const letzt = teile.pop();
  const eltern = teile.length ? pfad(k, teile.join('/')) : k;
  return eltern ? eltern.kinder.filter((x) => x.name === letzt) : [];
};
const ct = (s) => (s == null || s === '' || isNaN(Number(s)) ? null : Math.round(Number(s) * 100));
const zahl = (s) => (s == null || s === '' || isNaN(Number(s)) ? null : Number(s));
// CII dates use format 102 (YYYYMMDD).
const datum102 = (s) => (s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

function cii(r) {
  const doc = kind(r, 'ExchangedDocument');
  const tx = kind(r, 'SupplyChainTradeTransaction');
  const ag = kind(tx, 'ApplicableHeaderTradeAgreement');
  const st = kind(tx, 'ApplicableHeaderTradeSettlement');
  const summe = kind(st, 'SpecifiedTradeSettlementHeaderMonetarySummation');
  const partei = (p) => p && {
    name: txt(p, 'Name'),
    strasse: txt(p, 'PostalTradeAddress/LineOne'), plz: txt(p, 'PostalTradeAddress/PostcodeCode'), ort: txt(p, 'PostalTradeAddress/CityName'),
    ust_id: alle(p, 'SpecifiedTaxRegistration').map((x) => kind(x, 'ID')).find((x) => x?.attr.schemeID === 'VA')?.text.trim() ?? null,
    steuernr: alle(p, 'SpecifiedTaxRegistration').map((x) => kind(x, 'ID')).find((x) => x?.attr.schemeID === 'FC')?.text.trim() ?? null,
  };
  const zahlung = alle(st, 'SpecifiedTradeSettlementPaymentMeans');
  const steuer = alle(st, 'ApplicableTradeTax').map((x) => ({ satz: zahl(txt(x, 'RateApplicablePercent')), basis_ct: ct(txt(x, 'BasisAmount')), steuer_ct: ct(txt(x, 'CalculatedAmount')), kategorie: txt(x, 'CategoryCode') }));
  const zeilen = alle(tx, 'IncludedSupplyChainTradeLineItem').map((z) => ({
    text: txt(z, 'SpecifiedTradeProduct/Name'),
    menge: zahl(txt(z, 'SpecifiedLineTradeDelivery/BilledQuantity')), einheit: pfad(z, 'SpecifiedLineTradeDelivery/BilledQuantity')?.attr.unitCode ?? null,
    preis_ct: ct(txt(z, 'SpecifiedLineTradeAgreement/NetPriceProductTradePrice/ChargeAmount')),
    netto_ct: ct(txt(z, 'SpecifiedLineTradeSettlement/SpecifiedTradeSettlementLineMonetarySummation/LineTotalAmount')),
    satz: zahl(txt(z, 'SpecifiedLineTradeSettlement/ApplicableTradeTax/RateApplicablePercent')),
  }));
  const typ = txt(doc, 'TypeCode');
  return {
    syntax: 'CII', profil: txt(r, 'ExchangedDocumentContext/GuidelineSpecifiedDocumentContextParameter/ID'),
    nummer: txt(doc, 'ID'), typ_code: typ, gutschrift: typ === '381',
    datum: datum102(txt(doc, 'IssueDateTime/DateTimeString')),
    faellig: datum102(txt(st, 'SpecifiedTradePaymentTerms/DueDateDateTime/DateTimeString')),
    zahlungsbedingung: txt(st, 'SpecifiedTradePaymentTerms/Description'),
    leistung_von: datum102(txt(st, 'BillingSpecifiedPeriod/StartDateTime/DateTimeString')),
    leistung_bis: datum102(txt(st, 'BillingSpecifiedPeriod/EndDateTime/DateTimeString')),
    lieferdatum: datum102(txt(tx, 'ApplicableHeaderTradeDelivery/ActualDeliverySupplyChainEvent/OccurrenceDateTime/DateTimeString')),
    waehrung: txt(st, 'InvoiceCurrencyCode') ?? 'EUR',
    verkaeufer: partei(kind(ag, 'SellerTradeParty')), kaeufer: partei(kind(ag, 'BuyerTradeParty')),
    kaeufer_referenz: txt(ag, 'BuyerReference'),
    iban: zahlung.map((z) => txt(z, 'PayeePartyCreditorFinancialAccount/IBANID')).find(Boolean)?.replace(/\s/g, '') ?? null,
    verwendungszweck: txt(st, 'PaymentReference'),
    netto_ct: ct(txt(summe, 'TaxBasisTotalAmount')) ?? ct(txt(summe, 'LineTotalAmount')),
    ust_ct: ct(alle(summe, 'TaxTotalAmount').find((x) => !x.attr.currencyID || x.attr.currencyID === (txt(st, 'InvoiceCurrencyCode') ?? 'EUR'))?.text),
    brutto_ct: ct(txt(summe, 'GrandTotalAmount')),
    zahlbetrag_ct: ct(txt(summe, 'DuePayableAmount')) ?? ct(txt(summe, 'GrandTotalAmount')),
    steuer, zeilen,
  };
}

function ubl(r) {
  const gutschrift = r.name === 'CreditNote';
  const partei = (p) => {
    const x = kind(p, 'Party');
    if (!x) return null;
    const steuer = alle(x, 'PartyTaxScheme');
    return {
      name: txt(x, 'PartyName/Name') ?? txt(x, 'PartyLegalEntity/RegistrationName'),
      strasse: txt(x, 'PostalAddress/StreetName'), plz: txt(x, 'PostalAddress/PostalZone'), ort: txt(x, 'PostalAddress/CityName'),
      ust_id: steuer.map((s) => txt(s, 'CompanyID')).find((s) => s && /^[A-Z]{2}/.test(s)) ?? null,
      steuernr: steuer.map((s) => txt(s, 'CompanyID')).find((s) => s && !/^[A-Z]{2}/.test(s)) ?? null,
    };
  };
  const zahlung = alle(r, 'PaymentMeans');
  const summe = kind(r, 'LegalMonetaryTotal');
  const steuerTotal = alle(r, 'TaxTotal').find((t) => alle(t, 'TaxSubtotal').length) ?? kind(r, 'TaxTotal');
  const steuer = alle(steuerTotal, 'TaxSubtotal').map((x) => ({ satz: zahl(txt(x, 'TaxCategory/Percent')), basis_ct: ct(txt(x, 'TaxableAmount')), steuer_ct: ct(txt(x, 'TaxAmount')), kategorie: txt(x, 'TaxCategory/ID') }));
  const zeilen = alle(r, gutschrift ? 'CreditNoteLine' : 'InvoiceLine').map((z) => {
    const menge = kind(z, gutschrift ? 'CreditedQuantity' : 'InvoicedQuantity');
    return { text: txt(z, 'Item/Name'), menge: zahl(menge?.text.trim()), einheit: menge?.attr.unitCode ?? null,
      preis_ct: ct(txt(z, 'Price/PriceAmount')), netto_ct: ct(txt(z, 'LineExtensionAmount')), satz: zahl(txt(z, 'Item/ClassifiedTaxCategory/Percent')) };
  });
  return {
    syntax: 'UBL', profil: txt(r, 'CustomizationID'),
    nummer: txt(r, 'ID'), typ_code: txt(r, gutschrift ? 'CreditNoteTypeCode' : 'InvoiceTypeCode'), gutschrift: gutschrift || txt(r, 'InvoiceTypeCode') === '381',
    datum: datum102(txt(r, 'IssueDate')),
    faellig: datum102(txt(r, 'DueDate') ?? zahlung.map((z) => txt(z, 'PaymentDueDate')).find(Boolean)),
    zahlungsbedingung: txt(r, 'PaymentTerms/Note'),
    leistung_von: datum102(txt(r, 'InvoicePeriod/StartDate')), leistung_bis: datum102(txt(r, 'InvoicePeriod/EndDate')),
    lieferdatum: datum102(txt(r, 'Delivery/ActualDeliveryDate')),
    waehrung: txt(r, 'DocumentCurrencyCode') ?? 'EUR',
    verkaeufer: partei(kind(r, 'AccountingSupplierParty')), kaeufer: partei(kind(r, 'AccountingCustomerParty')),
    kaeufer_referenz: txt(r, 'BuyerReference'),
    iban: zahlung.map((z) => txt(z, 'PayeeFinancialAccount/ID')).find(Boolean)?.replace(/\s/g, '') ?? null,
    verwendungszweck: zahlung.map((z) => txt(z, 'PaymentID')).find(Boolean) ?? null,
    netto_ct: ct(txt(summe, 'TaxExclusiveAmount')) ?? ct(txt(summe, 'LineExtensionAmount')),
    ust_ct: ct(txt(steuerTotal, 'TaxAmount')),
    brutto_ct: ct(txt(summe, 'TaxInclusiveAmount')),
    zahlbetrag_ct: ct(txt(summe, 'PayableAmount')) ?? ct(txt(summe, 'TaxInclusiveAmount')),
    steuer, zeilen,
  };
}

// Returns the invoice data, or null when the XML is not an e-invoice.
function lesen(xml) {
  if (!xml || !/<(?:\w+:)?(CrossIndustryInvoice|Invoice|CreditNote)\b/.test(xml)) return null;
  const r = xmlBaum(xml);
  if (!r) return null;
  if (r.name === 'CrossIndustryInvoice') return cii(r);
  if (r.name === 'Invoice' || r.name === 'CreditNote') return ubl(r);
  return null;
}

// Plain text of an e-invoice, for the search index and for Claude.
function alsText(e) {
  const euro = (c) => (c == null ? '' : `${(c / 100).toFixed(2).replace('.', ',')} €`);
  const d = (iso) => (iso ? iso.split('-').reverse().join('.') : '');
  const p = (x) => (x ? [x.name, x.strasse, [x.plz, x.ort].filter(Boolean).join(' '), x.ust_id && `USt-IdNr. ${x.ust_id}`, x.steuernr && `St.-Nr. ${x.steuernr}`].filter(Boolean).join(', ') : '');
  return [
    `${e.gutschrift ? 'Gutschrift' : 'Rechnung'} ${e.nummer ?? ''} vom ${d(e.datum)} (E-Rechnung ${e.syntax})`,
    `Rechnungssteller: ${p(e.verkaeufer)}`, `Rechnungsempfänger: ${p(e.kaeufer)}`,
    e.leistung_von || e.leistung_bis ? `Leistungszeitraum: ${d(e.leistung_von)} – ${d(e.leistung_bis)}` : e.lieferdatum ? `Leistungsdatum: ${d(e.lieferdatum)}` : '',
    ...e.zeilen.map((z) => `${z.menge ?? ''} ${z.einheit ?? ''} ${z.text ?? ''} ${euro(z.netto_ct)}`.trim()),
    `Netto ${euro(e.netto_ct)}, Umsatzsteuer ${euro(e.ust_ct)}, Gesamt ${euro(e.brutto_ct)}, zu zahlen ${euro(e.zahlbetrag_ct)}`,
    e.faellig ? `Fällig am ${d(e.faellig)}` : '', e.iban ? `IBAN ${e.iban}` : '', e.verwendungszweck ? `Verwendungszweck ${e.verwendungszweck}` : '',
  ].filter(Boolean).join('\n');
}

module.exports = { lesen, alsText, xmlBaum };
