# Grupperom-booking

En enkel nettside for gruppa som viser **hvem som skal booke grupperom neste gang**, og en kalender over hva som er booket.

## Regler

- Bare 4-timers økter: **08:00–12:00** og **12:00–16:00**
- Maks **4 aktive bookinger** per person (en booking slutter å telle når økta er ferdig)
- Maks **14 dager** frem i tid
- Samme rom kan ikke bookes to ganger i samme økt

**Neste til å booke** er den som har færrest aktive bookinger. Er det likt, er det den som har ventet lengst siden sist hen booket. De som har nådd maks er ikke med i køen.

## Bruk

1. Trykk **+ Ny bruker** og skriv navnet ditt, eller velg deg selv i lista øverst. Valget huskes i nettleseren.
2. Klikk på en ledig økt i kalenderen (eller fyll inn skjemaet), skriv inn rommet du har booket, og trykk **Legg inn booking**.
3. Egne bookinger kan slettes med ✕.

Det er ingen passord. Man velger bare hvem man er, så dette er laget for en gruppe som stoler på hverandre.

## Publisere på GitHub Pages

1. Lag et repo på GitHub og push koden:
   ```bash
   git remote add origin https://github.com/<brukernavn>/booking_rom_ntnu.git
   git push -u origin main
   ```
2. Gå til **Settings → Pages** i repoet. Under *Build and deployment* velger du **Deploy from a branch**, deretter `main` og `/ (root)`.
3. Etter et minutt er siden ute på `https://<brukernavn>.github.io/booking_rom_ntnu/`.

## Delt lagring med Firebase (anbefalt)

GitHub Pages kan bare vise statiske filer. Uten noe mer oppsett lagres data derfor kun i **din egen nettleser** (merket «Lokal demo»). For at alle i gruppa skal se de samme bookingene, kobler du på Firebase Firestore. Det er gratis for så lite bruk.

1. Gå til <https://console.firebase.google.com>, lag et prosjekt og legg til en **Web-app** (`</>`).
2. Kopier `firebaseConfig`-objektet inn i `js/config.js` som `FIREBASE_CONFIG`.
3. Gå til **Firestore Database → Create database**, og velg en region i Europa (f.eks. `eur3`).
4. Under **Rules** limer du inn dette og trykker *Publish*:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{db}/documents {
       match /people/{id}   { allow read, create: if true; }
       match /bookings/{id} { allow read, create, delete: if true; }
     }
   }
   ```
5. Commit og push. Merket øverst skal da vise «Delt (Firebase)».

> Firebase-nøkkelen i `config.js` er ikke hemmelig, men reglene over er åpne. Alle som har lenken kan legge inn og slette bookinger. Reglene (maks 4, 14 dager osv.) sjekkes i nettleseren, ikke på serveren.

## Utvikling

```bash
npm test                 # kjører reglene i tests/rules.test.mjs
python -m http.server    # åpne http://localhost:8000
```

Siden må åpnes via en webserver, ikke direkte som fil, fordi den bruker JavaScript-moduler.

Filer:
- `index.html`, `css/style.css`: siden
- `js/app.js`: UI og hendelser
- `js/rules.js`: regler og kø-logikk (rene funksjoner)
- `js/store.js`: lagring (Firestore eller localStorage)
- `js/config.js`: Firebase-oppsett og romforslag
