// Lagring: Firestore når FIREBASE_CONFIG er satt, ellers localStorage.
// Begge gir samme grensesnitt: subscribe(cb), addPerson(name), addBooking(b), deleteBooking(id), deletePerson(id).
import { FIREBASE_CONFIG } from "./config.js?v=14";
import { validateBooking, normalizeRoom } from "./rules.js?v=14";

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
      return JSON.parse(localStorage.getItem(KEY)) || { people: [], bookings: [] };
    } catch {
      return { people: [], bookings: [] };
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
      const err = validateBooking(b, state.bookings);
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
        people: state.people.filter((p) => p.id !== id),
        bookings: state.bookings.filter((b) => b.personId !== id),
      };
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
  let state = { people: [], bookings: [] };
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
      const err = validateBooking(b, fresh.docs.map((d) => ({ id: d.id, ...d.data() })));
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
