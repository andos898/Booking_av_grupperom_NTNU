---
quick_id: 261029-e0c
status: complete
commit: 8c824e9
---

# Summary: Booking-side for grupperom

Statisk side (GitHub Pages) med kø for hvem som booker neste, 14-dagers kalender (08–12 / 12–16), velg/lag bruker, maks 4 aktive bookinger per person og maks 14 dager frem.

## Filer
- `index.html`, `css/style.css`, `js/app.js` – UI
- `js/rules.js` – regler + kø (rene funksjoner)
- `js/store.js` – Firestore (delt) / localStorage (fallback)
- `js/config.js` – Firebase-config (tom = lokal demo)
- `tests/rules.test.mjs` – 9 tester, alle grønne
- `README.md` – GitHub Pages + Firebase-oppsett

## Verifisert
- `npm test`: 9/9 bestått
- Headless Chrome-skjermbilder på desktop og 390px mobil med testdata: kø, kalender-chips og "Mine bookinger" vises riktig

## Begrensninger
- Ingen autentisering, man velger bare navn. Regler håndheves på klienten.
- Delt lagring krever at brukeren setter opp Firebase (se README).
