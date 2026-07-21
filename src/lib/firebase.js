import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, get, onValue, update, remove, onDisconnect, runTransaction, query, orderByChild, limitToLast } from "firebase/database";
import { getAuth, signInAnonymously, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut,
         EmailAuthProvider, linkWithCredential, signInWithEmailAndPassword } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyA-bIXTZWr_kLAQl6lXCkj2mSBbA_jEXGo",
  authDomain: "amiral-batti-eef5b.firebaseapp.com",
  databaseURL: "https://amiral-batti-eef5b-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "amiral-batti-eef5b",
  storageBucket: "amiral-batti-eef5b.firebasestorage.app",
  messagingSenderId: "785495369630",
  appId: "1:785495369630:web:62dcd9429444b285eb988f",
  measurementId: "G-CKGZ18ZDPZ",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// === ANALİTİK ===
// Yalnızca tarayıcıda ve destekleniyorsa yüklenir (sunucu tarafı derlemede çökmemesi için
// dinamik import). Ölçüm kimliği girilmemişse hiçbir şey yapmaz — uygulama normal çalışır.
let _analytics = null;
let _analyticsReady = false;
const _queue = [];

if (typeof window !== "undefined" && firebaseConfig.measurementId && !firebaseConfig.measurementId.includes("XXXX")) {
  import("firebase/analytics")
    .then(async ({ getAnalytics, isSupported, logEvent, setUserId, setUserProperties }) => {
      const ok = await isSupported().catch(() => false);
      if (!ok) return;
      _analytics = getAnalytics(app);
      _analytics.__logEvent = logEvent;
      _analytics.__setUserId = setUserId;
      _analytics.__setUserProps = setUserProperties;
      _analyticsReady = true;
      // Hazır olmadan önce biriken olayları gönder
      while (_queue.length) {
        const [name, params] = _queue.shift();
        try { logEvent(_analytics, name, params); } catch (e) {}
      }
    })
    .catch(() => {});
}

/** Olay kaydet. Analitik kapalıysa sessizce yok sayılır. */
export function track(name, params = {}) {
  try {
    if (!_analyticsReady) {
      if (_queue.length < 40) _queue.push([name, params]); // hazır olana kadar sırada beklet
      return;
    }
    _analytics.__logEvent(_analytics, name, params);
  } catch (e) {}
}

/** Oyuncuyu tanımla — raporlarda kullanıcı bazlı kırılım sağlar. */
export function identify(uid, props = {}) {
  try {
    if (!_analyticsReady) return;
    if (uid) _analytics.__setUserId(_analytics, uid);
    if (props && Object.keys(props).length) _analytics.__setUserProps(_analytics, props);
  } catch (e) {}
}

export { db, auth, googleProvider, ref, set, get, onValue, update, remove, onDisconnect, runTransaction, query, orderByChild, limitToLast, signInAnonymously, onAuthStateChanged, signInWithPopup, signOut,
         EmailAuthProvider, linkWithCredential, signInWithEmailAndPassword };
