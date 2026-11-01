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
Browser ──► QuickShop-Container (:8088) ──┬─ /api/extensions/flessinglabs-quickshop/*  → Katalog (SQLite)
                                          └─ alles andere → unverändert weiter → Yuvomi
```

| Teil | Ordner | Aufgabe |
|---|---|---|
| Modul | `module/` | Die Seite in Yuvomi. Kommt in Yuvomis `modules/`-Ordner. |
| QuickShop-Container | `sidecar/` | Speichert den Katalog in einer eigenen SQLite-Datei und ist der Eingang zu Yuvomi. Node ohne npm-Abhängigkeiten. Image: `ghcr.io/flessinglabs/yuvomi-quickshop`. |
| Bereitstellung | `deploy/` | Unraid-Template und Docker-Compose-Datei. |

**Warum überhaupt ein Container?** Yuvomi-Module sind reiner Browser-Code. Yuvomis Installer kopiert nur `.js`- und `.css`-Dateien und führt auf dem Server nichts aus, und Yuvomi hat keinen Speicher für Moduldaten. Der von Yuvomi dokumentierte Weg ist ein Dienst neben Yuvomi ([MODULES.md, „Modules With A Backend Service“](https://github.com/ulsklyc/yuvomi/blob/main/MODULES.md#modules-with-a-backend-service)).

**Warum Yuvomi darüber öffnen?** Der Browser muss Yuvomi und den Katalog unter derselben Adresse erreichen (dasselbe Session-Cookie). Yuvomi reicht `/api/extensions/...` aber nicht selbst weiter. Also beantwortet der QuickShop-Container seinen eigenen Pfad und reicht alles andere unverändert an Yuvomi durch. QuickShop öffnet nie `yuvomi.db` und ändert keine Zeile am Yuvomi-Kern. Die Einkaufsliste wird nur über Yuvomis offizielle API beschrieben. Details: [docs/MACHBARKEIT.md](docs/MACHBARKEIT.md).

## Installation

Zwei Schritte: Das **Modul** kommt in Yuvomi, der **Container** läuft neben Yuvomi.

### Schritt 1: Modul in Yuvomi installieren

Über Yuvomis Oberfläche (im Yuvomi-Container muss `MODULES_ALLOW_WEB_INSTALL=true` gesetzt sein): Einstellungen → Module → Eigenes Modul hinzufügen, Adresse `https://github.com/FlessingLabs/yuvomi-quickshop/tree/main/module`, danach das Modul einschalten.

Oder von Hand: den Ordner `module` als `flessinglabs-quickshop` in Yuvomis Modulpfad kopieren. Auf Unraid ist das standardmäßig `/mnt/user/appdata/yuvomi/modules/flessinglabs-quickshop`.

### Schritt 2a: Container auf Unraid

1. Docker → Container hinzufügen → im Feld „Template“ die Adresse `https://raw.githubusercontent.com/FlessingLabs/yuvomi-quickshop/main/deploy/unraid/flessinglabs-quickshop.xml` einfügen. Alternativ das XML nach `/boot/config/plugins/dockerMan/templates-user/` kopieren.
2. **Yuvomi URL:** deine Unraid-IP und Yuvomis Port, z. B. `http://192.168.1.10:3000`.
3. **WebUI Port:** der Port, über den du Yuvomi ab jetzt öffnest (Standard `8088`).
4. Übernehmen.
5. Im **Yuvomi**-Container die Variable `TRUST_PROXY` (erweiterte Ansicht) auf `172.16.0.0/12` setzen und übernehmen. Sonst sieht Yuvomi alle Zugriffe als ein einziges Gerät, und die Anmelde- und Anfragebegrenzung trifft den ganzen Haushalt gemeinsam.

### Schritt 2b: Container mit Docker Compose

```sh
git clone https://github.com/FlessingLabs/yuvomi-quickshop.git
cd yuvomi-quickshop/deploy
YUVOMI_URL=http://yuvomi:3000 docker compose up -d
```

`YUVOMI_URL` ist die Adresse, über die der Container Yuvomi erreicht. Im gemeinsamen Compose-Netzwerk ist das `http://yuvomi:3000`, sonst Server-Adresse und Port. In Yuvomis `.env` `TRUST_PROXY=172.16.0.0/12` setzen und Yuvomi neu starten.

### Schritt 3: die neue Adresse nutzen

**Yuvomi ab jetzt über `http://<server>:8088` öffnen.** Das gilt auch für Lesezeichen und die installierte App; einmal neu anmelden. Yuvomi selbst bleibt unverändert und antwortet weiter auf seinem alten Port, QuickShop funktioniert aber nur über den neuen.

### Prüfen

1. In Yuvomi erscheint **QuickShop** und zeigt das Suchfeld, nicht „Dienst nicht erreichbar“.
2. Einen Namen tippen, **„… anlegen“** tippen, dann **+**: Der Artikel steht auf der Einkaufsliste.
3. Einstellungen → Haushalt → Rollen & Berechtigungen: Der Eintrag **QuickShop** regelt, wer den Katalog sehen (`Lesen`) und pflegen (`Schreiben`) darf.

```sh
curl http://<server>:8088/api/extensions/flessinglabs-quickshop/health   # {"data":{"ok":true}}
```

### Schon einen Reverse-Proxy?

Am QuickShop-Container `PROXY_YUVOMI=false` setzen und den Pfad stattdessen im eigenen Proxy leiten, z. B. in Caddy:

```text
handle /api/extensions/flessinglabs-quickshop/* {
	reverse_proxy quickshop:8080
}
handle {
	reverse_proxy yuvomi:3000
}
```

## Aktualisieren

- **Container:** Unraid → Docker → „Nach Updates suchen“, oder `docker compose pull && docker compose up -d`.
- **Modul:** erneut über Einstellungen → Module installieren (ein Admin muss es danach wieder einschalten), oder den Ordner von Hand ersetzen.

Der Katalog liegt im Datenordner (auf Unraid `/mnt/user/appdata/flessinglabs-quickshop`) und bleibt bei Updates erhalten. Neue Datenbankversionen migrieren beim Start automatisch. Eine Datenbank aus einer neueren QuickShop-Version lehnt eine ältere ab, statt sie zu beschädigen.

## Sicherung

Die Datei `quickshop.db` im Datenordner sichern, auf Unraid z. B. mit dem Plugin „Appdata Backup“. Yuvomis eigene Sicherung enthält den Katalog **nicht**.

## Entfernen

1. Einstellungen → Module → QuickShop ausschalten oder löschen.
2. Den QuickShop-Container entfernen. Den Datenordner nur löschen, wenn auch der Katalog weg soll.
3. Yuvomi wieder über seinen eigenen Port öffnen und `TRUST_PROXY` zurücksetzen.

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
| `PROXY_YUVOMI` | `true` | Alles außerhalb des QuickShop-Pfads an Yuvomi durchreichen. `false` hinter einem eigenen Reverse-Proxy |

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
npm test          # 45 Tests: Katalogspeicher, HTTP-Dienst, Durchreichen, Einkaufslisten-Logik, Preise, Client
```

Abnahmetest gegen ein echtes Yuvomi (`tools/e2e/`): Yuvomi und den QuickShop-Dienst lokal starten (der Dienst auf dem Eingangsport, `YUVOMI_URL` zeigt auf Yuvomi), dann `node tools/e2e/e2e.mjs <dienst-port> "$PWD/module" setup`. Danach den Dienst neu starten und `… persist` laufen lassen. Geprüft wird: Modul lädt fehlerfrei, Katalog-CRUD, Hinzufügen mit Doppel-Erkennung, Rückgängig, Erhalt nach Neustart, und dass Aufgaben, Kalender, Notizen, Vorrat und Dashboard unverändert antworten.

## Verwandt

Die Kassenbon-Erkennung wird ein eigenes Modul, **FlessingLabs ReceiptScan**. QuickShop hängt nicht davon ab.

## Lizenz

MIT, © 2026 FlessingLabs.
