/* Firebase Cloud Messaging arka plan çalışanı.
   Uygulama KAPALIYKEN gelen push'ları bu dosya karşılar ve bildirimi gösterir.
   Adı sabittir — Firebase SDK bu dosyayı tam olarak bu adla arar. */

importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyA-bIXTZWr_kLAQl6lXCkj2mSBbA_jEXGo",
  authDomain: "amiral-batti-eef5b.firebaseapp.com",
  databaseURL: "https://amiral-batti-eef5b-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "amiral-batti-eef5b",
  storageBucket: "amiral-batti-eef5b.firebasestorage.app",
  messagingSenderId: "785495369630",
  appId: "1:785495369630:web:62dcd9429444b285eb988f",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const n = payload.notification || {};
  const d = payload.data || {};
  self.registration.showNotification(n.title || "Amiral Battı", {
    body: n.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: d.tag || "ab-push",
    renotify: true,
    vibrate: [40, 60, 40],
    data: { url: "/" },
  });
});

// Bildirime tıklanınca oyunu öne getir / aç
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ("focus" in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })
  );
});
