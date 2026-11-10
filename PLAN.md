# Mietshaus – Roadmap

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
| NAS-Sync | Replaced in 0.10 by the Mietshaus server on the NAS (one database, no merge) – see below | replaced |

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

### 0.8.1 – part months as an option

From the pick „1 ja 2 ok aber als option“: a tenancy can say „anteilig bis Monatsende“ for the month of moving in (by days from the move-in day,
or an agreed amount split like the monthly amounts) and „anteilig bis zum Auszugstag“ for the month of moving out; the standard stays the full
month. Charges name the days („Miete 10/2026 (20.10.–31.10.)“), arrears stay per charge, statements count from / up to those days, a vacancy
counts the unpaid days of such a month; the form shows the first and last amount. Calculation test: 441 checks.

## Version 0.9.1 – review fixes

From the review of 27.10.2026 („2. bitte beheben, aber so dass Versionen von mehreren Usern nächstens nur die aktuellste Information
benutzen; sonst alle Punkte so angenommen“, pick „Beides“).

| Area | Contents | Status |
|------|----------|--------|
| Datum | Today, the current month and deadlines in local time (electron/zeit.cjs, src/api.ts, SQL `date('now', 'localtime')`); before, the UTC date put a booking made at 0:30 on 1 January into the previous year | done |
| Sicherung | Restore checks the file (database? Mietshaus? damaged? newer version?), compares its state (newest change, device) with the data in use, warns about older backups and offers the newest backup of the same data set; the backup is migrated beside the database before replacing it, failures put the old state back. Daily automatic backups (14 days + 12 months) and a copy before every schema update, in `sicherungen` next to the database | done |
| Mehrere Nutzer | Every record carries time (UTC) and device of its last change, the log the device, the data set an id (schema 0.9.1). Basis for merging copies of several users record by record with the newest change winning; deletions are in the log. Merge itself: open | prepared |
| Technik | One running instance; charges worked out and booked in one IMMEDIATE transaction (app and Claude at the same time); a contract and its charges saved together; a database from a newer version is not opened; the MCP server follows a restored database; Electron 44.10 and MCP SDK 1.32.2 (npm audit clean); `codesign` on the Mac with an own certificate (MIETSHAUS_SIGNATUR) so the mail password survives updates; an unreadable mail password is reported; an error on one page no longer blanks the window | done |
| Oberfläche | Arrears tile legend, ring labels, vacancy text without known rent, one date in the index rent check, account picker with search, app dialogs instead of confirm/alert, favourites and visible group arrows in the sidebar, done first steps folded, cockpit names its scope, empty inbox explains intake | done |
| Claude | Bookings, contracts, contract ends and changes to persons (bank details) only as proposals, accepted or rejected in the app („Vorschläge von Claude“, hint in the cockpit; can be switched off). Every log entry can be undone while the record was not changed afterwards; bookings by reversal | done |
| Entwicklung | Git; `npm test` (type check, calculation, backup, Claude/undo tests), `npm run test:klick`; database function names typed in `call()`; one HTML-to-PDF path | done |
| Offen | pain.001/pain.008 schemas for the click test (XSD files from ISO 20022 not in the repository); merge of several users' copies | open |

## Version 0.10 – server on the NAS

From the pick „Ja, planen“ of 28.10.2026 (Synology with Container Manager, 2–3 users with the same rights, local mode
stays, also in the browser). Instead of merging copies of several users there is one database on the NAS.

| Area | Contents | Status |
|------|----------|--------|
| Kern | PDF reading with pdf.js in Node (`electron/pdf.cjs`, scans rendered with @napi-rs/canvas), OCR without a browser window; HEIC with sips or heic-convert; source, device and user of every change from `temp.kontext` (schema 21: `benutzer`, `sitzungen`, `geaendert_benutzer`, `protokoll.benutzer`) | done |
| Server | `server/server.cjs` (node:http): database API over `POST /api/call`, login with scrypt and session cookie, lockout per login, first user, user management, Server-Sent Events, upload and analysis, documents only for logged-in users, filing, tax package, backup download and restore in two steps, inbox folder, mail (password AES-GCM with key file), monthly charges and daily backup | done |
| Oberfläche | `src/bruecke.ts`: the same `window.hv` over HTTP for browser and Mac app; login and first-user screen, users, connection, restore dialog; browser stand-ins (download, print dialog for PDFs, own context menu); phone layout with slide-in menu below 800 px | done |
| Mac-App | Window onto a server: embedded on 127.0.0.1 with a token (local mode) or the NAS address; desktop extras in `electron/desktop.cjs` (PDF, save dialogs, opening documents, native menus, Claude Desktop); one-time transfer of a Mac's data and documents into an empty server | done |
| Claude | Tools in `electron/mcpWerkzeuge.cjs`; on the server under `/mcp` (Streamable HTTP, Claude token per user, changes logged as „Claude“ for that user); on the Mac `mcp.cjs` forwards stdio to the server | done |
| Betrieb | `Dockerfile` (node 24 slim, no Electron), `compose.yaml` for Container Manager (port only on 127.0.0.1, Tailscale serve in front), GitHub Action builds amd64/arm64 to ghcr.io, `ANLEITUNG-NAS.md` | done |
| Tests | `scripts/servertest.cjs` (HTTP, users, events, upload, restore, local mode), Claude test also through the server and the forwarding, click and screenshot tests through the embedded server (`scripts/harness.cjs`), container checked locally (OCR of a scan and the inbox folder under Linux) | done |
| Offen | Checks on the real Synology (checklist in ANLEITUNG-NAS.md); pain.001/pain.008 schemas for the click test | open |

## Version 0.11 – updates, traffic light, working together

From the pick of 28.10.2026 („Paket 1 – ich will nichts bezahlen; Paket 2 so ok; Paket 3 so ok“).

| Area | Contents | Status |
|------|----------|--------|
| Updates | GitHub Action „Bauen“: tests on every push, image `latest` from master only when green; a tag vX.Y.Z builds image X.Y.Z / X.Y / `stable` and a release with the Mac app (+ SHA-256); compose uses `stable`, nightly update by the DSM task scheduler; the server tells about a newer version; the Mac app updates itself from the release without a paid certificate (checksum, signature, swap after quitting; `scripts/updatetest.sh`); an app too old for the server says so | done |
| Ampel | Traffic light in the header (green connected and up to date, yellow working/reconnecting/reading documents, red no connection, grey local) with details; sign of life from the server every 15 s | done |
| Zusammenarbeit | Conflict protection when two users edit the same record (409 with name; overwrite on purpose or see the new state); cases assigned to a user, „Meine Aufgaben“ in the cockpit | done |
| Status | Status page: version/update, automatic backup, monthly restore test, space, text recognition, signed-in devices with log-out; cockpit warnings about backups | done |
| E-Mail | Sending mails via SMTP with archive documents attached; every mail sent filed as .eml in the archive | done |
| Mitteilungen | Web Push (browser, iPhone/iPad home-screen app; manifest, service worker, icons) and macOS notifications in the app: new documents, assigned cases, morning overview, backup problems | done |
| Passkeys | Login with Touch ID / Face ID / security key (WebAuthn), password stays | done |
| Offen | FinTS (automatic bank statements) – own plan; checks on the real Synology and iPhone (checklist in ANLEITUNG-NAS.md) | open |

## Version 0.12 – invitations and a new face

| Area | Contents | Status |
|------|----------|--------|
| Einladen | Invite a person: user without password plus a one-time link (14 days) to set it; the same link resets a forgotten password. Package from the Mac app: zip with Mietshaus.app, personal guide (Tailscale, app, iPhone) and a „Mit Mietshaus verbinden“ link; `mietshaus://verbinden?adresse=…&einladung=…` connects the app after asking | done |
| Logo | House with a capybara in the door (resources/logo.svg); Mac icon, sidebar, login, browser tab, home screen (`scripts/icons.cjs`) | done |
| Ersteinrichtung | Field „Benutzername wählen“ with explanation | done |

### 0.12.1 – fixes

| Area | Contents | Status |
|------|----------|--------|
| Logo im Container | The image built the interface without `public/`: no logo, icons, manifest or service worker on the NAS (push did not work either). Dockerfile copies it and fails the build without them; a missing file is a 404 instead of the page | done |
| Hausnummer | Street and house number in two fields (objects, address book, manager), stored together as one line for letters and e-invoices | done |
| Browser | Letter/PDF tab blocked by Safari: a button opens it; failed page loads show why; object list says „lädt …“ while loading; shortcut hint per platform | done |

## Version 0.13 – calendar and a locked-down container

| Area | Contents | Status |
|------|----------|--------|
| PLZ | Postcode fills the place (objects, address book, manager); GeoNames DE, CC BY 4.0 (`scripts/plz.cjs` → `src/plz.json`, loaded on first use) | done |
| Kalender | Page Kalender (month grid, list on phones): appointments, deadlines, due cases (filter „nur meine“), project tasks, moves – db `kalender(von, bis)`. Cockpit „Nächste 14 Tage“ | done |
| Kalender-Abo | Secret link per user `/kalender/<token>.ics` (only the hash stored, new link stops the old one); no amounts, no tenant names | done |
| Änderungsinfo | „Zuletzt geändert von … am …“ in every edit dialog (`aenderungsNamen`) | done |
| Härtung | compose: read_only, tmpfs /tmp, cap_drop ALL, no-new-privileges, memory/pids limits; CI starts the image that way (`scripts/rauchtest.sh`: status, logo, user, receipt OCR) before publishing; Trivy scan in the summary; `npm audit` stops on high; Dependabot | done |

## Version 0.14 – photos, reading offline, server warnings

| Area | Contents | Status |
|------|----------|--------|
| Fotos | „Foto“ opens the phone's camera (`capture`), in every gallery, at a case (`dokumente.vorgang_id`, gallery in the case dialog) and in the handover | done |
| Beleg-Foto | „Beleg fotografieren“ (cockpit, inbox, invoices): upload, OCR, then the document dialog to book | done |
| Zählerfoto | `/api/zaehlerfoto`: photo filed with house/unit, digits read (black/white, two passes, digits only), candidates checked against the last reading (`electron/zaehlerfoto.cjs`); proposals as buttons, photo kept with the reading (`zaehlerstaende.dokument_id`) | done |
| Offline lesen | Server marks reading calls (`X-Lesend`); answers kept per user in IndexedDB (`src/offline.ts`), shown without a connection with a red bar; service worker keeps the page; cleared on logout or another user | done |
| Serverwarnungen | Push kind `server`: little space, no backup for two days, new version installed (once a day each) | done |
| Fix | Context writes were counted as changes: every read sent „aktualisiert“, so open windows made each other reload | done |

## Version 0.15 – fetching transactions from the bank (FinTS)

| Area | Contents | Status |
|------|----------|--------|
| FinTS | `electron/fints.cjs` with lib-fints 1.5.2 (LGPL, unchanged dependency): set up per object account (bank code, FinTS address, user id encrypted, TAN method, account by the object's IBAN), fetch statements with pushTAN or TAN; PIN never stored, held at most 10 minutes for the running process | done |
| Import | Transactions go through the same proposals as CAMT/MT940 files (`bankVorschlaege`), stable references so a second fetch recognises what is booked | done |
| Registrierung | Product number from the DK (free, `ANLEITUNG-FINTS.md`) in the bank dialog or `MIETSHAUS_FINTS_PRODUKT`; until then „Registrierung ausstehend“ | waiting for the number |
| Test | `scripts/fintstest.cjs` against a played bank (TAN method choice, pushTAN pending then approved, wrong PIN, account choice, duplicates) | done |

## Version 0.16 – invoices in detail, recycle bin

| Area | Contents | Status |
|------|----------|--------|
| Rechnungssteller | `electron/belege.cjs: stellerErkennen` reads letterhead and imprint (name with legal form, address, phone, e-mail, web, VAT id, tax number, register, managing director, bank, IBAN, BIC); own addresses (manager, objects, tenants) excluded; e-invoices exact; contact found by VAT id/IBAN/e-mail/name or created from the sender (`kontaktAusSteller`); contacts carry `ust_id`, `steuernr`, `web` | done |
| MwSt | `steuerErkennen`: rates with net and VAT from „zzgl./inkl./enthaltene MwSt“, VAT tables and several rates; 0 % for § 19 UStG and tax-free; only kept when it adds up to the gross amount, else empty | done |
| Positionen | `positionenErkennen`: items between table head and sums with quantity, unit, amount and kind (labour, travel, material); labour share gross for § 35a (`lohnBerechnen`, only when the items add up); editable in the document form; in the full-text search | done |
| Buchen | `belegAufteilung` / `belegBuchen` (app and Claude): input tax per rate and deductible share, never guessed without known VAT; labour share on the posting (`buchungen.p35a_ct`, carried into reversals) | done |
| § 35a | Statements count the labour share of postings that have one, the full amount of the others (as before), with a check hint | done |
| Papierkorb | Deleting puts documents in a recycle bin (status `papierkorb`, 30 days, then removed with file and previews); delete icon per inbox row, batch delete, „Duplikat löschen“; the same file uploaded again comes back; Claude tool `dokument_loeschen` (not for booked documents) | done |
| Claude | `dokument_ablegen` takes sender, VAT, items and labour share; instructions ask to complete them from the page image | done |
| 0.16.1 Firmenname | Name cut after the legal form and at imprint words (Sitz, Registergericht, Tel. …); order: sender line above the window, letterhead with legal form, largest writing at the top (OCR line heights), imprint, first line; checked against the e-mail/web domain, else marked „unsicher“; learnt from the matching contact or the newest filed document with the same VAT id/IBAN/e-mail | done |
| 0.16.2 Kontakte & Duplikate | Filing or booking an invoice makes its sender a contact (found first by VAT id, IBAN, e-mail or name without legal form – never twice); the same invoice twice (same number, amount, date if known, sender by name/contact/VAT id) is marked in the inbox and refused when filing, batch filing, drag & drop and booking (app and Claude) once a copy is filed or booked | done |

## Version 0.17 – work basket, tasks, bell, faster on every device

| Area | Contents | Status |
|------|----------|--------|
| Architektur | Pages load on first use (`React.lazy`, main bundle 846 → 385 kB, frequent pages preloaded); `useLoad` on a TanStack Query cache (instant on revisit, refreshed in the background, cleared on sign-out) | done |
| Bausteine | Radix dialogs for every window (`Fenster` in `ui.tsx`: focus kept, Escape, stacked windows), Radix popover for the bell; Lucide symbols instead of emoji (`icons.ts`); `Tabelle.tsx` with TanStack Table + Virtual (sorting, quick filter, arrow keys, virtual from 200 rows) for the journal and all simple lists | done |
| Arbeitskorb | `Arbeitskorb.tsx`: queue left, work right, J/K, the next item opens after filing/booking; phone: list ↔ item; inbox rebuilt on it („Ablegen und weiter“) | done |
| Aufgaben | New page across all houses: board (drag, status menu on phones) and work basket; filters mine/house/person/due; comments and status history with names; assignments logged; daily reminder (due tomorrow/overdue) | done |
| Glocke | `mitteilungen` table per user, every notification also kept there; bell with unread count, mark read, jump to target; new kinds `faellig`, `kommentar` | done |
| Fotos | Photos uploaded at a house/unit/case/project are filed at once as „Foto“; EXIF time → date and title; house location saved on the spot, phone camera button files at the house within 150 m, else inbox | done |
| Wiederkehrende Rechnungen | `rechnungWieBisher` (sender booked ≥ 2× alike) → „So buchen und weiter“; „n bekannte Rechnungen buchen“ in the inbox | done |
| Fehlersperren | Server questions (409 + `bestaetigen`, resent with `X-Bestaetigt`): posting date > 400 days back / > 60 days ahead, tenant account outside the lease, lower meter reading, IBAN change, invoice > 5× the sender's maximum | done |
| Handy | Bottom bar (Postfach, Aufgaben, camera, bell, more), 42 px touch targets, tablet sidebar narrower | done |

## Version 0.18 – liquid glass and cel-shaded symbols

| Area | Contents | Status |
|------|----------|--------|
| Symbole | 50 illustrated symbols in a cel-shading style (two tones per colour, ink outline, hatching in deep shadow, a hand-drawn wobble), drawn by `scripts/symbole/` into `public/symbole/`; `Bild` (`Symbol.tsx`) in the sidebar, mode buttons, phone bar, bell, cockpit tiles and empty lists; buttons, tables and toolbars keep the Lucide lines | done |
| Logo | The house with the capybara in the door redrawn in the same style (`scripts/symbole/logo.py` → `resources/logo.svg`; Mac, browser and home-screen icons from `scripts/icons.cjs`) | done |
| Glas | Floating parts as glass (sidebar, top bar, phone bar, bell, menus, dialogs, cockpit tiles, board columns) over soft fields in the mode colour; tables, forms and fields stay almost solid; blur only on a few large surfaces | done |
| Darstellung | Settings per device: glass automatic/on/off (automatic follows „Transparenz reduzieren“), symbols illustrated/plain (Lucide); browsers without blur get solid surfaces | done |
| Extras | „Alles erledigt“ with a large symbol for an empty inbox or task list; a short check when a task is done (off with „Bewegung reduzieren“); the bell in the phone bar with its label | done |
| Offline & Tests | Service worker keeps `/symbole/` (shown at once, refreshed in the background); server test, smoke test and image build check the symbols; the click test checks that every sidebar symbol loads, also with glass off and plain symbols | done |

## Version 0.19 – code review fixes, quicker data entry

| Area | Contents | Status |
|------|----------|--------|
| Abrechnungen | Cancelled advance payments no longer count; WEG special levies credited like advances; CO₂ landlord share also credited with heating mode „ohne“; budget plan distributes consumption keys by last year's use (MEA without readings) | done |
| Zahlen & Steuer | „8.000“ is eight thousand (German thousands separators); yield „before financing“ without interest; AfA ends when the building is written off | done |
| Fristen | Objection deadline (§ 574b) to the month end; statement deadline from the real period (e.g. 07–06, `nkFaellig`); calendar and subscription show every deadline; 15-month hint day-exact without modernisation; vacancy hint only for current self-use; mail archive date local; ICS with VTIMEZONE | done |
| Eingang & Dokumente | Inbox folder: a failing file is reported and skipped (no server crash), files must rest 4 s before import; file written before the record (atomic), a missing file is repaired by the next upload; uploads logged under the uploading user | done |
| Bank | Same transaction from CAMT and FinTS/MT940/CSV recognised („vermutlich schon gebucht“); CAMT batch bookings split per payer, own references for equal payments and returns; created SEPA files recorded (`sepa_dateien`), their items not preselected again | done |
| Bedienung | Save and book buttons locked while saving; honest message when the connection breaks; houses clickable → profile (menu entry „Steckbrief“ gone); logo top left (Mac after the window buttons, phone in the top bar); searchable lists in forms (type to filter); tenants/owners created from the contract form („+ Neuer Mieter“), contract for any house with its units; a new unit asks „vermietet / Eigennutzung“ and opens the form; more names, units and accounts are links | done |

## Version 0.20 – duties of a house, inventory, workflows

| Area | Contents | Status |
|------|----------|--------|
| Fehler | Cockpit house tiles: the status chips („keine Rückstände“, „1 leer“, „2 selbst genutzt“) were drawn as round 28 px buttons, because the top bar's status light used the same class (`.ampel`); chips now `.zustand`, no line breaks; „1 Einheit“ instead of „1 Einheiten“ | done |
| Titelbild | Without a chosen title photo only real photos of the house are used (no scanned receipts, no meter photos), otherwise the house symbol | done |
| Objektwahl | The house picker in the top bar is searchable (type to filter, arrows and Enter); on the phone search and picker share the bar | done |
| Doppelt speichern | Every call carries a key (`X-Vorgang`); after a broken connection the page sends it again by itself (1, 2, 4 s) and also when the user saves the very same thing again within 10 minutes; the server does a change only once per key and user (answers kept 15 minutes, reads not kept) | done |
| Pflichten am Haus | Duties per house (`pflichten`, `pflicht_erledigt`, `electron/pflichten.cjs`): nothing active by itself – picked from a catalogue with ticks (smoke detectors, boiler, legionella, chimney sweep, trees, winter service, gutters, backflow, lift, extinguishers, playground, E-Check, gas pipes, energy certificate) with interval, next date, firm, cost type; a case is opened `vorlauf_tage` ahead (automation, once per duty); „Erledigt“ keeps date, proof and note and moves the next date on (day-exact months; by notice for the chimney sweep); paused duties make no cases or deadlines; deadlines, calendar and subscription; cockpit panel; the board and the case view complete a duty's case through the duty; the firm's invoice suggests the duty's cost type | done |
| Inventar | Items per house and unit (`inventar`, `electron/inventar.cjs`): purchase, price, warranty, invoice, photo, disposal; page „Inventar“ and a tab in the unit file; warranty end in the deadlines and at a case of the unit; Anlage V: write-off of movable assets (kitchen 10 years, monthly in the purchase year, GWG up to 800 € net at once, self-used unit not deductible, sold: AfA up to the month, scrapped: remaining value); purchases booked on the new account 45500 „Anschaffungen“ are not deducted at once, with a hint when the inventory is missing; fixed building services are listed without write-off (maintenance) | done |
| Abläufe | Workflow templates (`ablaeufe`, `electron/ablaeufe.cjs`): tenant change, damage, service-charge statement, new letting (editable, own ones: one step per line „-30 Vorabnahme“); started from a key date they become a case with sub-cases (`vorgaenge.eltern_id`), past steps due today; board shows „3/7“ and the origin of a step, the last step offers to close the workflow; the case view ticks the steps; a recorded notice offers the tenant change | done |
| Fachprüfung | Catalogue and write-off checked against BetrKV, TrinkwV, GEG, EStG/EStR/LStR (E-Check chargeable, legionella details, disposal rules, building services) | done |


## Version 0.21 – inspection, voice notes, image search, working offline (one update, released as 0.21.1)

From the wish of 05.11.2026 („das muss gebaut werden, das ist wichtig, nicht dass Daten verloren gehen … zusammengefasst, damit ich nur einmal den Server updaten muss“): the planned 0.21 and 0.22 and offline work in one release.

| Area | Contents | Status |
|------|----------|--------|
| Begehung | Inspection on the phone (`begehungen`, `electron/begehung.cjs`, page „Begehungen“): areas (stairwell, cellar, boiler room, roof, facade, outdoor, bins, letterboxes, the units) with state, notes, photos; „Mangel melden“ makes a case with the chosen photos (or a whole damage workflow); due duties are check points in their area („Erledigt …“); saved a moment after each change; completed as a PDF protocol | done |
| Sprachnotizen | Speaking instead of typing (Safari on iPhone and Mac; asked once per device, the system's recognition processes the speech): „Sprachnotiz“ on the board fills a new task – person, unit (by name, number or the tenant's), house, urgency, due date („morgen“, „in drei Tagen“, „Freitag“) are recognised locally (`electron/diktat.cjs`) and shown to check; notes and defects in the inspection can be spoken | done |
| Bildsuche | Local image search (`electron/bildsuche.cjs`): switched on in the settings, the image half of CLIP (89 MB, pinned revision and checksum) is loaded once into the data folder; photos get German keywords from a vocabulary of 93 terms (`scripts/bildsuche/`, `electron/bildwoerter.json`) in the background (3 every 15 s); the full-text search finds them; keywords shown at the document; the runtime `onnxruntime-node` (1.30.0; 1.22 failed the security audit through adm-zip) keeps only this system's build in the image (25–45 MB) and the Mac app | done |
| Offline | Working without a connection (`src/ausgang.ts`): changes and files are kept on the device (IndexedDB, never cleared at logout) and sent in their order when the connection is back; provisional numbers for new records are rewritten to the real ones; the server keeps the keys of done changes 60 days (`vorgangsschluessel`, also across restarts); a conflict (another user or the same user on another device changed it meanwhile) or an error stops the sending at that entry – decided in the traffic light (send anyway, or discard after asking); the page itself and all its parts are kept by the service worker, so the app also starts without a connection; inspection, duty proof and handover photos work offline with a preview from the device | done |
| Robustheit | A broken image no longer stops the server (OCR error handler); conflicts also between two devices of one user | done |


## Version 0.21.2 – CSS audit and accessibility of the phone screens

| Area | Contents | Status |
|------|----------|--------|
| CSS-Konflikte | `.zustand` was both the status chips (0.20) and the button group of handover/inspection – chips now `.statusmarke`; `.leer` was both the empty page (80 px top margin) and the empty row of the searchable lists („–“, „Nichts passt zu …“) – the page is now `.leerseite`; double base rules merged (`.ampel`, `.fehlertext`, `.kz-kopf`); unused rules removed (`dokliste`, `einheitenraster`, `einheitkarte`) | done |
| Farb-Tokens | `--auf-farbe`, `--auf-hell`, `--abzeichen`, `--ampel-*`, `--miete-text`, `--weg-text` instead of fixed colours | done |
| Kontrast (WCAG 2.1 AA) | white on the accent 4.46 → 5.05 (buttons, active menu item, mode button); rent/WEG chips 3.5/3.9 → 5.5/6.0; green marks 4.35 → 5.55; accent chips 4.2 → 4.9; red badges in dark mode 2.3 → 5.5; the light's count 1.9 (dark) → 7.2; tab counts and month labels in the readable grey | done |
| Tippflächen | touch screens: top-bar buttons and the light get a 44 px area, the status menu of board cards 36 px (was 21), small buttons 34 px, area names in the inspection 36 px | done |
| Geprüft ohne Befund | every button and field has a name for screen readers; visible keyboard focus everywhere (`:focus-visible`) | done |

Open: font sizes (22 values) and radii (18 values) could become a scale of tokens – a larger visual change, only on request.

## Version 0.22 – shopping

From the wish of 05.11.2026 („bei Projekten eine Kategorie Einkaufen … auch mit zu den anderen Aufgaben, ein Foto dort hinzufügen“).

| Area | Contents | Status |
|------|----------|--------|
| Einkaufsliste | Project page „Einkaufen“: quick entry („3 Sack Fliesenkleber“ splits the quantity off), shop (remembered), estimated price, step of the schedule it is for (due the day before); grouped by shop, sum of what is open; a photo per item (old part, label) with the camera; spoken entry | done |
| Bei den Aufgaben | Purchases are tasks of the category „Einkauf“ (`vorgaenge.menge/laden/preis_ct/projektaufgabe_id`): on the board with a cart, the project's name and the shop; filter „Einkaufen“ for the shop, sorted by shop; also for a house without a project („6 Stk Rauchmelder“); the task form asks for quantity, shop and price with this category; offline like every other change | done |
| Gekauft | Ticking off (list or board) asks for the price paid and a photo of the receipt – it becomes a paid invoice of the project under „Kosten & Budget“ | done |
| Zeitplan | „Material fehlt noch für …“ when a step starts within three days and purchases for it are open, with a link to the list | done |

## Version 0.23 – tasks and shopping redone

From the wish of 05.11.2026 („die Aufgaben- und Einkaufsseiten … sehr unintuitiv“, „die Informationen, die eingegeben werden können, nicht richtig angeordnet“). Distilled from Todoist, Things 3, Microsoft To Do, Linear, Bring!, AnyList, Apple Erinnerungen and work-order tools (MaintainX, Redlist, Latchel).

| Area | Contents | Status |
|------|----------|--------|
| Liste nach Fälligkeit | Default view: Überfällig, Heute, Nächste 7 Tage, Später, Ohne Datum; a round tick per row (done at once, „Rückgängig“ for 8 s); on a phone swipe right = done, left = later (tomorrow, next week); steps without their own date only inside their task | done |
| Ansichten statt Filter | Meine · Alle · Wartet · Einkaufen · Erledigt with counts; house and person behind one „Filter“, shown as removable chips and kept for the next visit; the board stays as a second view (on a phone one column at a time with tabs, no status menu on the cards) | done |
| Schnellfeld | One line, typed or spoken: „Wasserhahn Meier morgen dringend“ – house, flat (also through the tenant), person, date and urgency are shown before Enter saves (the dictation parser); without a connection the text is saved as it is; templates, workflows and the full form in the „Neu“ menu | done |
| Aufgabenblatt | One sheet to look at and to change (no separate edit form), saved at once: kind and status on top, title, details, steps (now also by hand), photos as a strip with camera and paperclip, history like a chat with the input at the bottom; where/who/when on the right (Wo: house › flat, Betrifft, Kümmert sich, Bis wann with Heute/Morgen/Nächste Woche, Wichtigkeit später/normal/dringend, Projekt); a new task shows only what is mostly needed, the rest on „+ …“; beside the list on a wide screen, full screen on a phone; also for the cases of a house | done |
| Einkaufen | One field „Was brauchst du?“ (a known article gets its shop), „Schon mal gekauft“ to add with a tap, the list by shop; ticking off only puts an article in the cart (`vorgaenge.im_wagen`); per shop „Bezahlt: Kassenbon erfassen“ – the prices, one total, one photo: one paid invoice per project, a receipt with articles of several projects (or none) shared by the prices; only typed amounts are booked; the same list across all projects under Aufgaben → Einkaufen; an article opens as the task sheet with quantity, shop, price („zuletzt …“), step and photo | done |

## Version 0.24 – private finances

From the wish of 10.11.2026: a fourth mode „Finanzen“ beside Miete, WEG and Projekte; every user keeps their own finances; movements go to and come from the other areas. An own design after what personal finance programs publicly do (accounts, categories, budgets, rules, standing orders, evaluations, forecast) – no code or internal structures of another program were taken over.

| Area | Contents | Status |
|------|----------|--------|
| Je Benutzer | Tables `fin_*` carry the user (`benutzer`, 0 in local mode); they are not in `TABLES`, only the `fin…` functions reach them, and the server puts the signed-in user in front of their arguments (`electron/finanzen.cjs`, `server/server.cjs`). Server and calculation tests: another user neither sees nor changes anything. The server's administrator (database file, backups) can technically read everything | done |
| Konten, Buchungen | Accounts (giro, savings, cash, card, depot, loan) with opening balance; income, expense, transfer between own accounts (two linked rows); bank statement import (CAMT, MT940, CSV) once per reference; search and filters; several movements categorised at once | done |
| Kategorien, Regeln | Starting categories per user (fixed costs, tax tags); rules „text in payee or purpose → category“, learnt when a payee is categorised, applied on import and afterwards | done |
| Budgets | Monthly budget per expense category with spent/left | done |
| Verträge & Daueraufträge | Rhythm, next payment, cancellable until; „Buchen“ enters the payment and moves the date on; regular payments are recognised from the history; fixed costs per month and year | done |
| Übersicht, Auswertung | Net worth with twelve months back, this month with savings rate, due in 30 days, budgets, uncategorised; evaluation by category, month and payee, fixed against variable, sums of the tax tags; forecast of the balance from the standing orders | done |
| Zwischen den Bereichen | A private expense → paid invoice of a project; a private payment → the house's ledger against its account „Privat (Einlagen und Entnahmen)“ (created when first needed); the other way: payments over a house's bank accounts and project invoices are taken into a private account – each only once per user | done |
| Splitbuchungen | One movement, several categories (`fin_buchungen.split_von`): the balance counts the movement once, evaluations and budgets count its parts; the parts must add up; found by a part's category | done |
| Unterkategorien | Two levels (`eltern_id`); evaluations gather them under the main category, budgets may include them | done |
| Budgets vertieft | Per month, quarter or year; with sub-categories; with the forecast (standing orders still due in the period); „schneller als geplant“ when spending runs ahead of the days gone | done |
| Verträge vertieft | Contract kind, numbers, term, automatic renewal and notice period: the last day for the notice is computed and rolls on when a term renewed; notice given ends the payments with the term; varying amounts are asked for when booking; history and yearly sum of a contract | done |
| Regeln vertieft | Conditions: search in payee, purpose or both, account, amount range; priority; a rule may set a label too | done |
| Kontoauszug vertieft | Imported movements are „neu“ until looked at; an expected („vorgemerkt“) movement of the same amount within a week is confirmed instead of doubled; a transfer that appears on two own accounts is offered to be linked; labels (Kennzeichen) | done |
| Abgleich, Grenzen | The bank's balance on a day against the own movements (difference shown, optional correction booking); overdraft limit and minimum balance with warnings | done |
| Depot, Kredite, Prognose | Securities in a depot account with purchase cost, price and price history (value counts into net worth); repayment plan of a loan account with remaining debt at the end of the fixed-interest period and the saving of an extra repayment; each account over the next 90 days with its lowest point | done |
| Vergleich | Expenses of a period against the same period a year before, by main category | done |
| Offen | Bank access (FinTS) for private accounts, live prices, tax estimate, import of exports from other programs (QIF), documents at a movement | open |

How the depth was found: the installer of a personal finance program the user owns was unpacked and its shipped .NET metadata read (module names and the entity model's table and column names) to learn which concepts such a program covers. Nothing was executed, and no code, text or schema was copied; tables, names and logic here are our own.

## Development

```
npm ci && node node_modules/electron/install.js   # Electron's own download is skipped by npm's install-script guard
npm run dev        # Vite + Electron with hot reload
npm test           # type check, calculation, backup, Claude/undo and server tests
MIETSHAUS_DATEN=/tmp/mh PORT=8080 ELECTRON_RUN_AS_NODE=1 npx electron server/server.cjs   # server without container
docker build -t mietshaus . && docker compose up   # container (see compose.yaml, ANLEITUNG-NAS.md)
npm run test:klick # click test (XSD=<folder with pain.*.xsd> for the SEPA schema check)
npm run dist:mac   # Apple Silicon app (zip) in release/; on a Mac signed with codesign (MIETSHAUS_SIGNATUR=<certificate>), on Linux ad hoc with rcodesign
```
