// Lagring: Firestore når FIREBASE_CONFIG er satt, ellers localStorage.
// Begge gir samme grensesnitt: subscribe(cb), addPerson(name), addBooking(b), deleteBooking(id), deletePerson(id),
// blockDates(dates, reason, slots), unblockDates(dates).
import { FIREBASE_CONFIG } from "./config.js?v=19";
import { validateBooking, normalizeRoom, blockedOn, mergeBlockSlots } from "./rules.js?v=19";

const EMPTY = { people: [], bookings: [], blocked: [] };

// En sperring per dato; nye økter legges til de som allerede er sperret den dagen
function blockEntry(date, reason, slots, blocked) {
  const existing = blockedOn(date, blocked);
  return { date, reason: reason || existing?.reason || "", slots: mergeBlockSlots(existing, slots) };
}

const FIREBASE_VERSION = "10.12.2";

function bookingDocId(b) {
  // Deterministisk id => samme rom i samme økt kan ikke lagres to ganger
  return `${b.date}_${b.slot}_${normalizeRoom(b.room).replace(/[^a-z0-9æøå]+/g, "-")}`;
}

function localStore() {
  const KEY = "grupperom-booking-v1";
  const listeners = new Set();
  const load = () => {
    try {
      return { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY)) };
    } catch {
      return EMPTY;
    }
  };
  let state = load();
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {}
    listeners.forEach((cb) => cb(state));
  };
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) {
      state = load();
      listeners.forEach((cb) => cb(state));
    }
  });
  return {
    mode: "local",
    subscribe(cb) {
      listeners.add(cb);
      cb(state);
    },
    async addPerson(name) {
      const p = { id: crypto.randomUUID(), name, createdAt: Date.now() };
      state = { ...state, people: [...state.people, p] };
      save();
      return p;
    },
    async addBooking(b) {
      const err = validateBooking(b, state.bookings, new Date(), state.blocked);
      if (err) throw new Error(err);
      const booking = { ...b, id: bookingDocId(b), createdAt: Date.now() };
      state = { ...state, bookings: [...state.bookings, booking] };
      save();
    },
    async deleteBooking(id) {
      state = { ...state, bookings: state.bookings.filter((b) => b.id !== id) };
      save();
    },
    async deletePerson(id) {
      state = {
        ...state,
        people: state.people.filter((p) => p.id !== id),
        bookings: state.bookings.filter((b) => b.personId !== id),
      };
      save();
    },
    async blockDates(dates, reason, slots) {
      const keep = state.blocked.filter((x) => !dates.includes(x.date));
      const added = dates.map((date) => ({ id: date, ...blockEntry(date, reason, slots, state.blocked) }));
      state = { ...state, blocked: [...keep, ...added] };
      save();
    },
    async unblockDates(dates) {
      state = { ...state, blocked: state.blocked.filter((x) => !dates.includes(x.date)) };
      save();
    },
  };
}

async function firestoreStore(config) {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const { initializeApp } = await import(`${base}/firebase-app.js`);
  const fs = await import(`${base}/firebase-firestore.js`);
  const db = fs.getFirestore(initializeApp(config));
  const peopleCol = fs.collection(db, "people");
  const bookingsCol = fs.collection(db, "bookings");
  const blockedCol = fs.collection(db, "blocked");
  let state = EMPTY;
  const listeners = new Set();
  const emit = () => listeners.forEach((cb) => cb(state));
  const onError = (e) => {
    console.error(e);
    alert("Klarte ikke å hente data fra Firebase: " + e.message);
  };

  fs.onSnapshot(
    peopleCol,
    (snap) => {
      state = { ...state, people: snap.docs.map((d) => ({ id: d.id, ...d.data() })) };
      emit();
    },
    onError
  );
  fs.onSnapshot(
    bookingsCol,
    (snap) => {
      state = { ...state, bookings: snap.docs.map((d) => ({ id: d.id, ...d.data() })) };
      emit();
    },
    onError
  );
  fs.onSnapshot(
    blockedCol,
    (snap) => {
      state = { ...state, blocked: snap.docs.map((d) => ({ id: d.id, ...d.data() })) };
      emit();
    },
    // Uten oppdaterte Firestore-regler mangler tilgang til "blocked" – appen virker likevel
    (e) => console.warn("Sperrede dager utilgjengelig:", e.message)
  );

  return {
    mode: "firebase",
    subscribe(cb) {
      listeners.add(cb);
      cb(state);
    },
    async addPerson(name) {
      const ref = await fs.addDoc(peopleCol, { name, createdAt: Date.now() });
      return { id: ref.id, name };
    },
    async addBooking(b) {
      // Sjekk reglene mot ferske data fra serveren før vi lagrer
      const fresh = await fs.getDocs(bookingsCol);
      const err = validateBooking(b, fresh.docs.map((d) => ({ id: d.id, ...d.data() })), new Date(), state.blocked);
      if (err) throw new Error(err);
      const ref = fs.doc(db, "bookings", bookingDocId(b));
      await fs.runTransaction(db, async (tx) => {
        if ((await tx.get(ref)).exists()) throw new Error("Det rommet er allerede booket i denne økta.");
        tx.set(ref, { ...b, createdAt: Date.now() });
      });
    },
    async deleteBooking(id) {
      await fs.deleteDoc(fs.doc(db, "bookings", id));
    },
    async deletePerson(id) {
      // Sletter brukeren og alle bookingene deres i én operasjon
      const theirs = await fs.getDocs(fs.query(bookingsCol, fs.where("personId", "==", id)));
      const batch = fs.writeBatch(db);
      theirs.forEach((d) => batch.delete(d.ref));
      batch.delete(fs.doc(db, "people", id));
      await batch.commit();
    },
    async blockDates(dates, reason, slots) {
      // Dok-id = dato, så samme dag kan ikke sperres to ganger
      const batch = fs.writeBatch(db);
      dates.forEach((date) => batch.set(fs.doc(db, "blocked", date), { ...blockEntry(date, reason, slots, state.blocked), createdAt: Date.now() }));
      await batch.commit();
    },
    async unblockDates(dates) {
      const batch = fs.writeBatch(db);
      dates.forEach((date) => batch.delete(fs.doc(db, "blocked", date)));
      await batch.commit();
    },
  };
}

export async function createStore() {
  if (FIREBASE_CONFIG) {
    try {
      return await firestoreStore(FIREBASE_CONFIG);
    } catch (e) {
      console.error("Firebase feilet, bruker lokal lagring", e);
    }
  }
  return localStore();
}
