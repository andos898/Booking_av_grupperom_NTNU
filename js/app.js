// Versjon (v=16) i import-stiene tvinger nettleseren til å hente nye filer etter oppdatering.
// Øk tallet i index.html, app.js og store.js ved hver endring.
import { createStore } from "./store.js?v=16";
import { ROOM_SUGGESTIONS, BOOKING_URL } from "./config.js?v=16";
import {
  SLOTS, MAX_ACTIVE_BOOKINGS, MAX_DAYS_AHEAD,
  toISODate, parseISODate, addDays, slotById, slotStart,
  isActive, activeBookingsFor, validateBooking, bookingQueue,
  suggestedSlots, isDayCovered, blockedOn, dateRange, blockedPeriods, bookableFrom,
} from "./rules.js?v=16";

const USER_KEY = "grupperom-current-user";
const $ = (id) => document.getElementById(id);

let store;
let state = { people: [], bookings: [], blocked: [] };
let currentUserId = readUser();
let formTouched = false; // ikke overskriv dato/økt brukeren har valgt selv

function readUser() {
  try { return localStorage.getItem(USER_KEY) || ""; } catch { return ""; }
}
function writeUser(id) {
  currentUserId = id;
  try { localStorage.setItem(USER_KEY, id); } catch {}
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function hue(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

const dayFmt = new Intl.DateTimeFormat("nb-NO", { weekday: "short", day: "numeric", month: "short" });
const shortFmt = new Intl.DateTimeFormat("nb-NO", { weekday: "short" });

const slotText = (x) => `${dayFmt.format(parseISODate(x.date))} · ${slotById(x.slot).label}`;

// Køen med forslag: nr. 1 får første udekkede økt, nr. 2 den neste osv.
function queueWithSuggestions(now = new Date()) {
  const queue = bookingQueue(state.people, state.bookings, now);
  const sugg = suggestedSlots(state.bookings, queue.length, now, state.blocked);
  return queue.map((q, i) => ({ ...q, suggestion: sugg[i] || null }));
}

function personName(id) {
  return state.people.find((p) => p.id === id)?.name || "Ukjent";
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 2600);
}

// ---------- Render ----------

function render() {
  if (currentUserId && !state.people.some((p) => p.id === currentUserId) && state.people.length) writeUser("");
  renderUserPicker();
  prefillForm();
  renderQueue();
  renderFormHint();
  renderMine();
  renderCalendar();
  renderRooms();
  renderPeople();
  renderBlocked();
}

const periodText = (p) =>
  p.from === p.to ? dayFmt.format(parseISODate(p.from)) : `${dayFmt.format(parseISODate(p.from))} – ${dayFmt.format(parseISODate(p.to))}`;

function renderBlocked() {
  const todayISO = toISODate(new Date());
  const periods = blockedPeriods(state.blocked.filter((x) => x.date >= todayISO));
  $("blocked-count").textContent = periods.length ? `(${periods.length})` : "";
  $("blocked-list").innerHTML = periods.length
    ? periods.map((p) => `<li><span class="when"><b>${esc(periodText(p))}</b>
        <span class="muted">${p.reason ? esc(p.reason) : "Ingen grunn oppgitt"}</span></span>
        <button class="icon-btn" data-unblock="${esc(p.dates.join(","))}" title="Opphev sperring" aria-label="Opphev sperring ${esc(periodText(p))}">✕</button></li>`).join("")
    : `<li class="muted">Ingen sperrede dager.</li>`;
}

function renderPeople() {
  const people = [...state.people].sort((a, b) => a.name.localeCompare(b.name, "nb"));
  $("people-count").textContent = people.length ? `(${people.length})` : "";
  $("people-list").innerHTML = people.length
    ? people.map((p) => {
        const n = activeBookingsFor(p.id, state.bookings).length;
        return `<li><span class="when"><b>${esc(p.name)}${p.id === currentUserId ? ` <span class="you">deg</span>` : ""}</b>
          <span class="muted">${n} ${n === 1 ? "aktiv booking" : "aktive bookinger"}</span></span>
          <button class="icon-btn" data-delete-person="${esc(p.id)}" title="Fjern bruker" aria-label="Fjern ${esc(p.name)}">✕</button></li>`;
      }).join("")
    : `<li class="muted">Ingen brukere ennå.</li>`;
}

function renderUserPicker() {
  const sel = $("current-user");
  const people = [...state.people].sort((a, b) => a.name.localeCompare(b.name, "nb"));
  sel.innerHTML =
    `<option value="">— Velg deg selv —</option>` +
    people.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
  sel.value = currentUserId;
}

function renderQueue() {
  const queue = queueWithSuggestions();
  const full = state.people.filter((p) => !queue.some((q) => q.person.id === p.id));

  const top = queue.slice(0, 3);
  $("next-three").innerHTML = top.map((q, i) => {
    const me = q.person.id === currentUserId;
    return `<li class="${me ? "me" : ""}">
      <span class="rank">${i + 1}</span>
      <span class="name">${esc(q.person.name)}${me ? ` <span class="you">deg</span>` : ""}
        ${suggestionHTML(q.suggestion)}</span>
      <span class="muted small">${q.active}/${MAX_ACTIVE_BOOKINGS}</span></li>`;
  }).join("");

  if (!state.people.length) $("next-hint").textContent = "Lag en bruker for å komme i gang.";
  else if (!queue.length) $("next-hint").textContent = `Alle har ${MAX_ACTIVE_BOOKINGS} aktive bookinger.`;
  else $("next-hint").textContent = "";

  const rest = queue.slice(3);
  $("rest").hidden = !rest.length && !full.length;
  $("queue").innerHTML =
    rest.map((q) => `<li class="${q.person.id === currentUserId ? "me" : ""}">
        <span class="name">${esc(q.person.name)} ${suggestionHTML(q.suggestion)}</span>
        <span class="muted small">${q.active}/${MAX_ACTIVE_BOOKINGS}</span></li>`).join("") +
    full.map((p) => `<li class="full ${p.id === currentUserId ? "me" : ""}">
        <span class="name">${esc(p.name)}</span><span class="small">full</span></li>`).join("");
}

function suggestionHTML(x) {
  if (!x) return "";
  const opens = bookableFrom(x.date);
  return `<span class="target">${esc(slotText(x))}</span>` +
    (opens ? `<span class="opens">kan bookes fra ${esc(dayFmt.format(parseISODate(opens)))}</span>` : "");
}

// Fyll skjemaet med forslaget til innlogget bruker, så lenge de ikke har valgt selv
function prefillForm() {
  if (formTouched) return;
  const mine = queueWithSuggestions().find((q) => q.person.id === currentUserId)?.suggestion;
  if (!mine || bookableFrom(mine.date)) return;
  $("f-date").value = mine.date;
  document.querySelector(`input[name="slot"][value="${mine.slot}"]`).checked = true;
}

function renderFormHint() {
  const date = $("f-date").value;
  const slot = new FormData($("booking-form")).get("slot");
  const next = suggestedSlots(state.bookings, 1, new Date(), state.blocked)[0];
  const useNext = next && !bookableFrom(next.date) ? ` <button type="button" class="link" data-suggest="${next.date}|${next.slot}">Book heller ${esc(slotText(next))}</button>` : "";
  const block = date && blockedOn(date, state.blocked);
  let msg = "";
  if (block) {
    msg = `Denne dagen er sperret${block.reason ? ` (${esc(block.reason)})` : ""}.${useNext}`;
  } else if (date && isDayCovered(date, state.bookings)) {
    msg = `08–16 er allerede dekket denne dagen – 16–20 trengs ikke.${useNext}`;
  } else if (slot === "eve") {
    msg = `16–20 trengs vanligvis ikke – prioriter 08–12 og 12–16.${useNext}`;
  } else if (date && state.bookings.some((b) => b.date === date && b.slot === slot)) {
    msg = `Denne økta er allerede booket av noen.${useNext}`;
  }
  $("form-hint").innerHTML = msg;
  $("form-hint").hidden = !msg;
}

function renderMine() {
  const now = new Date();
  const mine = activeBookingsFor(currentUserId, state.bookings, now).sort((a, b) => slotStart(a) - slotStart(b));
  $("my-count").textContent = currentUserId ? `${mine.length}/${MAX_ACTIVE_BOOKINGS}` : "";
  if (!currentUserId) {
    $("my-bookings").innerHTML = `<li class="muted">Velg hvem du er øverst.</li>`;
    return;
  }
  $("my-bookings").innerHTML = mine.length
    ? mine.map((b) => `<li>
        <span class="when"><b>${esc(dayFmt.format(parseISODate(b.date)))} · ${slotById(b.slot).label}</b>
        <span class="muted">${esc(b.room)}</span></span>
        <button class="icon-btn" data-delete="${esc(b.id)}" title="Slett booking" aria-label="Slett booking">✕</button></li>`).join("")
    : `<li class="muted">Ingen aktive bookinger.</li>`;
}

function renderCalendar() {
  const now = new Date();
  const today = addDays(now, 0);
  const last = addDays(today, MAX_DAYS_AHEAD);
  const start = addDays(today, -((today.getDay() + 6) % 7)); // mandag denne uka
  const end = addDays(last, 6 - ((last.getDay() + 6) % 7)); // søndag siste uke
  const todayISO = toISODate(today);

  const byKey = new Map();
  for (const b of state.bookings) {
    const k = `${b.date}|${b.slot}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(b);
  }

  let html = "";
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const iso = toISODate(d);
    const inRange = d >= today && d <= last;
    const wd = (d.getDay() + 6) % 7;
    const block = inRange && blockedOn(iso, state.blocked);
    const covered = inRange && !block && isDayCovered(iso, state.bookings);
    const cls = ["day", covered && "covered", block && "blocked", wd >= 5 && "weekend", !inRange && "out", d < today && "pad", iso === todayISO && "today"].filter(Boolean).join(" ");
    html += `<div class="${cls}">
      <div class="day-label"><span>${d.getDate()}.${d.getMonth() + 1}</span><span class="dname">${esc(shortFmt.format(d))}</span>${covered ? `<span class="done" title="08–16 er dekket">✓ dekket</span>` : ""}${block ? `<span class="blocked-tag" title="${esc(block.reason || "Sperret")}">Sperret</span>` : ""}</div>
      <div class="day-slots">`;
    for (const s of SLOTS) {
      const list = (byKey.get(`${iso}|${s.id}`) || []).sort((a, b) => a.room.localeCompare(b.room, "nb"));
      const open = inRange && !block && slotStart({ date: iso, slot: s.id }) > now;
      html += `<div class="slot ${open ? "open" : ""}" ${open ? `data-date="${iso}" data-slot="${s.id}"` : ""}>
        <span class="slot-time">${s.label}</span>
        ${list.map((b) => {
          const mine = b.personId === currentUserId;
          const canDelete = mine && isActive(b, now);
          return `<div class="chip ${mine ? "mine-chip" : ""}" style="--h:${hue(b.personId)}" title="${esc(personName(b.personId))} – ${esc(b.room)}">
            <span class="txt"><b>${esc(personName(b.personId))}</b><span class="sep"> · </span><span class="room">${esc(b.room)}</span></span>
            ${canDelete ? `<button class="icon-btn" data-delete="${esc(b.id)}" aria-label="Slett booking">✕</button>` : ""}</div>`;
        }).join("")}
      </div>`;
    }
    html += `</div></div>`;
  }
  $("calendar").innerHTML = html;
}

function renderRooms() {
  const rooms = new Set(ROOM_SUGGESTIONS);
  for (const b of state.bookings) rooms.add(b.room);
  $("room-list").innerHTML = [...rooms].sort((a, b) => a.localeCompare(b, "nb")).map((r) => `<option value="${esc(r)}"></option>`).join("");
}

// ---------- Handlers ----------

function setupForm() {
  const today = new Date();
  const dateInput = $("f-date");
  dateInput.min = toISODate(today);
  dateInput.max = toISODate(addDays(today, MAX_DAYS_AHEAD));
  dateInput.value = toISODate(addDays(today, 1));

  $("booking-form").addEventListener("change", (e) => {
    if (e.target === dateInput || e.target.name === "slot") formTouched = true;
    renderFormHint();
  });
  $("form-hint").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-suggest]");
    if (!btn) return;
    const [date, slot] = btn.dataset.suggest.split("|");
    dateInput.value = date;
    document.querySelector(`input[name="slot"][value="${slot}"]`).checked = true;
    formTouched = true;
    renderFormHint();
  });

  $("booking-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const booking = {
      personId: currentUserId,
      date: dateInput.value,
      slot: new FormData(e.target).get("slot"),
      room: $("f-room").value.trim().replace(/\s+/g, " "),
    };
    const err = validateBooking(booking, state.bookings, new Date(), state.blocked);
    $("form-error").textContent = err || "";
    if (err) return;
    try {
      await store.addBooking(booking);
      $("f-room").value = "";
      formTouched = false;
      toast(`Booket ${slotById(booking.slot).label} ${dayFmt.format(parseISODate(booking.date))} – ${booking.room}`);
    } catch (ex) {
      $("form-error").textContent = ex.message;
    }
  });

  $("calendar").addEventListener("click", (e) => {
    if (e.target.closest("[data-delete]")) return;
    const slot = e.target.closest(".slot.open");
    if (!slot) return;
    dateInput.value = slot.dataset.date;
    document.querySelector(`input[name="slot"][value="${slot.dataset.slot}"]`).checked = true;
    formTouched = true;
    renderFormHint();
    $("form-error").textContent = currentUserId ? "" : "Velg hvem du er før du booker.";
    $("booking-form").scrollIntoView({ behavior: "smooth", block: "center" });
    $("f-room").focus({ preventScroll: true });
  });

  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-delete]");
    if (!btn) return;
    if (!confirm("Slette denne bookingen?")) return;
    await store.deleteBooking(btn.dataset.delete);
    toast("Booking slettet");
  });
}

function setupUsers() {
  const dialog = $("user-dialog");
  $("current-user").addEventListener("change", (e) => {
    writeUser(e.target.value);
    formTouched = false;
    $("form-error").textContent = "";
    render();
  });
  $("new-user-btn").addEventListener("click", () => {
    $("u-name").value = "";
    $("user-error").textContent = "";
    dialog.showModal();
  });
  $("user-cancel").addEventListener("click", () => dialog.close());
  $("people-list").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-delete-person]");
    if (!btn) return;
    const id = btn.dataset.deletePerson;
    const n = state.bookings.filter((b) => b.personId === id).length;
    const msg = `Fjerne ${personName(id)}?` + (n ? ` ${n} booking${n > 1 ? "er" : ""} slettes også.` : "");
    if (!confirm(msg)) return;
    try {
      await store.deletePerson(id);
      if (id === currentUserId) writeUser("");
      render();
      toast("Bruker fjernet");
    } catch (ex) {
      alert("Kunne ikke fjerne brukeren: " + ex.message);
    }
  });
  $("user-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("u-name").value.trim().replace(/\s+/g, " ");
    if (!name) return ($("user-error").textContent = "Skriv inn et navn.");
    if (state.people.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      return ($("user-error").textContent = "Det finnes allerede en bruker med det navnet – velg den i lista.");
    }
    const p = await store.addPerson(name);
    writeUser(p.id);
    dialog.close();
    render();
    toast(`Velkommen, ${name}!`);
  });
}

function setupBlocked() {
  const today = toISODate(new Date());
  const from = $("b-from");
  const to = $("b-to");
  from.min = to.min = today;
  from.value = today;
  from.addEventListener("change", () => {
    to.min = from.value || today;
    if (to.value && to.value < from.value) to.value = from.value;
  });

  $("blocked-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!from.value) return ($("blocked-error").textContent = "Velg en fra-dato.");
    if (to.value && to.value < from.value) return ($("blocked-error").textContent = "Til-dato må være etter fra-dato.");
    const dates = dateRange(from.value, to.value || from.value);
    const reason = $("b-reason").value.trim().replace(/\s+/g, " ");
    const taken = state.bookings.filter((b) => dates.includes(b.date)).length;
    if (taken && !confirm(`Det finnes ${taken} booking${taken > 1 ? "er" : ""} i perioden. De blir liggende. Sperre likevel?`)) return;
    $("blocked-error").textContent = "";
    try {
      await store.blockDates(dates, reason);
      to.value = "";
      $("b-reason").value = "";
      toast(`Sperret ${dates.length} dag${dates.length > 1 ? "er" : ""}`);
    } catch (ex) {
      $("blocked-error").textContent = "Kunne ikke sperre: " + ex.message;
    }
  });

  $("blocked-list").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-unblock]");
    if (!btn) return;
    if (!confirm("Oppheve sperringen?")) return;
    try {
      await store.unblockDates(btn.dataset.unblock.split(","));
      toast("Sperring opphevet");
    } catch (ex) {
      alert("Kunne ikke oppheve: " + ex.message);
    }
  });
}

async function main() {
  document.querySelectorAll(".booking-link").forEach((a) => (a.href = BOOKING_URL));
  setupForm();
  setupUsers();
  setupBlocked();
  store = await createStore();
  const badge = $("mode-badge");
  badge.textContent = store.mode === "firebase" ? "Delt (Firebase)" : "Lokal demo";
  badge.classList.toggle("local", store.mode !== "firebase");
  badge.title = store.mode === "firebase" ? "Alle ser de samme bookingene" : "Data lagres bare i denne nettleseren – sett opp Firebase i js/config.js for å dele";
  store.subscribe((s) => {
    state = s;
    render();
  });
  // Oppdater "aktiv"-status og kalender når tiden går
  setInterval(render, 60_000);
}

main();
