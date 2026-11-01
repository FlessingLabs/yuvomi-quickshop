# Yuvomi mit Modulspeicher + QuickShop 2 auf Unraid testen

Diese Anleitung bringt QuickShop 2 auf Unraid, **ohne** zusätzlichen Container und ohne Proxy. Die laufende Yuvomi-Installation bleibt dabei bis Schritt 4 unberührt.

| | |
|---|---|
| Yuvomi-Image (Test) | `ghcr.io/flessinglabs/yuvomi:module-storage-test` (wandert mit dem Branch) |
| Festes Image eines Standes | `ghcr.io/flessinglabs/yuvomi:module-storage-<commit>` (siehe [Packages](https://github.com/FlessingLabs/yuvomi/pkgs/container/yuvomi)) |
| Yuvomi-Quelle | [FlessingLabs/yuvomi, Branch `feat/module-storage`](https://github.com/FlessingLabs/yuvomi/tree/feat/module-storage), basiert auf Upstream `main` nach v2.83.0 |
| QuickShop | 2.0.0, [Branch `feat/core-storage`](https://github.com/FlessingLabs/yuvomi-quickshop/tree/feat/core-storage), Ordner `module` |
| Offizielles Image (Rückweg) | `ghcr.io/ulsklyc/yuvomi:2.83.0` bzw. die Version, die du heute nutzt |

> **Wichtig vorab:** Das Test-Image ändert beim ersten Start die Datenbank (Upstream-Migrationen 272/273 und die neue 274 für den Modulspeicher). Das offizielle Image startet danach mit dieser Datenbank **nicht mehr**, es meldet „This database was written by a newer Yuvomi“. Zurück geht es nur mit der Sicherung von **vor** dem Wechsel. Ein bloßer Image-Tausch ist kein Rückweg.

## Schritt 0: Was du heute nutzt

Unraid → Docker → Yuvomi → *Edit*. Notiere dir:
- **Repository** (z. B. `ghcr.io/ulsklyc/yuvomi:latest`) und die Version unten links in Yuvomi unter *Einstellungen → Über*;
- **WebUI Port** (meist `3000`);
- die Pfade **Data**, **Backups** und **Modules** (Standard `/mnt/user/appdata/yuvomi/...`);
- ob **DB_ENCRYPTION_KEY** gesetzt ist. Wenn ja, brauchst du ihn für jede Kopie der Datenbank.

## Stufe A: Test mit leerer Datenbank (ohne jedes Risiko)

Ein zweiter Container mit eigenen Ordnern und eigenem Port. Er sieht deine echten Daten nicht.

1. Docker → *Add Container* → als Template **Yuvomi** wählen. Dann ändern:
   - **Name:** `Yuvomi-Test`
   - **Repository:** `ghcr.io/flessinglabs/yuvomi:module-storage-test`
   - **WebUI Port:** `3001`
   - **Data:** `/mnt/user/appdata/yuvomi-test/data`
   - **Backups:** `/mnt/user/appdata/yuvomi-test/backups`
   - **Modules:** `/mnt/user/appdata/yuvomi-test/modules`
   - **Documents:** `/mnt/user/appdata/yuvomi-test/documents`
   - **MODULES_ALLOW_WEB_INSTALL:** `true`
   - **SESSION_SECRET:** ein neuer langer Zufallswert
   - **DB_ENCRYPTION_KEY:** leer lassen
   - alle Google-, Microsoft-, OIDC-, Apple- und Mail-Felder: leer lassen
2. *Apply*. Dann `http://<unraid-ip>:3001` öffnen und einen Test-Admin anlegen.
3. Einstellungen → Module → *Eigenes Modul hinzufügen* → Adresse
   `https://github.com/FlessingLabs/yuvomi-quickshop/tree/feat/core-storage/module` → installieren → unter *Aktive Module* einschalten.
4. Prüfen:
   - Links erscheint **QuickShop** mit Suchfeld, nicht „Dieses Yuvomi hat keinen Modulspeicher“.
   - Einen Artikel anlegen, mit **+** auf die Einkaufsliste setzen, die Einkaufsliste öffnen.
   - Container neu starten: Der Artikel ist noch da.
   - Auf dem Handy dasselbe.
5. Optional, automatisch (von einem Rechner mit Node.js 22+ und dem QuickShop-Repository):
   ```sh
   node tools/e2e/e2e-core-storage.mjs setup   --base http://<unraid-ip>:3001 --user <test-admin> --password <pw>
   # Container neu starten, dann:
   node tools/e2e/e2e-core-storage.mjs persist --base http://<unraid-ip>:3001 --user <test-admin> --password <pw>
   ```
   Der Test legt Testdaten mit dem Präfix „E2E“ an, eine Liste „E2E Liste“ und zwei Mitglieder, und räumt Liste und Mitglieder wieder weg.

## Stufe B: Test mit einer Kopie deiner Daten (kurz)

Prüft, ob deine echte Datenbank sauber migriert. **Achtung:** Eine Kopie enthält deine Push-Abos, Kalenderkonten und Erinnerungen. Solange der Testcontainer läuft, können Erinnerungen doppelt kommen, und Kalender-Abgleiche laufen zweimal. Deshalb nur kurz laufen lassen, dort nichts ändern, danach stoppen.

1. Den echten Container **stoppen**. Dann im Unraid-Terminal:
   ```sh
   cp -a /mnt/user/appdata/yuvomi/data /mnt/user/appdata/yuvomi-test/data-kopie
   ```
   Danach den echten Container wieder starten.
2. `Yuvomi-Test` bearbeiten:
   - **Data:** `/mnt/user/appdata/yuvomi-test/data-kopie`
   - **DB_ENCRYPTION_KEY:** derselbe Wert wie im echten Container, falls dort gesetzt
3. Starten. Im Log (Docker → Yuvomi-Test → *Logs*) muss stehen:
   `Migration 274 applied: Persistent household JSON records for third-party modules`. Davor stehen ggf. 272 und 273.
4. Mit deinem normalen Konto auf `:3001` anmelden und schauen, ob Aufgaben, Kalender, Einkauf und Budget wie gewohnt aussehen. QuickShop installieren wie in Stufe A und kurz prüfen. Rein lesend geht das auch automatisch:
   ```sh
   node tools/e2e/e2e-core-storage.mjs readonly --base http://<unraid-ip>:3001 --user <dein-konto> --password <pw>
   ```
5. `Yuvomi-Test` **stoppen**.

## Schritt 4: Wechsel der echten Installation (erst nach deinem OK)

1. **Sichern.** Echten Container stoppen, dann:
   ```sh
   cp -a /mnt/user/appdata/yuvomi /mnt/user/appdata/yuvomi-vor-modulspeicher-$(date +%F)
   ```
   Diese Kopie ist dein Rückweg. Bewahre sie auf, bis du sicher bist.
2. Im bestehenden Template **nur** ändern:
   - **Repository:** `ghcr.io/flessinglabs/yuvomi:module-storage-test`
   - **MODULES_ALLOW_WEB_INSTALL:** `true`, falls du QuickShop über die Oberfläche installieren willst

   Port, Pfade, SESSION_SECRET und DB_ENCRYPTION_KEY bleiben, wie sie sind.
3. *Apply*. Im Log auf `Migration 274 applied` achten.
4. QuickShop installieren und einschalten wie in Stufe A. Ist noch QuickShop 1.x installiert, wird es dabei ersetzt.
5. Gab es einen Katalog aus QuickShop 1.x: siehe README, „Umstieg von QuickShop 1.x“. Auf Unraid geht der Export ohne Node-Installation so:
   ```sh
   curl -sLo /tmp/export-sidecar-db.mjs https://raw.githubusercontent.com/FlessingLabs/yuvomi-quickshop/feat/core-storage/tools/export-sidecar-db.mjs
   docker run --rm -v /mnt/user/appdata/flessinglabs-quickshop:/old:ro -v /tmp:/work node:24-slim \
     node /work/export-sidecar-db.mjs /old/quickshop.db > /tmp/quickshop-export.json
   ```
   Der alte Ordner wird nur lesend eingebunden (`:ro`). Die Datei `/tmp/quickshop-export.json` dann in QuickShop unter „Katalog importieren“ wählen.

## Rückweg

1. Yuvomi stoppen.
2. Den aktuellen Ordner beiseitelegen, nicht löschen:
   ```sh
   mv /mnt/user/appdata/yuvomi /mnt/user/appdata/yuvomi-modulspeicher-$(date +%F)
   cp -a /mnt/user/appdata/yuvomi-vor-modulspeicher-<datum> /mnt/user/appdata/yuvomi
   ```
3. Im Template **Repository** zurück auf das offizielle Image setzen, das du vorher hattest (z. B. `ghcr.io/ulsklyc/yuvomi:2.83.0`). Starten.

Alles, was zwischen Wechsel und Rückweg in Yuvomi eingetragen wurde, steckt dann nur im beiseitegelegten Ordner und ist im offiziellen Yuvomi nicht zu sehen. Ein Start des offiziellen Images mit der neuen Datenbank wird verweigert, mit Absicht. `DB_ALLOW_NEWER_SCHEMA=1` erzwingt ihn auf eigenes Risiko; das ist hier nicht empfohlen.

## Aufräumen nach dem Test

`Yuvomi-Test` entfernen und `/mnt/user/appdata/yuvomi-test` löschen. Das betrifft nur den Test, nicht deine echte Installation.
