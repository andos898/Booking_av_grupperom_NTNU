// Rene regel-funksjoner (ingen DOM / lagring) – testes i tests/rules.test.mjs

export const SLOTS = [
  { id: "am", label: "08:00–12:00", start: 8, end: 12 },
  { id: "pm", label: "12:00–16:00", start: 12, end: 16 },
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
export function validateBooking({ personId, date, slot, room }, bookings, now = new Date()) {
  if (!personId) return "Velg hvem du er før du booker.";
  if (!slotById(slot)) return "Du kan bare booke 4-timers økter: 08:00–12:00 eller 12:00–16:00.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return "Velg en dato.";
  if (!normalizeRoom(room)) return "Skriv inn hvilket rom (sted) du har booket.";

  const candidate = { date, slot };
  if (slotStart(candidate) <= now) return "Økta har allerede startet eller er passert.";

  const lastDay = addDays(now, MAX_DAYS_AHEAD);
  if (parseISODate(date) > lastDay) return `Du kan maks booke ${MAX_DAYS_AHEAD} dager frem i tid.`;

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
