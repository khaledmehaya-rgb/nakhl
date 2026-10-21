# نخل — ملاحظات التطوير

Arabic-only, RTL, offline-first PWA for one user (the mother) to track her children. Hosted on GitHub Pages from `main` / root. No build step, no backend, no external requests at runtime.

## Architecture
- `index.html` — shell (header, `#app`, bottom sheet, toast). Loads `data.js` then `app.js`.
- `app.js` — vanilla JS. Hash routing: `#/`, `#/child/<id>/<tab>` (tabs: summary, quran, growth, vax, dev, tips), `#/settings`, `#/edit/<id|new>`. Views return HTML strings; events via `data-act` (click) and `data-change` (change) delegated to the `ACT` map.
- State `S` saved as one object in IndexedDB (`nakhl` db, `kv` store, key `state`), localStorage fallback. Shape: see `blankState()`.
- `data.js` — SURAHS (114, ayah counts sum 6236), VACCINE_VISITS (Saudi MOH schedule by age in months), MILESTONES (CDC-based, Arabic), STAGES (age insights), PREG_CARDS.
- `who.json` — WHO LMS by month 0–228: `{hfa|wfa|bfa: {boy|girl: [[L,M,S], ...]}}`. 0–60 from WHO Child Growth Standards (anthro repo, sampled at day round(m*30.4375)); 61–228 from WHO 2007 reference (anthroplus repo). wfa ends at 120 months.
- `sw.js` — network-first cache; bump `CACHE` version when changing cached file list.
- Reminders are `.ics` files (share sheet / data URL), no push server.
- Backup/restore: JSON export via share sheet; import replaces state.

## Rules
- Never commit children's personal data (repo is public). Seed data lives only in a private `nakhl-start.json` given to the user.
- Keep UI text Arabic, western digits, Gregorian + Umm al-Qura Hijri dates.
- Health guidance stays general with "طبيب الأطفال هو المرجع".
- Test at 390×844 in light and dark before pushing.
