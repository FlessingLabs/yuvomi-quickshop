# FlessingLabs QuickShop

**Deutsch** · [English](README.md)

Ein Artikelkatalog für die Einkaufsliste von [Yuvomi](https://github.com/ulsklyc/yuvomi).

**Artikel einmal anlegen, beliebig oft auf die Einkaufsliste setzen.**

QuickShop speichert die Dinge, die ein Haushalt immer wieder kauft: Name, Standardanzahl und auf Wunsch einen Preis. Ein Tipp auf **+** setzt den Artikel auf die bestehende Yuvomi-Einkaufsliste. Mehr nicht: keine Vorräte, kein Barcode, keine KI.

Kostenlos und Open Source (MIT) von FlessingLabs.

**Bedienung für Haushaltsmitglieder:** [docs/ANLEITUNG.md](docs/ANLEITUNG.md)

## Funktionen

- Artikel anlegen, bearbeiten, löschen und suchen. Das Suchfeld ist zugleich das Anlegefeld.
- Ein Tipp auf **+** (oder Enter im Suchfeld) setzt den Artikel mit seiner Standardanzahl auf die Liste.
- Steht der Artikel schon drauf, entsteht keine zweite Zeile:
  - noch offen → die Anzahl wird erhöht (aus 1 wird mit Standardanzahl 2 eine 3);
  - schon abgehakt → er wird wieder geöffnet, mit der Standardanzahl;
  - Menge als Freitext („500 g“) → nichts wird verändert, nur ein Hinweis erscheint.
- Hinzufügen und Löschen lassen sich im Hinweis unten **rückgängig** machen.
- Bei mehreren Einkaufslisten wählt man die Zielliste oben rechts. Das Gerät merkt sich die Wahl.
- Das Hinzufügen verändert den Katalogartikel nie.
- Große Tippflächen, ohne Dialoge, Hell- und Dunkelmodus wie Yuvomi.
- Deutsch und Englisch; weitere Sprachen über `module/locales/<sprache>.json`.

## Aufbau

```text
Browser ──► Caddy (:8088) ──┬─ /api/extensions/flessinglabs-quickshop/* ─► quickshop (Katalog, SQLite)
                            └─ alles andere ──────────────────────────────► yuvomi (unverändert)
```

| Teil | Ordner | Aufgabe |
|---|---|---|
| Modul | `module/` | Die Seite in Yuvomi. Kommt in Yuvomis `modules/`-Ordner. |
| Katalogdienst | `sidecar/` | Speichert den Katalog in einer eigenen SQLite-Datei. Node ohne npm-Abhängigkeiten. |
| Proxy | `deploy/` | Caddy, damit Yuvomi und der Katalogdienst unter **derselben Adresse** erreichbar sind. |

**Warum ein eigener Dienst?** Yuvomi-Module sind reiner Browser-Code und haben keinen Datenspeicher. Der von Yuvomi dokumentierte Weg für Moduldaten ist ein Dienst neben Yuvomi ([MODULES.md, „Modules With A Backend Service“](https://github.com/ulsklyc/yuvomi/blob/main/MODULES.md#modules-with-a-backend-service)). QuickShop öffnet nie `yuvomi.db` und ändert keine Zeile am Yuvomi-Kern. Die Einkaufsliste wird ausschließlich über Yuvomis offizielle API beschrieben. Details: [docs/MACHBARKEIT.md](docs/MACHBARKEIT.md).

## Voraussetzungen

- Yuvomi per Docker Compose, mit eingebundenem `modules/`-Ordner (Standard in Yuvomis `docker-compose.yml`).
- Docker mit Compose v2.
- Für Entwicklung und Tests: Node.js ab 22.13.

## Installation

Die Beispiele gehen von Yuvomis Standard-Compose aus: Projektordner `yuvomi`, Container `yuvomi`, Netzwerk `yuvomi_default`, Modulordner `./modules`.

### 1. Modul nach Yuvomi kopieren

```sh
git clone https://github.com/FlessingLabs/yuvomi-quickshop.git flessinglabs-quickshop
cp -r flessinglabs-quickshop/module /pfad/zu/yuvomi/modules/flessinglabs-quickshop
```

Der Ordnername muss `flessinglabs-quickshop` lauten. Yuvomi erkennt das Modul ohne Neustart. Ein von Hand kopiertes Modul ist sofort aktiv.

*Alternative:* Ist in Yuvomi `MODULES_ALLOW_WEB_INSTALL=true` gesetzt, geht das auch unter Einstellungen → Module → Eigenes Modul hinzufügen, mit der Adresse `https://github.com/FlessingLabs/yuvomi-quickshop/tree/main/module`. Das Modul muss danach freigeschaltet werden.

### 2. Katalogdienst und Proxy starten

Den Namen des Yuvomi-Netzwerks prüfen:

```sh
docker network ls | grep yuvomi        # erwartet: yuvomi_default
```

Heißt es anders, eine `.env` in `deploy/` anlegen mit `YUVOMI_NETWORK=<name>`. Dort lässt sich auch der Port ändern (`QUICKSHOP_HTTP_PORT`, Standard 8088).

```sh
cd flessinglabs-quickshop/deploy
docker compose up -d --build
docker compose ps                      # quickshop: healthy
```

### 3. Yuvomi auf den Proxy einstellen

In Yuvomis `.env`:

```sh
TRUST_PROXY=172.16.0.0/12
```

Damit liest Yuvomi die echte Adresse jedes Geräts aus dem Proxy. Ohne diese Zeile erscheinen alle Zugriffe als ein einziges Gerät, und Yuvomis Anmelde- und Anfragebegrenzung trifft den ganzen Haushalt gemeinsam. Danach Yuvomi neu starten: `docker compose up -d` im Yuvomi-Ordner.

**Ab jetzt Yuvomi über `http://<server>:8088` öffnen.** Das betrifft auch Lesezeichen und die installierte App. Über den alten Port 3000 läuft Yuvomi weiter, QuickShop meldet dort aber „Dienst nicht erreichbar“. Wer den alten Port schließen will, ändert in Yuvomis `docker-compose.yml` die Port-Zeile auf `127.0.0.1:${OIKOS_HTTP_PORT:-3000}:3000`.

**HTTPS mit eigener Domain:** In `deploy/Caddyfile` die Zeile `:80 {` durch den Hostnamen ersetzen (z. B. `einkauf.example.org {`), in `docker-compose.yml` die Ports 80 und 443 veröffentlichen und in Yuvomis `.env` `SESSION_SECURE=true` setzen. Caddy holt das Zertifikat selbst.

### 4. Prüfen

1. In Yuvomi erscheint links **QuickShop**.
2. Einen Namen ins Suchfeld tippen, **„… anlegen“** tippen, dann **+**: Der Artikel steht auf der Einkaufsliste.
3. Einstellungen → Module → Aktive Module: QuickShop ohne Fehler.
4. Einstellungen → Haushalt → Rollen & Berechtigungen: Der Eintrag **QuickShop** regelt, wer den Katalog sehen (`Lesen`) und pflegen (`Schreiben`) darf.

Ohne Docker lässt sich das auch per Kommandozeile prüfen:

```sh
curl http://<server>:8088/api/extensions/flessinglabs-quickshop/health   # {"data":{"ok":true}}
```

## Aktualisieren

```sh
cd flessinglabs-quickshop && git pull
rm -rf /pfad/zu/yuvomi/modules/flessinglabs-quickshop
cp -r module /pfad/zu/yuvomi/modules/flessinglabs-quickshop
cd deploy && docker compose up -d --build
```

Der Katalog liegt im Volume `quickshop-data` und bleibt bei Updates erhalten. Neue Datenbankversionen migrieren beim Start automatisch. Eine Datenbank aus einer neueren QuickShop-Version lehnt eine ältere ab, statt sie zu beschädigen.

## Sicherung

```sh
docker compose -f deploy/docker-compose.yml stop quickshop
docker run --rm -v deploy_quickshop-data:/data -v "$PWD":/backup alpine \
  cp /data/quickshop.db /backup/quickshop-$(date +%F).db
docker compose -f deploy/docker-compose.yml start quickshop
```

Der Volume-Name hängt vom Compose-Projekt ab (`docker volume ls | grep quickshop`). Yuvomis eigene Sicherung enthält den Katalog **nicht**.

## Entfernen

1. Einstellungen → Module → QuickShop ausschalten, oder den Ordner `modules/flessinglabs-quickshop` löschen.
2. `cd deploy && docker compose down` (mit `-v` wird auch der Katalog gelöscht).
3. Lesezeichen wieder auf Yuvomis Port, `TRUST_PROXY` zurücksetzen.

Die Einkaufsliste bleibt unberührt.

## Rechte und Sicherheit

- Der Katalogdienst glaubt dem Browser nichts. Wer jemand ist und was er darf, fragt er bei jeder Anfrage Yuvomi (`GET /api/v1/auth/me` mit dem Session-Cookie). Die Antwort wird 5 Sekunden zwischengespeichert.
- Schreibende Anfragen brauchen zusätzlich: passenden `Origin`, ein eigenes CSRF-Paar (Cookie und Header) und die Stufe `Schreiben` für QuickShop.
- Ist das Modul in Yuvomi ausgeschaltet, lehnt auch der Dienst jeden Zugriff ab.
- Auf die Einkaufsliste schreibt der Browser mit der Session des Mitglieds direkt bei Yuvomi. Yuvomis eigene Rechte für die Einkaufsliste gelten also unverändert.

## Konfiguration des Katalogdienstes

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `8080` | Port im Container |
| `DATA_DIR` | `/data` | Ordner für `quickshop.db` |
| `YUVOMI_URL` | `http://yuvomi:3000` | Interne Adresse von Yuvomi |
| `PUBLIC_ORIGIN` | leer | Erlaubte Origins, kommagetrennt. Leer = der Host, den der Browser aufgerufen hat |
| `YUVOMI_SESSION_COOKIE` | `yuvomi.sid` | Name von Yuvomis Session-Cookie |
| `AUTH_CACHE_MS` | `5000` | Zwischenspeicher für die Rechteprüfung |

## API des Katalogdienstes

Präfix: `/api/extensions/flessinglabs-quickshop`. Antworten: `{ data }`; Fehler: `{ error, code, reason }`.

| Methode | Pfad | Recht | Beschreibung |
|---|---|---|---|
| GET | `/health` | – | Lebenszeichen |
| GET | `/me` | Lesen | `{ user_id, access }` |
| GET | `/csrf` | Lesen | `{ token }` und setzt das CSRF-Cookie |
| GET | `/items?q=` | Lesen | Alle Artikel, alphabetisch; `q` filtert nach Teilwort |
| GET | `/items/:id` | Lesen | Ein Artikel |
| POST | `/items` | Schreiben | `{ name, default_quantity?, price_cents? }` → 201; 409 `item_exists` bei gleichem Namen |
| PATCH | `/items/:id` | Schreiben | Teiländerung; `price_cents: null` entfernt den Preis |
| DELETE | `/items/:id` | Schreiben | `{ id, deleted: true }` |

Artikel: `{ id, name, default_quantity (1–999), price_cents (Cent oder null), created_by, created_at, updated_at }`. Schreibende Aufrufe brauchen den Header `X-QuickShop-CSRF` mit dem Token aus `/csrf`.

Genutzte Yuvomi-Endpunkte: `GET /auth/me`, `GET /shopping`, `GET /shopping/:id/items`, `GET /shopping/suggestions`, `POST /shopping/:id/items`, `PATCH /shopping/items/:id`, `DELETE /shopping/items/:id` (nur für „Rückgängig“).

## Entwicklung und Tests

```sh
npm test          # 41 Tests: Katalogspeicher, HTTP-Dienst, Einkaufslisten-Logik, Preise, Client
```

Abnahmetest gegen ein echtes Yuvomi (`tools/e2e/`): Yuvomi, Katalogdienst und `dev-proxy.mjs` lokal starten, dann `node tools/e2e/e2e.mjs <proxy-port> "$PWD/module" setup`. Danach den Dienst neu starten und `… persist` laufen lassen. Geprüft wird: Modul lädt fehlerfrei, Katalog-CRUD, Hinzufügen mit Doppel-Erkennung, Rückgängig, Erhalt nach Neustart, und dass Aufgaben, Kalender, Notizen, Vorrat und Dashboard unverändert antworten.

## Verwandt

Die Kassenbon-Erkennung wird ein eigenes Modul, **FlessingLabs ReceiptScan**. QuickShop hängt nicht davon ab.

## Lizenz

MIT, © 2026 FlessingLabs.
