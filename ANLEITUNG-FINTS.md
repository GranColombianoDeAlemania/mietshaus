# Kontoabruf per FinTS – Produktnummer beantragen

Mietshaus kann die Umsätze eines Objektkontos direkt bei der Bank abholen (FinTS 3.0 mit PIN/TAN, Freigabe z. B. per
pushTAN). Banken beantworten aber nur Programme, die bei der **Deutschen Kreditwirtschaft (DK)** registriert sind.
Diese Registrierung ist kostenlos; sie ist an den Betreiber gebunden und gehört deshalb nicht ins Repository, sondern
wird in deiner Installation eingetragen.

## 1. Antrag stellen
1. Auf **fints.org** die Seite **Hersteller → Produktregistrierung** öffnen
   (<https://www.fints.org/de/hersteller/produktregistrierung>).
2. Das Formular ausfüllen. Als Produkt angeben:
   - Produktname: **Mietshaus**
   - Version: die aktuelle Hauptversion (z. B. **0.15**; Mietshaus schickt der Bank immer nur „Hauptversion.Nebenversion“)
   - Verwendung: Abruf von Kontoumsätzen und Salden für die eigene Hausverwaltung, keine Zahlungsaufträge
3. Absenden. Die Bearbeitung dauert erfahrungsgemäß **zwei bis drei Wochen**; die Produktnummer (Registrierungsnummer)
   kommt per E-Mail.

## 2. Nummer eintragen
In Mietshaus: **Buchhaltung → Bank & SEPA → Bankzugang einrichten…** – solange keine Nummer hinterlegt ist, steht dort
„Registrierung ausstehend“ mit einem Feld für die Nummer. Sie gilt für alle Objekte.

Alternativ auf dem Server als Umgebungsvariable in `compose.yaml`:
```yaml
    environment:
      MIETSHAUS_FINTS_PRODUKT: "<deine Nummer>"
```

## 3. Bankzugang je Objektkonto einrichten
1. **Bank & SEPA → Bankzugang einrichten…**: Bankleitzahl, FinTS-Adresse der Bank, Anmeldename (Kennung) und PIN des
   Online-Bankings. Die FinTS-Adresse steht meist auf der Website der Bank (Stichwort „FinTS“ oder „HBCI PIN/TAN“,
   „Online-Banking mit Finanzsoftware“).
2. TAN-Verfahren wählen (z. B. pushTAN) und in der Banking-App freigeben.
3. Mietshaus wählt das Konto mit der IBAN des Objekts; gibt es keins, fragt es nach.

## 4. Umsätze holen
**Bank & SEPA → Von der Bank holen…**: PIN eingeben, freigeben – die Umsätze erscheinen wie bei einer importierten
Kontoauszugsdatei mit Zuordnungsvorschlägen. Bereits gebuchte Umsätze werden erkannt.

## Was gespeichert wird
- **Gespeichert:** Bankleitzahl, FinTS-Adresse, TAN-Verfahren, IBAN und die Parameter der Bank; der Anmeldename
  verschlüsselt (Schlüsseldatei auf dem Server bzw. Schlüsselbund des Macs).
- **Nie gespeichert:** die PIN. Sie wird bei jedem Abruf abgefragt, nur für diesen Vorgang im Speicher gehalten
  (höchstens 10 Minuten) und direkt an die Bank geschickt.
- Mietshaus ruft nur Umsätze ab; Überweisungen oder Lastschriften schickt es nicht an die Bank.
