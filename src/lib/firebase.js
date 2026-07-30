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

// === PUSH (uygulama kapalıyken bildirim) ===
// Cihaz anahtarını alır. Anahtar, sunucunun (api/notify) o cihaza push atabilmesi
// için gerekli. VAPID anahtarı tanımlı değilse sessizce null döner — oyun etkilenmez.
function errText(e) {
  const name = e?.name || "";
  const code = e?.code != null ? ("kod" + e.code) : "";
  const msg = e?.message || "";
  return [name, code, msg].filter(Boolean).join(" ").slice(0, 110) || "bilinmeyen";
}

export async function getPushToken() {
  try {
    if (typeof window === "undefined") return { error: "ssr" };
    if (!("serviceWorker" in navigator)) return { error: "sw-yok" };
    if (!("Notification" in window)) return { error: "bildirim-desteklenmiyor" };
    if (Notification.permission !== "granted") return { error: "izin-yok" };
    const vapid = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
    if (!vapid) return { error: "VAPID-ANAHTARI-YOK" };
    const { getMessaging, getToken, isSupported } = await import("firebase/messaging");
    if (!(await isSupported().catch(() => false))) return { error: "tarayici-desteklemiyor" };
    // ÖNEMLİ: kendi kapsamıyla kaydet. Varsayılan kapsam "/" ve uygulamanın PWA
    // çalışanı (/sw.js) da orada — ikisi aynı kapsama kaydolursa sonuncusu diğerini
    // EZER, uygulama kapalıyken push'u karşılayacak çalışan ortadan kalkar.
    // TEMİZLİK: daha önce yanlış kapsama ("/") kaydolmuş bir FCM çalışanı varsa kaldır.
    // Kalıntı kayıt, PWA çalışanıyla çakışıp abonelik kurulumunu AbortError (kod 20) ile
    // düşürüyor — cihaz bir türlü kaydolamıyor.
    const WANTED = "/firebase-cloud-messaging-push-scope";
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) {
        const url = (r.active || r.installing || r.waiting)?.scriptURL || "";
        if (url.includes("firebase-messaging-sw.js") && !r.scope.endsWith(WANTED.slice(1) + "/") && !r.scope.includes(WANTED)) {
          await r.unregister().catch(() => {});
        }
      }
    } catch (e) {}

    let reg;
    try {
      reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: WANTED });
    } catch (e) { return { error: "sw-kaydi: " + (e?.name || "") + " " + (e?.message || e) }; }
    if (!reg) return { error: "sw-kaydi-bos" };
    try { await navigator.serviceWorker.ready; } catch (e) {}

    const messaging = getMessaging(app);
    // Bir kez başarısız olursa eski aboneliği iptal edip tekrar dene (AbortError için)
    try {
      const token = await getToken(messaging, { vapidKey: vapid, serviceWorkerRegistration: reg });
      if (token) return { token };
    } catch (e1) {
      try {
        const sub = await reg.pushManager.getSubscription();
        if (sub) await sub.unsubscribe().catch(() => {});
      } catch (e2) {}
      try {
        const token2 = await getToken(messaging, { vapidKey: vapid, serviceWorkerRegistration: reg });
        if (token2) return { token: token2 };
      } catch (e3) {
        return { error: errText(e3) + " (2. deneme)" };
      }
    }
    return { error: "bos-anahtar" };
  } catch (e) {
    return { error: errText(e) };
  }
}

/** Karşı tarafa push gönder (uygulaması kapalı olsa bile ulaşır). */
export async function sendPush(toUid, title, message, tag) {
  try {
    const u = auth.currentUser;
    if (!u || !toUid) return false;
    const idToken = await u.getIdToken();
    const res = await fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, toUid, title, message, tag }),
    });
    const j = await res.json().catch(() => ({}));
    return j && j.ok ? true : (j?.error || (j?.disabled ? "disabled" : "fail"));
  } catch (e) { return "network"; }
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
