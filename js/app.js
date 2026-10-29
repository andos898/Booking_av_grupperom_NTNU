// Versjon (v=9) i import-stiene tvinger nettleseren til å hente nye filer etter oppdatering.
// Øk tallet i index.html, app.js og store.js ved hver endring.
import { createStore } from "./store.js?v=9";
import { ROOM_SUGGESTIONS, BOOKING_URL } from "./config.js?v=9";
import {
  SLOTS, MAX_ACTIVE_BOOKINGS, MAX_DAYS_AHEAD,
  toISODate, parseISODate, addDays, slotById, slotStart,
  isActive, activeBookingsFor, validateBooking, bookingQueue,
} from "./rules.js?v=9";

const USER_KEY = "grupperom-current-user";
const MANAGE = "__manage__"; // spesialvalg i "Du er"-menyen
const $ = (id) => document.getElementById(id);

let store;
let state = { people: [], bookings: [] };
let currentUserId = readUser();

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
  renderQueue();
  renderMine();
  renderCalendar();
  renderRooms();
  renderPeople();
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
    people.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("") +
    (people.length ? `<option disabled>──────────</option><option value="${MANAGE}">⚙ Administrer brukere…</option>` : "");
  sel.value = currentUserId;
}

function renderQueue() {
  const now = new Date();
  const queue = bookingQueue(state.people, state.bookings, now);
  const full = state.people.filter((p) => !queue.some((q) => q.person.id === p.id));

  const top = queue.slice(0, 3);
  $("next-three").innerHTML = top.map((q, i) => {
    const me = q.person.id === currentUserId;
    return `<li class="${me ? "me" : ""}">
      <span class="rank">${i + 1}</span>
      <span class="name">${esc(q.person.name)}${me ? ` <span class="you">deg</span>` : ""}</span>
      <span class="muted small">${q.active}/${MAX_ACTIVE_BOOKINGS}</span></li>`;
  }).join("");

  if (!state.people.length) $("next-hint").textContent = "Lag en bruker for å komme i gang.";
  else if (!queue.length) $("next-hint").textContent = `Alle har ${MAX_ACTIVE_BOOKINGS} aktive bookinger.`;
  else $("next-hint").textContent = "";

  const rest = queue.slice(3);
  $("rest").hidden = !rest.length && !full.length;
  $("queue").innerHTML =
    rest.map((q) => `<li class="${q.person.id === currentUserId ? "me" : ""}">
        <span class="name">${esc(q.person.name)}</span>
        <span class="muted small">${q.active}/${MAX_ACTIVE_BOOKINGS}</span></li>`).join("") +
    full.map((p) => `<li class="full ${p.id === currentUserId ? "me" : ""}">
        <span class="name">${esc(p.name)}</span><span class="small">full</span></li>`).join("");
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
    const cls = ["day", wd >= 5 && "weekend", !inRange && "out", d < today && "pad", iso === todayISO && "today"].filter(Boolean).join(" ");
    html += `<div class="${cls}">
      <div class="day-label"><span>${d.getDate()}.${d.getMonth() + 1}</span><span class="dname">${esc(shortFmt.format(d))}</span></div>
      <div class="day-slots">`;
    for (const s of SLOTS) {
      const list = (byKey.get(`${iso}|${s.id}`) || []).sort((a, b) => a.room.localeCompare(b.room, "nb"));
      const open = inRange && slotStart({ date: iso, slot: s.id }) > now;
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

  $("booking-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const booking = {
      personId: currentUserId,
      date: dateInput.value,
      slot: new FormData(e.target).get("slot"),
      room: $("f-room").value.trim().replace(/\s+/g, " "),
    };
    const err = validateBooking(booking, state.bookings);
    $("form-error").textContent = err || "";
    if (err) return;
    try {
      await store.addBooking(booking);
      $("f-room").value = "";
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
    if (e.target.value === MANAGE) {
      e.target.value = currentUserId;
      $("people-dialog").showModal();
      return;
    }
    writeUser(e.target.value);
    $("form-error").textContent = "";
    render();
  });
  $("new-user-btn").addEventListener("click", () => {
    $("u-name").value = "";
    $("user-error").textContent = "";
    dialog.showModal();
  });
  $("user-cancel").addEventListener("click", () => dialog.close());
  $("people-close").addEventListener("click", () => $("people-dialog").close());
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

async function main() {
  document.querySelectorAll(".booking-link").forEach((a) => (a.href = BOOKING_URL));
  setupForm();
  setupUsers();
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
