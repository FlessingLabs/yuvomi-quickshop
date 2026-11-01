# Changelog

## 2.0.1

- Anzeigename zu **Einkaufszettel** geändert; technische Modul-ID und vorhandene Daten bleiben erhalten.
- Sichtbarer Button **Zur Einkaufsliste** im Seitenkopf öffnet `/shopping` auf derselben Yuvomi-Installation.

## 2.0.0 – unveröffentlicht (Branch `feat/core-storage`)

**Braucht Yuvomi mit Modulspeicher** (`/api/v1/modules/:id/records`, FlessingLabs-Fork, Branch `feat/module-storage`). Kein reguläres Update für unverändertes Yuvomi – dafür bleibt 1.1 auf `main`.

- Der Katalog liegt im Yuvomi-Modulspeicher statt in einem eigenen Dienst. Kein Container, kein Proxy, keine Anfrage außerhalb von `/api/v1`.
- Katalog-IDs sind UUIDs; Änderungen tragen eine Revision. Konflikte zweier Geräte werden angezeigt statt überschrieben.
- Rechte kommen aus `ext:flessinglabs-quickshop` (`/auth/me`).
- Verständliche Meldungen: Yuvomi ohne Modulspeicher, Modul ausgeschaltet, kein Zugriff, Katalog voll.
- Ausdrücklicher Import aus einer JSON-Datei; `tools/export-sidecar-db.mjs` exportiert einen 1.x-Katalog nur lesend.
- Entfernt: `sidecar/`, `deploy/`, Image-Workflow (bleiben in 1.1 auf `main`).

## 1.1.0 – 2026-11-01

- **Ein Container statt zwei:** Der QuickShop-Dienst reicht jetzt alles außerhalb seines Pfads selbst an Yuvomi durch. Caddy entfällt. Abschalten mit `PROXY_YUVOMI=false` für Installationen mit eigenem Reverse-Proxy.
- **Unraid-Template** (`deploy/unraid/`) und fertiges Image `ghcr.io/flessinglabs/yuvomi-quickshop` (amd64, arm64), gebaut per GitHub Actions.
- Das Image übergibt das Datenverzeichnis beim Start an den `node`-User (wie Yuvomi), damit Unraid-`appdata`-Pfade beschreibbar sind.

## 1.0.0 – 2026-11-01

Erste Version.

- Artikelkatalog: anlegen, bearbeiten, löschen (mit Rückgängig), suchen. Name, Standardanzahl, optionaler Preis in Euro.
- Ein Tipp setzt einen Artikel mit seiner Standardanzahl auf die Yuvomi-Einkaufsliste. Bereits vorhandene Positionen werden erkannt (Menge erhöhen, abgehakte wieder öffnen, Freitextmengen unangetastet lassen); jede Aktion ist zurücknehmbar.
- Eigener Katalogdienst (Sidecar, SQLite) unter `/api/extensions/flessinglabs-quickshop`, Rechte über `ext:flessinglabs-quickshop`.
- Deutsch und Englisch.
