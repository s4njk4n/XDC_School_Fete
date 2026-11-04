# 🎡 Fete Tickets

**Free phone tickets for any school fete.** It's the ticket system fetes already use, on phones. Families buy tickets at the ticket booth with cash or card, then pay at any stall by scanning a code. At the end, the organiser gets exact totals for every booth and stall.

Built by [XDC Outpost](https://xdcoutpost.xyz) · Live at **https://xdcoutpost.xyz/XDC_School_Fete/**

> **Any school can use this site as is.** Nothing in this repository needs to be edited, forked or configured to run a fete. A school's organiser opens the website, and the Organiser app walks them through everything.

---

## For schools: how to use it

Go to **https://xdcoutpost.xyz/XDC_School_Fete/** and tap **I'm organising a fete — start here**. That's the whole setup. The homepage explains each step, and the Organiser app keeps a checklist:

1. **Practice run** (free, pretend credit). Recommended for the committee.
2. **Set up the organiser phone** and text yourself the backup.
3. **Add running credit**: a few dollars' worth of XDC. The app explains how to get it.
4. **Create your tickets**: enter the fete name and ticket price.
5. **Invite helpers**: text each booth or stall helper their link, or print the helper sheets.
6. **Add each booth and stall** by scanning the code the helper shows you.
7. **Print the family poster.**
8. **On the day / afterwards**: the app has a checklist and the totals.

## The four apps

| App | Who | Install? |
|---|---|---|
| **Fete Tickets** `customer/` | Families | **No.** It runs in the browser from the poster. An optional "add to home screen" tip appears after they get tickets. |
| **Ticket Booth** `booth/` | Ticket sellers | Asked to add it to the home screen (they use it all day). There's a skip link. |
| **Fete Stall** `stall/` | Stall helpers | Same as Ticket Booth. |
| **Fete Organiser** `organiser/` | P&C / committee | Same on phones. On a laptop it just opens in the browser. |

---

## How "no configuration" works

- **The fete travels in the link.** Every link and QR code the Organiser app makes carries the fete, e.g. `…/booth/?fete=0xABC…`. A test-network fete adds `&net=test`.
  - Each app remembers the fete on the phone **and** keeps it in the address bar.
  - The manifests have no `start_url`, so bookmarks and *Add to Home Screen* (including iPhone's separate home-screen storage) save a link that already knows the fete.
- **Joining without a link:** any app opened without a fete asks the person to scan one of the fete's QR codes. Any poster or helper sheet works.
- **Backups carry the fete.** Each backup message contains the phone's restore code **and** its fete link. Pasting it into the app on any phone restores the tickets *and* reconnects to the right fete.
- **The team list lives on the network.** When the organiser adds, renames or removes a booth or stall, the ticket contract records it (`addHelper` → `HelperSet` event). The organiser's dashboard, totals and spreadsheet can be rebuilt on any phone from the organiser's backup alone.
- **One phone, several fetes:** a phone can join any number of fetes (e.g. a family visiting two schools on one weekend). History, "already paid" warnings, booth cash checks and stall join status are kept **per fete**. When a link switches the phone to another fete, the app says so, and **Settings → Your other fetes** switches back. Each fete's tickets only work at that fete. If someone scans a payment code from a different fete, the app explains and offers to switch.
- **Payment codes are links.** A stall's or booth's payment QR is a normal web link into the family app (`…/customer/?fete=…&pay=…&amt=…&for=…`). Families can scan it with the Fete Tickets app **or their phone's ordinary camera** and land straight on the Pay screen.
- **Totals come from the network,** so they're exact even if a helper's phone is lost. The apps read events in adaptive chunks: they start at 50,000 blocks, halve when a server objects, and remember what worked.
- **Practice mode:** `?net=test` (or Settings → Technical details → Connection server) uses XDC's Apothem test network with free test credit from <https://faucet.blocksscan.io/>. A banner shows on every screen in practice mode.

`config.js` holds only host-wide defaults: the connection server, currency symbol, credit amounts and footer credit. Its `feteAddress` is left empty on purpose.

## How it works (technical)

- **Tickets** are a minimal XRC-20 token (XDC Network's ERC-20-compatible token standard) (`contract/FeteTickets.sol`, symbol `TIX`, 18 decimals) deployed from the Organiser app. It also stores the fete name, ticket price in cents, organiser address and creation block.
- **`give(to, amount)` is payable.** It moves tickets and forwards the attached XDC "running credit" (gas) in one transaction. Booths top up each customer phone that has less than `0.01` XDC with `0.05` XDC. Customers never see the words gas or XDC.
- **Stall payments:** the stall's QR asks for slightly *less* than the price, by a random amount under 0.000001 of a ticket. The stall then watches its `Transfer` logs for that exact value, and falls back to checking its balance if needed.
- **Wallets** are created in each app and stored in `localStorage`, separately for each app, so one phone can hold several roles. The backup is a text message the person sends to their own number.
- **Connection:** Plugin RPC `https://rpc.plugin.global/xdcmainnet` by default (`/xdcapothem` for practice). It can be changed per phone in Settings. Transactions are legacy type-0 with fixed gas limits, priced at `eth_gasPrice` + 10%. Confirmations come from polling receipts.
- **QR formats:**

  | Code | Meaning |
  |---|---|
  | `FETE:C:<addr>` | Person |
  | `FETE:B:<addr>:<name>` / `FETE:S:<addr>:<name>` | Booth or stall joining |
  | `FETE:P:<addr>:<amountWei>:<label>` | Payment request |
  | `FETE:F:<token>:<chainId>` | Fete |
  | `https://…?fete=0x…` | Fete link |
  | Plain `0x…` / `xdc…` address | Person |

- **No build step:** plain HTML, CSS and JS. The libraries are included in `shared/vendor/`: ethers v6, jsQR and qrcode-generator. `sw.js` keeps the apps opening on patchy Wi-Fi.
- **Contract:** solc 0.8.24, optimiser 200 runs, `evmVersion: paris`. The ABI and bytecode are in `contract/FeteTickets.json` and embedded in `shared/contract.js`.

## Hosting your own copy (optional)

Fork or upload this folder to any static host with HTTPS. For GitHub Pages: create a repo, upload the contents, then go to **Settings → Pages → Deploy from a branch → `main` / root**. No other setup is needed.

## Good to know

- **Browser storage:** families' tickets live in the browser that opened the page. Private or incognito tabs forget them when closed, and the welcome screen asks people not to use one. Pages opened inside Facebook, Instagram or some scanner apps are asked to reopen in the normal browser. The backup text recovers anything lost.
- **iPhone home-screen apps** keep their own storage. Someone who adds the app *after* getting tickets in Safari pastes their backup text, and the tip tells them so.
- **Backup messages are keys.** Anyone with a phone's backup text can use that phone's tickets. Tickets have no value outside the fete, but the organiser's backup controls the fete and should be kept carefully.
- **Internet is needed** to buy and spend tickets. The apps reconnect on their own. Keeping some paper tickets at the booth is a sensible fallback.
