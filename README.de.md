# FlessingLabs QuickShop 2

**Deutsch** · [English](README.md)

Ein Artikelkatalog für die Einkaufsliste von [Yuvomi](https://github.com/ulsklyc/yuvomi).

**Artikel einmal anlegen, beliebig oft auf die Einkaufsliste setzen.**

> **Version 2 braucht ein Yuvomi mit Modulspeicher** (`/api/v1/modules/:id/records`). Das ist derzeit nur die FlessingLabs-Testversion von Yuvomi (Branch [`feat/module-storage`](https://github.com/FlessingLabs/yuvomi/tree/feat/module-storage), Image `ghcr.io/flessinglabs/yuvomi:module-storage-test`). Die Funktion ist dem Yuvomi-Maintainer vorgeschlagen ([Diskussion #2452](https://github.com/ulsklyc/yuvomi/discussions/2452)), aber **nicht** Teil des offiziellen Yuvomi.
>
> Auf einem unveränderten Yuvomi zeigt QuickShop 2 „Dieses Yuvomi hat keinen Modulspeicher“ und tut sonst nichts. Für ein unverändertes Yuvomi gibt es **QuickShop 1.1** (Branch `main`, Tag `v1.1.0`) mit eigenem Container.

QuickShop speichert, was ein Haushalt immer wieder kauft: Name, Standardanzahl und auf Wunsch einen Referenzpreis. Ein Tipp auf **+** setzt den Artikel auf die bestehende Yuvomi-Einkaufsliste. Keine Vorräte, kein Barcode, keine KI.

Kostenlos und Open Source (MIT) von FlessingLabs. **Bedienung für Haushaltsmitglieder:** [docs/ANLEITUNG.md](docs/ANLEITUNG.md)

## Funktionen

- Artikel anlegen, bearbeiten, löschen und suchen. Das Suchfeld ist zugleich das Anlegefeld.
- Ein Tipp auf **+** (oder Enter im Suchfeld) setzt den Artikel mit seiner Standardanzahl auf die Liste.
- Steht er schon drauf:
  - noch offen → die Menge wird erhöht;
  - abgehakt → er wird mit der Standardanzahl wieder geöffnet;
  - Freitextmenge („500 g“) → er bleibt unangetastet, du bekommst nur einen Hinweis.

  Jedes Hinzufügen lässt sich rückgängig machen.
- Der Katalog gehört dem ganzen Haushalt und liegt in Yuvomi selbst: in Yuvomis Datenbank und in Yuvomis Sicherung.
- Ändern zwei Personen denselben Artikel, wird die zweite Speicherung abgelehnt und die aktuelle Fassung angezeigt. Nichts wird still überschrieben.
- Deutsch und Englisch, große Tippflächen, keine Dialoge, Hell- und Dunkelmodus wie Yuvomi.

## So funktioniert es

QuickShop 2 ist reiner Browser-Code. Es spricht mit der Sitzung des Mitglieds nur Yuvomis eigene API an:

| Was | Yuvomi-API |
|---|---|
| Katalog | `/api/v1/modules/flessinglabs-quickshop/records` (Modulspeicher) |
| Einkaufsliste | `/api/v1/shopping/...` |
| Wer was darf | `/api/v1/auth/me` → Recht `ext:flessinglabs-quickshop` |

Kein zusätzlicher Container, kein Proxy, keine Anfrage außerhalb von `/api/v1`. Jeder Katalogartikel ist ein Datensatz `{ name, default_quantity, price_cents }` mit einer vom Server vergebenen UUID und einer Revision.

## Installation

1. Yuvomi mit dem Image `ghcr.io/flessinglabs/yuvomi:module-storage-test` betreiben. Für Unraid: **[docs/UNRAID-TEST.de.md](docs/UNRAID-TEST.de.md)**. Die Anleitung beginnt mit einer getrennten Testkopie und beschreibt Sicherung und Rückweg.
2. Das Modul installieren, auf einem von zwei Wegen:
   - über Einstellungen → Module → Eigenes Modul hinzufügen (braucht `MODULES_ALLOW_WEB_INSTALL=true`), mit der Adresse
     `https://github.com/FlessingLabs/yuvomi-quickshop/tree/feat/core-storage/module`
   - oder von Hand: den Ordner `module` als `flessinglabs-quickshop` in Yuvomis Modulordner kopieren.
3. QuickShop unter Einstellungen → Module einschalten. Unter Einstellungen → Haushalt → Rollen & Berechtigungen festlegen, wer den Katalog lesen oder bearbeiten darf.

## Umstieg von QuickShop 1.x

QuickShop 2 liest oder löscht die Datenbank des alten Dienstes nie von selbst. So kommt ein vorhandener Katalog mit:

1. Exportieren. Das geschieht nur lesend, die alte Datenbank bleibt unverändert:
   ```sh
   node tools/export-sidecar-db.mjs /mnt/user/appdata/flessinglabs-quickshop/quickshop.db > quickshop-export.json
   ```
   Alternativ, solange 1.x noch läuft: `http://<server>:8088/api/extensions/flessinglabs-quickshop/items` im angemeldeten Browser als Datei speichern.
2. In QuickShop 2 ganz unten **Katalog importieren** öffnen und die Datei wählen. Artikel, deren Name schon im Katalog steht, werden übersprungen und nicht verändert.
3. Ist alles da, kann der alte Container weg. Sein Datenordner bleibt, bis du ihn selbst löschst.

## Entwicklung und Tests

```sh
npm test                                   # Katalogspeicher, Einkaufslisten-Logik, Preise, Import
node tools/e2e/e2e-core-storage.mjs setup --base http://127.0.0.1:3000     # gegen ein laufendes Yuvomi mit Modulspeicher
node tools/e2e/e2e-core-storage.mjs persist --base http://127.0.0.1:3000   # nach einem Neustart
node tools/e2e/e2e-core-storage.mjs readonly --base http://<server>:<port> # nur lesende Prüfung einer laufenden Installation
```

## Verwandt

Die Kassenbon-Erkennung wird ein eigenes Modul, **FlessingLabs ReceiptScan**. QuickShop hängt weder davon noch von KI ab.

## Lizenz

MIT, © 2026 FlessingLabs.
