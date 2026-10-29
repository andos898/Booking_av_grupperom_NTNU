import { test } from "node:test";
import assert from "node:assert/strict";
import { validateBooking, bookingQueue, isActive, toISODate, addDays, suggestedSlots, isDayCovered, dateRange, blockedPeriods } from "../js/rules.js";

const now = new Date(2026, 9, 29, 9, 0); // tor 29. okt 2026 kl 09:00
const day = (n) => toISODate(addDays(now, n));
const base = { personId: "a", date: day(1), slot: "am", room: "S21" };

test("gyldig booking godtas", () => {
  assert.equal(validateBooking(base, [], now), null);
});

test("kun 08-12 og 12-16", () => {
  assert.match(validateBooking({ ...base, slot: "kveld" }, [], now), /4-timers/);
});

test("maks 14 dager frem", () => {
  assert.equal(validateBooking({ ...base, date: day(14) }, [], now), null);
  assert.match(validateBooking({ ...base, date: day(15) }, [], now), /14 dager/);
});

test("ikke økter som har startet", () => {
  assert.match(validateBooking({ ...base, date: day(0), slot: "am" }, [], now), /startet/);
  assert.equal(validateBooking({ ...base, date: day(0), slot: "pm" }, [], now), null);
});

test("maks 4 aktive bookinger per person", () => {
  const bookings = [1, 2, 3, 4].map((n) => ({ personId: "a", date: day(n + 1), slot: "pm", room: "R" + n }));
  assert.match(validateBooking(base, bookings, now), /maks/);
  // passerte bookinger teller ikke
  const old = bookings.map((b) => ({ ...b, date: day(-5) }));
  assert.equal(validateBooking(base, old, now), null);
});

test("samme rom i samme økt blokkeres", () => {
  const bookings = [{ personId: "b", date: base.date, slot: "am", room: " s21 " }];
  assert.match(validateBooking(base, bookings, now), /allerede booket/);
});

test("isActive til økta er ferdig", () => {
  assert.equal(isActive({ date: day(0), slot: "am" }, now), true);
  assert.equal(isActive({ date: day(0), slot: "am" }, new Date(2026, 9, 29, 12, 0)), false);
});

test("køen: færrest aktive, så lengst siden sist", () => {
  const people = [
    { id: "a", name: "A", createdAt: 1 },
    { id: "b", name: "B", createdAt: 2 },
    { id: "c", name: "C", createdAt: 3 },
  ];
  const bookings = [
    { personId: "a", date: day(1), slot: "am", room: "X", createdAt: 100 },
    { personId: "b", date: day(-3), slot: "am", room: "X", createdAt: 50 },
  ];
  const q = bookingQueue(people, bookings, now).map((x) => x.person.id);
  assert.deepEqual(q, ["c", "b", "a"]);
});

test("køen hopper over de som har maks", () => {
  const people = [{ id: "a", name: "A" }, { id: "b", name: "B" }];
  const bookings = [1, 2, 3, 4].map((n) => ({ personId: "a", date: day(n), slot: "pm", room: "R" }));
  assert.deepEqual(bookingQueue(people, bookings, now).map((x) => x.person.id), ["b"]);
});

test("16-20 er gyldig økt og aktiv til kl 20", () => {
  assert.equal(validateBooking({ ...base, slot: "eve" }, [], now), null);
  assert.equal(isActive({ date: day(0), slot: "eve" }, new Date(2026, 9, 29, 19, 0)), true);
  assert.equal(isActive({ date: day(0), slot: "eve" }, new Date(2026, 9, 29, 20, 0)), false);
});

test("forslag: neste udekkede 08-16-økter, hopper over helg og 16-20", () => {
  // tor 09:00: 08-12 har startet → tor 12-16, fre 08-12, fre 12-16, man 08-12
  assert.deepEqual(suggestedSlots([], 4, now), [
    { date: day(0), slot: "pm" },
    { date: day(1), slot: "am" },
    { date: day(1), slot: "pm" },
    { date: day(4), slot: "am" },
  ]);
});

test("forslag: dag dekket 08-16 → neste dag, selv om 16-20 er ledig", () => {
  const bookings = [
    { personId: "a", date: day(0), slot: "pm", room: "X" },
    { personId: "b", date: day(1), slot: "am", room: "X" },
    { personId: "c", date: day(1), slot: "pm", room: "X" },
  ];
  assert.equal(isDayCovered(day(1), bookings), true);
  assert.equal(isDayCovered(day(0), bookings), false);
  assert.deepEqual(suggestedSlots(bookings, 1, now), [{ date: day(4), slot: "am" }]);
});

test("sperrede dager kan ikke bookes og hoppes over i forslag", () => {
  const blocked = dateRange(day(0), day(13)).map((date) => ({ date, reason: "Fullbooket" }));
  assert.match(validateBooking(base, [], now, blocked), /sperret \(Fullbooket\)/);
  assert.equal(validateBooking({ ...base, date: day(14) }, [], now, blocked), null);
  // 14 dager frem er fre 12. nov – første forslag
  assert.deepEqual(suggestedSlots([], 1, now, blocked), [{ date: day(14), slot: "am" }]);
});

test("dateRange og blockedPeriods", () => {
  assert.deepEqual(dateRange("2026-10-30", "2026-11-02"), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  const periods = blockedPeriods([
    { date: "2026-11-03", reason: "x" }, { date: "2026-11-02", reason: "x" }, { date: "2026-11-05", reason: "x" },
  ]);
  assert.deepEqual(periods.map((p) => [p.from, p.to]), [["2026-11-02", "2026-11-03"], ["2026-11-05", "2026-11-05"]]);
});
