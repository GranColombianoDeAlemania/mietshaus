# Hausverwalter – Roadmap

A personal Mac app with Win-CASA's range of features. It uses its own code and its own data model.
Win-CASA (template database `../db/schema.sql`, form inventory `../forms_own.txt`) is used only
to learn which features, fields and calculations exist.

Two modes, kept separate but linked:
- **Mietverwaltung** – orange accent
- **WEG-Verwaltung** – green accent
- **Projekte** – slate blue accent
- Mixed houses (rental and WEG together) appear in both modes; each unit shows its tenant and its owner.

## Phases

| # | Area | Contents (Win-CASA counterpart) | Status |
|---|------|---------------------------------|--------|
| 1 | Grundgerüst & Stammdaten | Mode switch, objects (OBJEKTE), units (WOHNUNG), address book, tenancies (BEWOHNER), ownership (EIGENTUEMER), allocation keys + shares (EUSCHLU/ANTEILE) | done (v0.1) |
| 2 | Zähler | Meters, readings, meter replacement, conversion factors (ZAEHLERSTAMM/ZAEHLERSTAND) | done |
| 3 | Buchhaltung | Chart of accounts (SKR03/04-like), posting, split postings, journal, account statement, balance list, posting templates (BUCHUNG/SPLITBUCH/BUCHVORL) | done |
| 4 | Sollstellung & OP | Rent/house-money charges, open items, payment assignment, direct-debit runs, dunning (SOLLGEST/MAHN*) | done |
| 5 | Bank | CAMT.053/MT940 import, learning auto-assignment, SEPA XML (pain.001/pain.008), mandates | done |
| 6 | Abrechnungen Miete | Service-charge statement, CO2 cost split, §35a, heating costs, adjustment of advance payments (NKMASTER/NKDETAIL/HK_*) | done |
| 7 | Abrechnungen WEG | House-money statement, budget plan, reserves, asset statement (WIPL/RUECK*) | done |
| 8 | Miete extras | Deposit incl. interest, indexed and stepped rent, rent increase, keys, insurance | done |
| 9 | WEG extras | Meetings, votes, resolution register, advisory board, sub-communities | done |
| 10 | Dokumente | Letter/mail-merge templates, PDF output, document archive, lists/reports | done |
| 11 | CRM | Cases, tasks, appointments, calls, e-mail archive | done |
| 12 | Export & System | DATEV export, CSV/Excel, backup, users/rights | done |
| 13 | Optional | Not built: online banking (FinTS/HBCI), tenant portal/app, AI assistant, TWAIN scanning, telephony, Outlook sync, multi-user server, report designer | open |

## Version 0.3 – smarter

| Area | Contents | Status |
|------|----------|--------|
| Dokumente | Postfach (drag & drop, folder, e-mail), OCR, field recognition, duplicates, full-text search, invoices | done |
| Claude | MCP connection for Claude Desktop (no API key): inbox processing, filing, booking, master data, projects, hints | done |
| Cockpit | Automatic monthly charges, rule-based hints with snooze/done, key figures, cash-flow chart | done |
| Projekte | Third mode: projects with Gantt, dependencies, quotes/orders/invoices, budget forecast, year plan | done |
| Auswertungen | Yield per object, Anlage V (inflow principle, AfA), cost take-over from external WEG statements | done |
| Bank | Returned debits detected (with case), outgoing payments matched to open invoices | done |
| NAS-Sync | One shared database file on the Synology (SMB), lock per device, PDFs local for 4 weeks | open (user sets up NAS first) |

## Version 0.6 – linked and checked

| Area | Contents | Status |
|------|----------|--------|
| Navigation | Every name, unit, contract and account is a link; detail pages for person, unit, contract and account; back/forward (⌘[ ⌘], swipe), breadcrumb, hover cards, unit tree in the sidebar, right-click menu, files dropped onto records | done |
| Design | Calm anthracite sidebar, off-white pages, hairlines instead of shadows, thin large figures; accent per mode | done |
| Miete | Partial month per contract (by day / full month / from the next month); first month never due before moving in; 3rd working day with public holidays per state; VAT for commercial lettings; instalment plans; notice assistant with letters; permanent invoices | done |
| Briefe | Model letters (certificates, Wohnungsgeberbestätigung, reminders, warnings, announcements) and checked letters for § 558, § 557b, § 557a, § 559 and § 560 Abs. 4; letters to a contract address every tenant | done |
| Prüfung | Check report (about 35 checks), checks before a service-charge statement (deadline, non-allocable costs, cable TV, fibre fee, CO₂, heating share, vacancy), year-end assistant | done |
| Steuer | 15 % rule (net per booking, exact with e-invoices), § 82b distribution, tax adviser package (ZIP), VAT overview (Kz 81/86/66/83) | done |
| E-Rechnung | ZUGFeRD/Factur-X (XML inside the PDF) and XRechnung (CII and UBL): exact amounts, VAT, IBAN, line items; readable view; input tax when booking | done |
| Tests | `scripts/rechentest.cjs` builds a sample house and recomputes every figure independently; `scripts/klicktest.cjs` opens every page, clicks the buttons and checks PDFs and SEPA XML (ISO 20022 schemas) | done |

## Development

```
cd ~/Work/wincasa/app
npm run dev        # Vite + Electron with hot reload (Linux)
npm run dist:mac   # packages an ad-hoc signed Apple Silicon app (zip) in release/ (needs rcodesign, see scripts/dist-mac.sh)
ELECTRON_RUN_AS_NODE=1 npx electron scripts/rechentest.cjs        # calculation test with the sample house
npm run build && XSD=<folder with pain.*.xsd> npx electron scripts/klicktest.cjs <outdir>   # click test
```
