import { createStore } from "./store.js";
import { ROOM_SUGGESTIONS } from "./config.js";
import {
  SLOTS, MAX_ACTIVE_BOOKINGS, MAX_DAYS_AHEAD,
  toISODate, parseISODate, addDays, slotById, slotStart,
  isActive, activeBookingsFor, validateBooking, bookingQueue,
} from "./rules.js";

const USER_KEY = "grupperom-current-user";
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
  const now = new Date();
  const queue = bookingQueue(state.people, state.bookings, now);
  const full = state.people.filter((p) => !queue.some((q) => q.person.id === p.id));

  if (!state.people.length) {
    $("next-person").textContent = "–";
    $("next-hint").textContent = "Lag en bruker for å komme i gang.";
  } else if (!queue.length) {
    $("next-person").textContent = "Alle er fulle";
    $("next-hint").textContent = `Alle har ${MAX_ACTIVE_BOOKINGS} aktive bookinger.`;
  } else {
    const first = queue[0];
    $("next-person").textContent = first.person.id === currentUserId ? `${first.person.name} (deg!)` : first.person.name;
    $("next-hint").textContent = `${first.active} av ${MAX_ACTIVE_BOOKINGS} aktive bookinger`;
  }

  $("queue").innerHTML =
    queue.map((q) => `<li class="${q.person.id === currentUserId ? "me" : ""}">
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
            <span class="txt"><b>${esc(personName(b.personId))}</b> · ${esc(b.room)}</span>
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
