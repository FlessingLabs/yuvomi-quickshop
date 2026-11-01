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
Browser ──► QuickShop container (:8088) ──┬─ /api/extensions/flessinglabs-quickshop/*  → catalogue (SQLite)
                                          └─ everything else → passed on unchanged → Yuvomi
```

| Part | Folder | Purpose |
|---|---|---|
| Module | `module/` | The page inside Yuvomi. Goes into Yuvomi's `modules/` folder. |
| QuickShop container | `sidecar/` | Stores the catalogue in its own SQLite file and is the entrance to Yuvomi. Node, no npm dependencies. Image: `ghcr.io/flessinglabs/yuvomi-quickshop`. |
| Deployment | `deploy/` | Unraid template and Docker Compose file. |

**Why a container at all?** Yuvomi modules are browser code only: Yuvomi's installer copies `.js`/`.css` files and runs nothing on the server, and Yuvomi has no storage for module data. The route Yuvomi documents is a service next to Yuvomi ([MODULES.md, "Modules With A Backend Service"](https://github.com/ulsklyc/yuvomi/blob/main/MODULES.md#modules-with-a-backend-service)).

**Why open Yuvomi through it?** The browser has to reach Yuvomi and the catalogue at the same address (same session cookie), and Yuvomi does not forward `/api/extensions/...` itself. So the QuickShop container answers its own path and passes everything else through to Yuvomi unchanged. QuickShop never opens `yuvomi.db` and changes no line of Yuvomi's core; the shopping list is written only through Yuvomi's official API. Details (German): [docs/MACHBARKEIT.md](docs/MACHBARKEIT.md).

## Installation

Two steps: the **module** goes into Yuvomi, the **container** runs next to Yuvomi.

### Step 1: install the module in Yuvomi

Either from Yuvomi's interface (needs `MODULES_ALLOW_WEB_INSTALL=true` in the Yuvomi container): Settings → Modules → Add custom module, address `https://github.com/FlessingLabs/yuvomi-quickshop/tree/main/module`, then switch the module on.

Or by hand: copy the `module` folder into Yuvomi's modules path as `flessinglabs-quickshop` (on Unraid by default `/mnt/user/appdata/yuvomi/modules/flessinglabs-quickshop`).

### Step 2a: container on Unraid

1. Docker → Add Container → Template: paste the URL `https://raw.githubusercontent.com/FlessingLabs/yuvomi-quickshop/main/deploy/unraid/flessinglabs-quickshop.xml` into the template field (or copy the XML to `/boot/config/plugins/dockerMan/templates-user/`).
2. **Yuvomi URL:** your Unraid IP and Yuvomi's port, e.g. `http://192.168.1.10:3000`.
3. **WebUI Port:** the port you will use for Yuvomi from now on (default `8088`).
4. Apply.
5. In the **Yuvomi** container, set the variable `TRUST_PROXY` to `172.16.0.0/12` (advanced view) and apply. Otherwise every request looks like one single device to Yuvomi, and its login and request limits hit the whole household at once.

### Step 2b: container with Docker Compose

```sh
git clone https://github.com/FlessingLabs/yuvomi-quickshop.git
cd yuvomi-quickshop/deploy
YUVOMI_URL=http://yuvomi:3000 docker compose up -d
```

`YUVOMI_URL` is how the container reaches Yuvomi: in a shared Compose network `http://yuvomi:3000`, otherwise the server address and port. Set `TRUST_PROXY=172.16.0.0/12` in Yuvomi's `.env` and restart Yuvomi.

### Step 3: use the new address

**Tip: keep Yuvomi's old address.** Two containers cannot share one host port, but they can swap: give the Yuvomi container another host port (e.g. `3001`), give the QuickShop container Yuvomi's old port (`3000`) and set **Yuvomi URL** to `http://<unraid-ip>:3001`. Bookmarks, the installed app and sessions keep working unchanged.

**Open Yuvomi at `http://<server>:8088` from now on**, including bookmarks and the installed app (sign in once more). Yuvomi itself is unchanged and still answers on its old port, but QuickShop only works through the new one.

### Check

1. **QuickShop** appears in Yuvomi's navigation and shows the search field (not "service unreachable").
2. Type a name, tap **"Create …"**, then **+**: the item is on the shopping list.
3. Settings → Household → Roles & permissions: the **QuickShop** entry controls who may see (`Read`) and maintain (`Write`) the catalogue.

```sh
curl http://<server>:8088/api/extensions/flessinglabs-quickshop/health   # {"data":{"ok":true}}
```

### Already have a reverse proxy?

Set `PROXY_YUVOMI=false` on the QuickShop container and route the path in your proxy instead, for example in Caddy:

```text
handle /api/extensions/flessinglabs-quickshop/* {
	reverse_proxy quickshop:8080
}
handle {
	reverse_proxy yuvomi:3000
}
```

## Updating

- **Container:** Unraid → Docker → "Check for Updates", or `docker compose pull && docker compose up -d`.
- **Module:** install it again from Settings → Modules (an admin has to switch it on again), or replace the folder by hand.

The catalogue lives in the data folder (`/mnt/user/appdata/flessinglabs-quickshop` on Unraid) and survives updates. Newer database versions migrate automatically on start; an older QuickShop refuses a database written by a newer one rather than damaging it.

## Backup

Back up the file `quickshop.db` in the data folder (on Unraid e.g. with the Appdata Backup plugin). Yuvomi's own backup does **not** include the catalogue.

## Removing

1. Switch QuickShop off under Settings → Modules, or delete the module.
2. Remove the QuickShop container (delete the data folder too if you want to lose the catalogue).
3. Open Yuvomi at its own port again and reset `TRUST_PROXY`.

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
| `PROXY_YUVOMI` | `true` | Pass everything outside QuickShop's path on to Yuvomi. `false` behind your own reverse proxy |

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
npm test          # 45 tests: catalogue storage, HTTP service, pass-through, shopping-list logic, prices, client
```

Acceptance test against a real Yuvomi (`tools/e2e/`): start Yuvomi and the QuickShop service locally (the service on the front port, `YUVOMI_URL` pointing at Yuvomi), then run `node tools/e2e/e2e.mjs <service-port> "$PWD/module" setup`. Restart the service and run `… persist`. It checks that the module loads without errors, catalogue CRUD, adding with duplicate detection, undo, persistence across a restart, and that tasks, calendar, notes, pantry and dashboard still answer unchanged.

## Related

Receipt scanning will be a separate module, **FlessingLabs ReceiptScan**. QuickShop does not depend on it.

## License

MIT, © 2026 FlessingLabs.
