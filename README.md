# FlessingLabs QuickShop 2

[Deutsch](README.de.md) · **English**

An item catalogue for the shopping list of [Yuvomi](https://github.com/ulsklyc/yuvomi).

**Create an item once, put it on the shopping list as often as you like.**

> **Version 2 needs a Yuvomi with module storage** (`/api/v1/modules/:id/records`). Today that is only the FlessingLabs test build of Yuvomi (branch [`feat/module-storage`](https://github.com/FlessingLabs/yuvomi/tree/feat/module-storage), image `ghcr.io/flessinglabs/yuvomi:module-storage-test`). The feature has been proposed to the Yuvomi maintainer ([discussion #2452](https://github.com/ulsklyc/yuvomi/discussions/2452)) but is **not** part of official Yuvomi.
>
> On an unmodified Yuvomi, QuickShop 2 shows "This Yuvomi has no module storage" and does nothing else. For an unmodified Yuvomi use **QuickShop 1.1** (branch `main`, tag `v1.1.0`), which keeps the catalogue in a container of its own.

QuickShop keeps the things a household buys again and again: a name, a default quantity and, if you want, a reference price. One tap on **+** puts the item on the existing Yuvomi shopping list. No pantry, no barcodes, no AI.

Free and open source (MIT) by FlessingLabs. **How to use it (for household members):** [docs/GUIDE.md](docs/GUIDE.md)

## Features

- Create, edit, delete and search items. The search field doubles as the field for new items.
- One tap on **+** (or Enter in the search field) puts the item on the list with its default quantity.
- Already on the list: still open → the quantity goes up; checked off → reopened with the default quantity; quantity is free text ("500 g") → left alone, you get a notice. Every add can be undone.
- The catalogue is shared by the whole household and kept by Yuvomi itself - in Yuvomi's database and in Yuvomi's backups.
- Two people editing the same item: the second save is refused, the current version is shown, nothing is overwritten silently.
- German and English, large touch targets, no dialogs, light and dark mode like Yuvomi.

## How it works

QuickShop 2 is browser code only. It talks to Yuvomi's own API with the member's session:

| What | Yuvomi API |
|---|---|
| Catalogue | `/api/v1/modules/flessinglabs-quickshop/records` (module storage) |
| Shopping list | `/api/v1/shopping/...` |
| Who may do what | `/api/v1/auth/me` → permission `ext:flessinglabs-quickshop` |

No extra container, no proxy, no request outside `/api/v1`. Each catalogue item is one record `{ name, default_quantity, price_cents }` with a server-assigned UUID and a revision.

## Installation

1. Run Yuvomi from the image `ghcr.io/flessinglabs/yuvomi:module-storage-test`. For Unraid, follow **[docs/UNRAID-TEST.de.md](docs/UNRAID-TEST.de.md)**: it starts with a separate test copy and covers backup and the way back.
2. Install the module, either from Settings → Modules → Add custom module (needs `MODULES_ALLOW_WEB_INSTALL=true`) with the address
   `https://github.com/FlessingLabs/yuvomi-quickshop/tree/feat/core-storage/module`
   or by copying the `module` folder to Yuvomi's modules folder as `flessinglabs-quickshop`.
3. Switch QuickShop on under Settings → Modules, and set who may read or edit the catalogue under Settings → Household → Roles & permissions.

## Moving from QuickShop 1.x

QuickShop 2 never reads or deletes the old service's database by itself. To bring an existing catalogue along:

1. Export it - read-only, the old database is not changed:
   ```sh
   node tools/export-sidecar-db.mjs /mnt/user/appdata/flessinglabs-quickshop/quickshop.db > quickshop-export.json
   ```
   (or, while 1.x still runs, save `http://<server>:8088/api/extensions/flessinglabs-quickshop/items` from a signed-in browser).
2. In QuickShop 2, open **Import catalogue** at the bottom of the page and choose the file. Items whose name already exists are skipped and left unchanged.
3. Once everything is there, remove the old container when you like. Its data folder stays until you delete it.

## Development and tests

```sh
npm test                                   # catalogue store, shopping-list logic, prices, import
node tools/e2e/e2e-core-storage.mjs setup --base http://127.0.0.1:3000     # against a running Yuvomi with module storage
node tools/e2e/e2e-core-storage.mjs persist --base http://127.0.0.1:3000   # after a restart
node tools/e2e/e2e-core-storage.mjs readonly --base http://<server>:<port> # read-only check of a live install
```

## Related

Receipt scanning will be a separate module, **FlessingLabs ReceiptScan**. QuickShop does not depend on it, and on no AI.

## License

MIT, © 2026 FlessingLabs.
