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

  const block = blockedOn(date, blocked, slot);
  if (block) return `Denne ${isFullDayBlock(block) ? "dagen" : "økta"} er sperret${block.reason ? ` (${block.reason})` : ""} – den kan ikke bookes.`;

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

// Sperrede dager: [{ date: "YYYY-MM-DD", reason, slots }] – f.eks. når NTNU er fullbooket.
// slots = øktene som er sperret; mangler den, er hele dagen sperret.
export const BLOCK_PARTS = {
  day: SLOTS.map((s) => s.id),
  am: ["am"], // før 12
  pm: ["pm", "eve"], // etter 12
};

export function blockedSlotIds(x) {
  return x.slots?.length ? x.slots : BLOCK_PARTS.day;
}

export function isFullDayBlock(x) {
  return BLOCK_PARTS.day.every((s) => blockedSlotIds(x).includes(s));
}

export function blockPartLabel(x) {
  if (isFullDayBlock(x)) return "hele dagen";
  return blockedSlotIds(x).includes("am") ? "før 12" : "etter 12";
}

// Sperringen for dagen, eller bare hvis den gjelder `slot` når den er gitt
export function blockedOn(date, blocked = [], slot) {
  const x = blocked.find((b) => b.date === date);
  return x && (!slot || blockedSlotIds(x).includes(slot)) ? x : null;
}

// Øktene som blir sperret når `slots` legges til en eventuell eksisterende sperring
export function mergeBlockSlots(existing, slots) {
  const all = new Set([...(existing ? blockedSlotIds(existing) : []), ...slots]);
  return SLOTS.map((s) => s.id).filter((id) => all.has(id));
}

// Alle datoer fra og med `from` til og med `to` ("YYYY-MM-DD")
export function dateRange(from, to) {
  const out = [];
  for (let d = parseISODate(from), end = parseISODate(to || from); d <= end; d = addDays(d, 1)) out.push(toISODate(d));
  return out;
}

// Slår sammen påfølgende sperrede dager med samme grunn og samme økter til perioder
export function blockedPeriods(blocked) {
  const sorted = [...blocked].sort((a, b) => a.date.localeCompare(b.date));
  const out = [];
  for (const x of sorted) {
    const last = out[out.length - 1];
    const slots = blockedSlotIds(x);
    if (last && (last.reason || "") === (x.reason || "") && last.slots.join() === slots.join() &&
        toISODate(addDays(parseISODate(last.to), 1)) === x.date) {
      last.to = x.date;
      last.dates.push(x.date);
    } else {
      out.push({ from: x.date, to: x.date, reason: x.reason || "", slots, dates: [x.date] });
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

// En dag er dekket når alle kjerneøktene (08–16) som ikke er sperret har minst én booking
export function isDayCovered(date, bookings, blocked = []) {
  const needed = CORE_SLOTS.filter((slot) => !blockedOn(date, blocked, slot));
  return needed.length > 0 && needed.every((slot) => bookings.some((b) => b.date === date && b.slot === slot));
}

/**
 * De neste udekkede kjerneøktene (alle dager, også helg, 08–12 / 12–16) i rekkefølge,
 * Brukes til å foreslå hva neste i køen skal booke. Går forbi booking-vinduet
 * (f.eks. etter sperrede dager), så alle i køen får en dato – se bookableFrom.
 */
export const SUGGEST_DAYS_AHEAD = 60;

export function suggestedSlots(bookings, count, now = new Date(), blocked = []) {
  const out = [];
  for (let i = 0; i <= SUGGEST_DAYS_AHEAD && out.length < count; i++) {
    const date = toISODate(addDays(now, i));
    for (const slot of CORE_SLOTS) {
      if (out.length >= count) break;
      if (slotStart({ date, slot }) <= now) continue;
      if (blockedOn(date, blocked, slot)) continue;
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
