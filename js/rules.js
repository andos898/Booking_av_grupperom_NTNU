// Rene regel-funksjoner (ingen DOM / lagring) – testes i tests/rules.test.mjs

export const SLOTS = [
  { id: "am", label: "08:00–12:00", start: 8, end: 12 },
  { id: "pm", label: "12:00–16:00", start: 12, end: 16 },
  { id: "eve", label: "16:00–20:00", start: 16, end: 20 },
];

export const MAX_ACTIVE_BOOKINGS = 4;
export const MAX_DAYS_AHEAD = 14;

export function slotById(id) {
  return SLOTS.find((s) => s.id === id) || null;
}

// "YYYY-MM-DD" i lokal tid
export function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISODate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d, n) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() + n);
  return r;
}

export function slotEnd(booking) {
  const slot = slotById(booking.slot);
  const d = parseISODate(booking.date);
  d.setHours(slot ? slot.end : 24, 0, 0, 0);
  return d;
}

export function slotStart(booking) {
  const slot = slotById(booking.slot);
  const d = parseISODate(booking.date);
  d.setHours(slot ? slot.start : 0, 0, 0, 0);
  return d;
}

// En booking er aktiv til økta er ferdig
export function isActive(booking, now = new Date()) {
  return slotEnd(booking) > now;
}

export function activeBookingsFor(personId, bookings, now = new Date()) {
  return bookings.filter((b) => b.personId === personId && isActive(b, now));
}

export function normalizeRoom(room) {
  return String(room || "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Returnerer en feilmelding (string) hvis bookingen ikke er lov, ellers null.
 */
export function validateBooking({ personId, date, slot, room }, bookings, now = new Date(), blocked = []) {
  if (!personId) return "Velg hvem du er før du booker.";
  if (!slotById(slot)) return "Du kan bare booke 4-timers økter: 08:00–12:00, 12:00–16:00 eller 16:00–20:00.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return "Velg en dato.";
  if (!normalizeRoom(room)) return "Skriv inn hvilket rom (sted) du har booket.";

  const candidate = { date, slot };
  if (slotStart(candidate) <= now) return "Økta har allerede startet eller er passert.";

  const lastDay = addDays(now, MAX_DAYS_AHEAD);
  if (parseISODate(date) > lastDay) return `Du kan maks booke ${MAX_DAYS_AHEAD} dager frem i tid.`;

  const block = blockedOn(date, blocked);
  if (block) return `Denne dagen er sperret${block.reason ? ` (${block.reason})` : ""} – den kan ikke bookes.`;

  if (activeBookingsFor(personId, bookings, now).length >= MAX_ACTIVE_BOOKINGS) {
    return `Du har allerede ${MAX_ACTIVE_BOOKINGS} aktive bookinger (maks).`;
  }

  const sameSlot = bookings.filter((b) => b.date === date && b.slot === slot);
  if (sameSlot.some((b) => normalizeRoom(b.room) === normalizeRoom(room))) {
    return "Det rommet er allerede booket i denne økta.";
  }
  if (sameSlot.some((b) => b.personId === personId)) {
    return "Du har allerede en booking i denne økta.";
  }
  return null;
}

// Sperrede dager: [{ date: "YYYY-MM-DD", reason }] – f.eks. når NTNU er fullbooket
export function blockedOn(date, blocked = []) {
  return blocked.find((x) => x.date === date) || null;
}

// Alle datoer fra og med `from` til og med `to` ("YYYY-MM-DD")
export function dateRange(from, to) {
  const out = [];
  for (let d = parseISODate(from), end = parseISODate(to || from); d <= end; d = addDays(d, 1)) out.push(toISODate(d));
  return out;
}

// Slår sammen påfølgende sperrede dager med samme grunn til perioder
export function blockedPeriods(blocked) {
  const sorted = [...blocked].sort((a, b) => a.date.localeCompare(b.date));
  const out = [];
  for (const x of sorted) {
    const last = out[out.length - 1];
    if (last && (last.reason || "") === (x.reason || "") && toISODate(addDays(parseISODate(last.to), 1)) === x.date) {
      last.to = x.date;
      last.dates.push(x.date);
    } else {
      out.push({ from: x.date, to: x.date, reason: x.reason || "", dates: [x.date] });
    }
  }
  return out;
}

// Første dag en dato kan bookes (MAX_DAYS_AHEAD dager før), eller null hvis den kan bookes nå
export function bookableFrom(date, now = new Date()) {
  const from = addDays(parseISODate(date), -MAX_DAYS_AHEAD);
  return from > addDays(now, 0) ? toISODate(from) : null;
}

// Økter gruppa trenger dekket hver dag. 16–20 er valgfri og foreslås ikke.
export const CORE_SLOTS = ["am", "pm"];

export function isWeekend(d) {
  return d.getDay() === 0 || d.getDay() === 6;
}

// En dag er dekket når alle kjerneøktene (08–16) har minst én booking
export function isDayCovered(date, bookings) {
  return CORE_SLOTS.every((slot) => bookings.some((b) => b.date === date && b.slot === slot));
}

/**
 * De neste udekkede kjerneøktene (hverdager 08–12 / 12–16) i rekkefølge,
 * Brukes til å foreslå hva neste i køen skal booke. Går forbi booking-vinduet
 * (f.eks. etter sperrede dager), så alle i køen får en dato – se bookableFrom.
 */
export const SUGGEST_DAYS_AHEAD = 60;

export function suggestedSlots(bookings, count, now = new Date(), blocked = []) {
  const out = [];
  for (let i = 0; i <= SUGGEST_DAYS_AHEAD && out.length < count; i++) {
    const d = addDays(now, i);
    if (isWeekend(d)) continue;
    const date = toISODate(d);
    if (blockedOn(date, blocked)) continue;
    for (const slot of CORE_SLOTS) {
      if (out.length >= count) break;
      if (slotStart({ date, slot }) <= now) continue;
      if (bookings.some((b) => b.date === date && b.slot === slot)) continue;
      out.push({ date, slot });
    }
  }
  return out;
}

/**
 * Køen for hvem som skal booke neste gang.
 * Rotasjon: færrest aktive bookinger først, deretter den som har ventet lengst
 * siden sist de booket, deretter den som ble lagt til først.
 * Personer som har nådd maks er ikke med i køen.
 */
export function bookingQueue(people, bookings, now = new Date()) {
  const lastBooked = new Map();
  for (const b of bookings) {
    const t = b.createdAt || 0;
    if (t > (lastBooked.get(b.personId) || 0)) lastBooked.set(b.personId, t);
  }
  return people
    .map((p) => ({
      person: p,
      active: activeBookingsFor(p.id, bookings, now).length,
      last: lastBooked.get(p.id) || 0,
    }))
    .filter((x) => x.active < MAX_ACTIVE_BOOKINGS)
    .sort((a, b) => a.active - b.active || a.last - b.last || (a.person.createdAt || 0) - (b.person.createdAt || 0));
}
