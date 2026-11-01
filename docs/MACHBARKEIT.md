# Machbarkeitsbericht QuickShop

Stand: 2026-11-01. Grundlage: Yuvomi `main` @ `f7dbd29` (MODULES.md, docs/SCOPE.md, `server/routes/shopping.js`, `pantry.js`, `preferences.js`, `modules.js`, `auth.js`).

## Nachgewiesen (im Yuvomi-Code geprüft)

| Frage | Befund |
|---|---|
| Gibt es einen Artikelkatalog? | Nein. `GET /api/v1/shopping/suggestions?q=` ist nur eine Autovervollständigung aus dem Verlauf (Präfix, max. 8 Treffer, nicht pflegbar, kein Preis). Vorratsprodukte (`pantry_products`) hängen am Bestand, also an der Vorratsverwaltung, die für v1.0 ausgeschlossen ist. Einen von Hand gepflegten Produktkatalog im Kern hat Upstream bewusst abgelehnt (#714, docs/SCOPE.md). |
| Navigation | Über `module.json` (`menu`, `page.composition`, `accent`, `locales/*.json`). Route `/m/<id>`. |
| Einkaufslisten-API | `GET /shopping` (mit `accepts_new_items`), `GET /shopping/:listId/items`, `POST /shopping/:listId/items` (`name`, `quantity` als Freitext, `category`), `PATCH /shopping/items/:id`, `DELETE /shopping/items/:id`. |
| Direkt hinzufügen? | Ja, über die offizielle API mit der Session des Mitglieds. |
| Doppel-Erkennung | Nicht serverseitig: `POST` legt immer neu an. QuickShop liest deshalb zuerst die Liste. |
| Moduldaten speichern | Module sind reiner Browser-Code ohne Datenspeicher; `/preferences` nimmt nur feste Felder. Der dokumentierte Weg ist ein Sidecar unter `/api/extensions/<id>` mit eigener Datenbank. Yuvomi leitet diesen Pfad nicht selbst weiter; ein Reverse-Proxy ist nötig. |
| Berechtigungen | `shopping: write` (prüft Yuvomi) und `ext:flessinglabs-quickshop` (`none`/`read`/`write`, prüft der Sidecar über `GET /api/v1/auth/me`). |

## Entscheidungen (mit FlessingLabs abgestimmt)

- Sidecar mit eigener SQLite-Datei, keine Kernänderung.
- Da vor der Ziel-Installation kein Proxy steht, liefert QuickShop einen Caddy mit.

## Designannahmen

- Kategorie beim Hinzufügen: die letzte Kategorie dieses exakten Namens aus `suggestions`, sonst Yuvomis Standard.
- Der Katalogpreis wird nicht in `price_cents` der Position geschrieben; Yuvomi versteht dieses Feld als tatsächlich gezahlten Preis beim Abhaken.
- Vorhandene Position: offen + Zahl → addieren; abgehakt → wieder öffnen mit Standardanzahl; Freitextmenge → unverändert, nur Hinweis.
- Der Katalog gehört dem Haushalt (wie die Einkaufsliste), Artikelnamen sind eindeutig (Groß-/Kleinschreibung egal).

## Bekannte Grenzen

- API-Tokens (Bearer) werden vom Sidecar in v1.0 nicht angenommen, nur Browser-Sessions.
- Ein Upstream-Vorschlag für einen allgemeinen Modul-Datenspeicher würde den Sidecar überflüssig machen; er ist nicht Teil von v1.0.
