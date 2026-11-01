# FlessingLabs QuickShop

[Deutsch](README.de.md) · **English**

An item catalogue for the shopping list of [Yuvomi](https://github.com/ulsklyc/yuvomi).

**Create an item once, put it on the shopping list as often as you like.**

QuickShop keeps the things a household buys again and again: a name, a default quantity and, if you want, a price. One tap on **+** puts the item on the existing Yuvomi shopping list. Nothing more: no pantry, no barcodes, no AI.

Free and open source (MIT) by FlessingLabs.

**How to use it (for household members):** [docs/GUIDE.md](docs/GUIDE.md)

## Features

- Create, edit, delete and search items. The search field doubles as the field for new items.
- One tap on **+** (or Enter in the search field) puts the item on the list with its default quantity.
- If the item is already on the list, no second row appears:
  - still open → the quantity goes up (1 becomes 3 with a default quantity of 2);
  - already checked off → it is reopened with the default quantity;
  - quantity is free text ("500 g") → nothing changes, you only get a notice.
- Adding and deleting can be **undone** from the notice at the bottom.
- With several shopping lists, pick the target list at the top right. The device remembers the choice.
- Adding never changes the catalogue item.
- Large touch targets, no dialogs, light and dark mode like Yuvomi.
- German and English; more languages via `module/locales/<language>.json`.

## How it fits together

```text
Browser ──► Caddy (:8088) ──┬─ /api/extensions/flessinglabs-quickshop/* ─► quickshop (catalogue, SQLite)
                            └─ everything else ───────────────────────────► yuvomi (unchanged)
```

| Part | Folder | Purpose |
|---|---|---|
| Module | `module/` | The page inside Yuvomi. Goes into Yuvomi's `modules/` folder. |
| Catalogue service | `sidecar/` | Stores the catalogue in its own SQLite file. Node, no npm dependencies. |
| Proxy | `deploy/` | Caddy, so that Yuvomi and the catalogue service share **one address**. |

**Why a separate service?** Yuvomi modules are browser code only and have no data storage. The route Yuvomi documents for module data is a service next to Yuvomi ([MODULES.md, "Modules With A Backend Service"](https://github.com/ulsklyc/yuvomi/blob/main/MODULES.md#modules-with-a-backend-service)). QuickShop never opens `yuvomi.db` and changes no line of Yuvomi's core. The shopping list is written only through Yuvomi's official API. Details (German): [docs/MACHBARKEIT.md](docs/MACHBARKEIT.md).

## Requirements

- Yuvomi running with Docker Compose and a mounted `modules/` folder (the default in Yuvomi's `docker-compose.yml`).
- Docker with Compose v2.
- For development and tests: Node.js 22.13 or later.

## Installation

The examples assume Yuvomi's default Compose setup: project folder `yuvomi`, container `yuvomi`, network `yuvomi_default`, modules folder `./modules`.

### 1. Copy the module into Yuvomi

```sh
git clone https://github.com/FlessingLabs/yuvomi-quickshop.git flessinglabs-quickshop
cp -r flessinglabs-quickshop/module /path/to/yuvomi/modules/flessinglabs-quickshop
```

The folder must be named `flessinglabs-quickshop`. Yuvomi picks the module up without a restart. A module copied by hand is active right away.

*Alternative:* if Yuvomi has `MODULES_ALLOW_WEB_INSTALL=true`, use Settings → Modules → Add custom module with the address `https://github.com/FlessingLabs/yuvomi-quickshop/tree/main/module`. An admin then has to switch the module on.

### 2. Start the catalogue service and the proxy

Check the name of Yuvomi's network:

```sh
docker network ls | grep yuvomi        # expected: yuvomi_default
```

If it differs, create a `.env` in `deploy/` with `YUVOMI_NETWORK=<name>`. The port can be changed there too (`QUICKSHOP_HTTP_PORT`, default 8088).

```sh
cd flessinglabs-quickshop/deploy
docker compose up -d --build
docker compose ps                      # quickshop: healthy
```

### 3. Point Yuvomi at the proxy

In Yuvomi's `.env`:

```sh
TRUST_PROXY=172.16.0.0/12
```

This lets Yuvomi read each device's real address from the proxy. Without it, every request looks like one single device, and Yuvomi's login and request limits hit the whole household at once. Then restart Yuvomi: `docker compose up -d` in the Yuvomi folder.

**From now on, open Yuvomi at `http://<server>:8088`**, including bookmarks and the installed app. Yuvomi keeps working on the old port 3000, but QuickShop shows "service unreachable" there. To close the old port, change the port line in Yuvomi's `docker-compose.yml` to `127.0.0.1:${OIKOS_HTTP_PORT:-3000}:3000`.

**HTTPS with your own domain:** in `deploy/Caddyfile`, replace `:80 {` with the host name (for example `shopping.example.org {`), publish ports 80 and 443 in `docker-compose.yml` and set `SESSION_SECURE=true` in Yuvomi's `.env`. Caddy fetches the certificate itself.

### 4. Check

1. **QuickShop** appears in Yuvomi's navigation.
2. Type a name into the search field, tap **"Create …"**, then **+**: the item is on the shopping list.
3. Settings → Modules → Active modules: QuickShop shows no error.
4. Settings → Household → Roles & permissions: the **QuickShop** entry controls who may see (`Read`) and maintain (`Write`) the catalogue.

From the command line:

```sh
curl http://<server>:8088/api/extensions/flessinglabs-quickshop/health   # {"data":{"ok":true}}
```

## Updating

```sh
cd flessinglabs-quickshop && git pull
rm -rf /path/to/yuvomi/modules/flessinglabs-quickshop
cp -r module /path/to/yuvomi/modules/flessinglabs-quickshop
cd deploy && docker compose up -d --build
```

The catalogue lives in the `quickshop-data` volume and survives updates. Newer database versions migrate automatically on start. An older QuickShop refuses a database written by a newer one rather than damaging it.

## Backup

```sh
docker compose -f deploy/docker-compose.yml stop quickshop
docker run --rm -v deploy_quickshop-data:/data -v "$PWD":/backup alpine \
  cp /data/quickshop.db /backup/quickshop-$(date +%F).db
docker compose -f deploy/docker-compose.yml start quickshop
```

The volume name depends on the Compose project (`docker volume ls | grep quickshop`). Yuvomi's own backup does **not** include the catalogue.

## Removing

1. Switch QuickShop off under Settings → Modules, or delete the folder `modules/flessinglabs-quickshop`.
2. `cd deploy && docker compose down` (add `-v` to delete the catalogue as well).
3. Point bookmarks back at Yuvomi's port and reset `TRUST_PROXY`.

The shopping list is not touched.

## Permissions and security

- The catalogue service trusts nothing the browser says. For every request it asks Yuvomi who the caller is and what they may do (`GET /api/v1/auth/me` with the session cookie). The answer is cached for 5 seconds.
- Write requests additionally need a matching `Origin`, the service's own CSRF pair (cookie and header) and the `Write` level for QuickShop.
- If the module is switched off in Yuvomi, the service refuses every request as well.
- The browser writes to the shopping list directly at Yuvomi with the member's session, so Yuvomi's own shopping-list permissions apply unchanged.

## Service configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Port inside the container |
| `DATA_DIR` | `/data` | Folder for `quickshop.db` |
| `YUVOMI_URL` | `http://yuvomi:3000` | Internal address of Yuvomi |
| `PUBLIC_ORIGIN` | empty | Allowed origins, comma-separated. Empty = the host the browser called |
| `YUVOMI_SESSION_COOKIE` | `yuvomi.sid` | Name of Yuvomi's session cookie |
| `AUTH_CACHE_MS` | `5000` | Cache time for the permission check |

## Catalogue service API

Prefix: `/api/extensions/flessinglabs-quickshop`. Responses: `{ data }`; errors: `{ error, code, reason }`.

| Method | Path | Level | Description |
|---|---|---|---|
| GET | `/health` | – | Liveness check |
| GET | `/me` | Read | `{ user_id, access }` |
| GET | `/csrf` | Read | `{ token }` and sets the CSRF cookie |
| GET | `/items?q=` | Read | All items, alphabetical; `q` filters by substring |
| GET | `/items/:id` | Read | One item |
| POST | `/items` | Write | `{ name, default_quantity?, price_cents? }` → 201; 409 `item_exists` for a duplicate name |
| PATCH | `/items/:id` | Write | Partial update; `price_cents: null` removes the price |
| DELETE | `/items/:id` | Write | `{ id, deleted: true }` |

Item: `{ id, name, default_quantity (1–999), price_cents (cents or null), created_by, created_at, updated_at }`. Write calls need the header `X-QuickShop-CSRF` with the token from `/csrf`.

Yuvomi endpoints used: `GET /auth/me`, `GET /shopping`, `GET /shopping/:id/items`, `GET /shopping/suggestions`, `POST /shopping/:id/items`, `PATCH /shopping/items/:id`, `DELETE /shopping/items/:id` (undo only).

## Development and tests

```sh
npm test          # 41 tests: catalogue storage, HTTP service, shopping-list logic, prices, client
```

Acceptance test against a real Yuvomi (`tools/e2e/`): start Yuvomi, the catalogue service and `dev-proxy.mjs` locally, then run `node tools/e2e/e2e.mjs <proxy-port> "$PWD/module" setup`. Restart the service and run `… persist`. It checks that the module loads without errors, catalogue CRUD, adding with duplicate detection, undo, persistence across a restart, and that tasks, calendar, notes, pantry and dashboard still answer unchanged.

## Related

Receipt scanning will be a separate module, **FlessingLabs ReceiptScan**. QuickShop does not depend on it.

## License

MIT, © 2026 FlessingLabs.
