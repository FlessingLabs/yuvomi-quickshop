# Changelog

## 1.0.0 – 2026-11-01

Erste Version.

- Artikelkatalog: anlegen, bearbeiten, löschen (mit Rückgängig), suchen. Name, Standardanzahl, optionaler Preis in Euro.
- Ein Tipp setzt einen Artikel mit seiner Standardanzahl auf die Yuvomi-Einkaufsliste. Bereits vorhandene Positionen werden erkannt (Menge erhöhen, abgehakte wieder öffnen, Freitextmengen unangetastet lassen); jede Aktion ist zurücknehmbar.
- Eigener Katalogdienst (Sidecar, SQLite) unter `/api/extensions/flessinglabs-quickshop`, Rechte über `ext:flessinglabs-quickshop`.
- Deutsch und Englisch.
