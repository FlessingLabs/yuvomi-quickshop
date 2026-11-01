# Changelog

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
