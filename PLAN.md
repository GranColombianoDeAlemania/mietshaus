# Hausverwalter – Roadmap

A personal Mac app with Win-CASA's range of features. It uses its own code and its own data model.
Win-CASA (template database `../db/schema.sql`, form inventory `../forms_own.txt`) is used only
to learn which features, fields and calculations exist.

Two modes, kept separate but linked:
- **Mietverwaltung** – blue background
- **WEG-Verwaltung** – green background
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
| 8 | Miete extras | Deposit incl. interest, indexed and stepped rent, rent increase, keys, insurance | open |
| 9 | WEG extras | Meetings, votes, resolution register, advisory board, sub-communities | open |
| 10 | Dokumente | Letter/mail-merge templates, PDF output, document archive, lists/reports | open |
| 11 | CRM | Cases, tasks, appointments, calls, e-mail archive | open |
| 12 | Export & System | DATEV export, CSV/Excel, backup, users/rights | open |
| 13 | Optional | Online banking (FinTS), portal, AI assistant, scanning | open |

## Development

```
cd ~/Work/wincasa/app
npm run dev        # Vite + Electron with hot reload (Linux)
npm run dist:mac   # packages an Apple Silicon app (zip) in release/
```
