# HealthQ PWA demo

A responsive, installable, offline-capable food and personal health log over 13,900 foods from USDA FoodData Central and the Government of Nepal DFTQC. No build step and no account are required.

## Architecture

```
index.html          markup for every screen
src/
  main.js           composition root: the only file that knows every feature
  core/             primitives with no domain knowledge
    dom.js            element lookup, HTML escaping, number formatting
    storage.js        the only module that touches localStorage
    notices.js        transient, non-blocking messages
    tabs.js           tab controller (ARIA + keyboard)
  services/         domain logic, pure functions, no DOM
    dailyNutrition.js  day totals, servings, progress maths
    healthProfile.js   BMI, BMR, TDEE, goal derivation
    suggestions.js     meal suggestion ranking and filtering
    attribution.js     data counts and source note
  features/         one module per screen
    discover.js       food library and portion panel
    calculator.js     stand-alone food calculator
    day.js            My Day dashboard
    health.js         My Health tab
    onboarding.js     guest-first tour
    settings.js       export, import, erase
    dialogs.js        goals and entry editors
    entryDialogs.js   quick add, servings, photo
nutrition.js        goal maths, coach rules, food data constants
data/
  catalogue.js     runtime view over the generated index
  index.js         build-time merge of the raw source files
  search.js        GENERATED compact catalogue (eager)
  detail.js        GENERATED nutrient tables (lazy)
  foods.js ...     raw USDA / Nepal source files
```

### Rules the structure enforces

- **Features never import each other.** A feature that needs something from
  another receives it through a callback registered at startup, or subscribes
  to the shared change listener. This is why `day.js` can read weight without
  `health.js` knowing `day.js` exists.
- **Only `core/storage.js` touches `localStorage`.**
- **Only `services/` does arithmetic on health data.** No feature contains a
  formula.
- **`src/main.js` is the only place wiring happens.**

### Regenerating the data index

`data/search.js` and `data/detail.js` are generated. After changing anything in
the raw `data/*.js` sources:

```bash
node tools/build-index.mjs
```

### The account model

There is no server account in this build, so there is no session, no password
and nothing to sign in to. The **Account** tab makes that explicit rather than
leaving users to guess:

- **Who am I** — name, avatar initials, member-since, and an honest "Guest ·
  no account" badge
- **What is stored** — a live inventory of ten data categories, each with its
  real record count and a plain-language reason it exists, plus the measured
  size in bytes
- **Where is it** — a plain statement that records live in this browser's local
  storage, that nothing is transmitted, and that clearing browser data will
  remove them
- **What we do not collect** — no email, phone, password, location, contacts,
  advertising or tracking identifiers

**Signing out** clears the name and profile from the device and keeps every
record, which makes it safe to hand a device to someone else.

**Leaving** is a three-step sequence, not a button: the alternatives (take a
break, sign out, download, contact support) are offered first, then an optional
"why are you leaving" survey, then type-to-confirm. Pause and delete are
reversible up to the final step.

**Not implemented, and why:** Google/Apple/Microsoft/Facebook sign-in, SMS OTP,
passport or national-ID verification, wearable pairing, "log out all devices",
and cross-device sync all require a backend. The state object is a single flat
JSON document, so it maps cleanly onto a `users.jsonb` column when one exists.


### Adding a feature

1. Create `src/features/yourFeature.js` with a `mount...()` and a `render...()`.
2. Call `mount` from `src/main.js`.
3. Add any new source files to the `EAGER` list in `sw.js` so they work offline.


## Running it

```bash
./start.command
```

Then open <http://localhost:8000>.

**Do not use `python3 -m http.server`.** The stdlib server prints a
`BrokenPipeError` traceback whenever the browser cancels a download — a
refresh, a tab close, or a DevTools probe. It is harmless noise, not a fault
in this app, but `tools/serve.py` (which `start.command` uses) handles it and
keeps the console clean.

You can also run it directly:

```bash
python3 tools/serve.py 8000
```

## If you see a red error in the app

A single pill-shaped notice appears at the bottom. It dismisses itself in a few
seconds and never blocks anything. If you see one with a button, it is telling
you something specific — most often that browser storage is full, which you
fix by exporting a backup and removing a meal photo.


## Run locally

1. Unzip the archive.
2. Open a terminal in the `healthq-pwa` directory.
3. Run `python3 -m http.server 8080`.
4. Visit `http://localhost:8080` on your computer. Use Chrome or another PWA-capable browser to install if the install control appears. Browsers decide whether and when installation is offered. You can also use the browser's Install app menu.

Opening `index.html` directly as a file will not register the service worker; use a local server or HTTPS hosting. On a phone, deploy these static files to HTTPS hosting. The app can then load offline after its first successful visit.

## Included

- Search across 7,793 USDA SR Legacy foods. A small set of exact-match Nepali names is included; other translations are left blank.
- Portion calculations for energy, protein, carbs and fat; source fiber and a complete per-food nutrient list. Missing nutrients are unknown.
- Editable daily meal log, weight entries, manual blood pressure entries.
- Export of records to JSON; delete today's log or all records.
- Local browser storage, no server, accounts, external requests, analytics or ads.
- Manifest, icons and service worker for installation and offline navigation.

## Limits and safety

Food values come from USDA FoodData Central SR Legacy (April 2018); this is a historical release, not current branding information or a substitute for product labels. The USDA values are food composition references, not guarantees for a specific meal, variety or preparation. No clinical advice, caloric target, device pairing, barcode service, payments or telemedicine is implemented. Browser storage can be cleared by the user or browser; it is not encrypted backup or a multi-device account. This demo is not suitable for storing sensitive medical records in a shared browser.

## Production path

1. Add reviewed regional composition data and newer USDA sources through a separate ingestion pipeline. Match foods by source ID and exact raw/cooked form, keep missing values unknown, and review servings and nutrient definitions.
2. Add secure accounts, server storage, data protection, consent, export and deletion controls with an explicit privacy policy and applicable legal review.
3. Add recipes, local foods, verified portions, a measured nutrition data QA process and optional barcode lookup after checking source license terms.
4. Validate supported devices and use native platform bridges for Android Health Connect and Apple HealthKit where required. Add telemedicine only with licensed professionals and jurisdiction-specific review.

The data are in `data/foods.js`, with first seven columns matching the original requested format: `[name, Nepali, category, kcal, protein g, carbs g, fat g]`. The extra fields are fiber, FDC ID, USDA publication date and a nutrient-ID map. `data/nutrients.js` maps nutrient IDs to source names and units. `data/provenance.json` records the source archive SHA-256 and coverage. Rebuild using `python3 tools/import_usda_sr.py <downloaded USDA CSV zip>`; see the download URL in the script. The ZIP does not include the original USDA archive. `index.html` is the PWA entry point.
