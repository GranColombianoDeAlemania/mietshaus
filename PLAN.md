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

### 0.6.1 – charges follow the contract

| Area | Contents | Status |
|------|----------|--------|
| Sollstellung | Saving a contract, a rent change, a notice or an accepted applicant books the charges of the automatic range at once (not only at the next hourly run) and rebooks months that no longer match amounts, start, end or part-month rule; older months only after asking, locked or hand-cancelled months never; months before the automation are offered for a new contract or a new start date | done |
| Anzeige | Payment form shows the tenant account (due, after this payment, next charge) and warns when a rent payment goes to an income account; contract page shows the next charge, credit and charges due today; deviations on the contract page, the Sollstellung page and in the check report | done |
| Sonstiges | A contract carrying only automatic charges can be deleted; prepared statements are cached (lists, contract pages and check report about 3× faster); nested transactions run inside the outer one | done |

## Version 0.7 – key figures and self-use

Built from the pick S2 K1–K7 K9 M1–M5 M7 E1–E5 N1–N5 Z1 (proposal https://claude.ai/artifact/FFcjQB583kkXcYPArk5UvP), with small gauges and one
size for all key figure tiles. Not picked: S1/S3, K8 yield gauge per object, K10 cockpit layout, M6 advance payment coverage, N6 own account for
self-use, N7 change assistant, Z2 explanation on every figure.

| Area | Contents | Status |
|------|----------|--------|
| Cockpit | Rent received this month as a ring (paid share of this month's charges, oldest first; who still owes), let area-days of 12 months without self-use and the cold rent lost to vacancy, arrears by age with § 543 flag, 90-day bank balance forecast (rents at each tenant's paid share and delay, loan instalments, insurance, last year's recurring costs; lowest point), year-to-date against last year, rent increase radar (§ 558 up to the comparative rent within cap and waiting periods, index, next step; „Vorbereiten“ fills in the adjustment), deadlines of 90 days, costs of the year by type; consumption jumps of ± 40 % as hints | done |
| Mieter | Payment score 0–100 with its formula, 24-month payment calendar by year, account history, tenancy facts with next steps (§ 558 date and amount, longer notice period), rent per m² against house average and rent index, deposit ring; payment behaviour also on the contract page | done |
| Einheit | Occupancy timeline with vacancy and its lost rent, cold rent charged/paid and the unit's own costs per year, consumption per m² against the house and last year, cost of the last change of tenant, rent per m² | done |
| Haus | House view by floor (let, arrears, notice, self-used, vacant) on the fact sheet and small on the cockpit tiles | done |
| Selbstnutzung | Periods with household size per unit; not vacant anywhere; service-charge statement with the landlord's own share (real household size under per-person keys); Anlage V only for the rented part (area and day; costs booked for a rented unit fully, for the own flat not at all; interest by area or own share), 15 % rule for the rented part; yield of the rented part or as if let; what the own flat costs per month; check report finds overlaps with tenancies | done |
| Buchungen | Costs can name the unit they concern (also afterwards and through Claude); receipts and projects of a unit count as well | done |
| Listen | Mini rings in the tenant list (payment score) and the unit list (occupancy), rent per m² coloured against the rent index | done |
| Tests | Calculation test section 16: every new figure recomputed on its own (FIFO payments, area-days, person-days, forecast events) | done |

## Version 0.8 – rent is a monthly amount

From the report of 17.10.2026 („800 € warm, 500 € gezahlt = 300 € offen, nicht anteilig täglich“) and the pick „1 ja, 2 ab dem 1. – änderbar bei
Einzug am 10. oder 15., 3 V1“.

| Area | Contents | Status |
|------|----------|--------|
| Sollstellung | Rent and house money are always full monthly amounts: the month of moving in or out is charged in full, never by day; moving in mid-month the contract may say „from the next month“; a tenancy's rent month can run from the day of moving in (e.g. 15th to 14th, due on the 3rd working day of that rent month or on a fixed day); charge texts and open items name such rent months | done |
| Umstellung | Existing contracts with „tagegenau“ become „voller Monat“; months booked by day are rebooked once at the first start (locked or hand-cancelled months stay and appear in the check report); the cockpit says what was rebooked | done |
| Mieterwechsel | A month charged twice on a change in mid-month is flagged in the contract form (one click: „from the next month“), on the contract page and in the check report; accepting an applicant after a move-out in the same month starts the rent with the next month | done |
| Abrechnung | Tenants count for the rent months they pay for (moving in on the 15th with a full month: from the 1st), per contract switchable to the days lived there; contracts charged for the same days split at the move-in day; WEG owners likewise; a special levy goes to the owner on its date | done |
| Betriebskosten (V1) | Per tenancy: advance payment, flat fee (own income account 60025, no statement) or included in the rent (no separate amount); for flat fee and inclusive rent only heating and hot water are settled, the landlord bears the rest; letters, Anlage V (flat fee counts as Umlagen), rent comparison and § 558 radar (gross rent not compared with the rent index) follow | done |
| Kennzahlen | Vacancy costs whole months without any rent charge; „as if let“ counts whole months of self-use | done |
| Tests | Calculation test section 17: Julian's case with every start and end, rent month from the 15th and the 31st, tenant change, statements by months and days, flat fee and inclusive rent, conversion of a 0.7 database | done |

## Development

```
cd ~/Work/wincasa/app
npm run dev        # Vite + Electron with hot reload (Linux)
npm run dist:mac   # packages an ad-hoc signed Apple Silicon app (zip) in release/ (needs rcodesign, see scripts/dist-mac.sh)
ELECTRON_RUN_AS_NODE=1 npx electron scripts/rechentest.cjs        # calculation test with the sample house
npm run build && XSD=<folder with pain.*.xsd> npx electron scripts/klicktest.cjs <outdir>   # click test
```
