# Booking grupperom NTNU

Statisk nettside (GitHub Pages) som koordinerer hvem i gruppa som skal booke grupperom.

## Krav
- Vise hvem som er neste til å booke (rotasjon)
- Kalender (2 uker frem) med økter 08:00–12:00 og 12:00–16:00
- Kun 4-timers intervaller
- Maks 4 aktive bookinger per person
- Maks 14 dager frem i tid
- Lage bruker eller velge eksisterende person ("logg inn")
- Registrere tid og sted (rom)

## Teknologi
- Ren HTML/CSS/JS, ingen byggesteg (GitHub Pages)
- Lagring: Firebase Firestore (delt) når config er satt, ellers localStorage (lokal demo)
