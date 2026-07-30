// ═══════════════════════════════════════════════════════════════════════
// BİLDİRİM GÖNDERME UCU  —  POST /api/notify
//
// Uygulama TAMAMEN KAPALIYKEN bildirim göndermenin tek yolu sunucudan push
// atmaktır; tarayıcı kapalıyken hiçbir istemci kodu çalışmaz. Burası o sunucu.
//
// Akış: oyuncu A bir işlem yapar (düello daveti / arkadaşlık isteği) → A'nın
// tarayıcısı buraya istek atar → burası hedef oyuncunun kayıtlı FCM anahtarını
// veritabanından okur → Firebase üzerinden push gönderir → hedefin telefonunda
// uygulama kapalı olsa bile bildirim düşer.
//
// GÜVENLİK: istek atan kişi kendi Firebase kimlik jetonunu (ID token) yollamak
// zorunda; sunucu bunu doğrular. Böylece bu uç, herkese spam atılabilen açık bir
// kapı olmaz. Gönderenin kimliği jetondan alınır, gövdeden DEĞİL.
//
// GEREKEN ORTAM DEĞİŞKENİ (Vercel → Settings → Environment Variables):
//   FIREBASE_SERVICE_ACCOUNT  → Firebase Console'dan indirilen servis hesabı
//                               JSON dosyasının TAMAMI (tek satır olarak)
// Değişken tanımlı değilse uç sessizce "devre dışı" döner; oyun normal çalışır,
// yalnızca kapalıyken bildirim gelmez.
// ═══════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DB_URL = "https://amiral-batti-eef5b-default-rtdb.europe-west1.firebasedatabase.app";

let _app = null;
async function getAdmin() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  const admin = await import("firebase-admin");
  if (!_app) {
    const existing = admin.apps && admin.apps.length ? admin.apps[0] : null;
    if (existing) { _app = existing; }
    else {
      let creds;
      try { creds = JSON.parse(raw); }
      catch (e) { return null; }
      // Vercel ortam değişkeninde satır sonları \n olarak kaçırılmış gelir
      if (creds.private_key) creds.private_key = creds.private_key.replace(/\\n/g, "\n");
      _app = admin.initializeApp({
        credential: admin.credential.cert(creds),
        databaseURL: DB_URL,
      });
    }
  }
  return admin;
}

// Aynı kişiye çok kısa aralıkla AYNI TÜRDEN bildirim atılmasın (basit taciz kapısı).
// Anahtar türü de içerir: arkadaşlık isteği atıp hemen ardından düello daveti
// göndermek engellenmemeli — bunlar farklı olaylar. Süre de kısa tutuldu, çünkü
// düello davetinin zaten 15 saniyelik ömrü ve 3-red kuralı var.
const lastSent = new Map();
const MIN_GAP_MS = 8000;

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch (e) { return NextResponse.json({ ok: false, error: "bad-json" }, { status: 400 }); }

  const { idToken, toUid, title, message, tag } = body || {};
  if (!idToken || !toUid || !title) {
    return NextResponse.json({ ok: false, error: "missing-fields" }, { status: 400 });
  }

  const admin = await getAdmin();
  if (!admin) {
    // Servis hesabı tanımlı değil — özellik kapalı, ama oyun akışı bozulmasın.
    return NextResponse.json({ ok: false, disabled: true });
  }

  // 1) Gönderenin kimliğini doğrula
  let fromUid;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    fromUid = decoded.uid;
  } catch (e) {
    return NextResponse.json({ ok: false, error: "auth" }, { status: 401 });
  }
  if (fromUid === toUid) return NextResponse.json({ ok: false, error: "self" }, { status: 400 });

  // 2) Hız sınırı
  const key = fromUid + "->" + toUid + ":" + (tag || "genel");
  const now = Date.now();
  if (now - (lastSent.get(key) || 0) < MIN_GAP_MS) {
    return NextResponse.json({ ok: false, error: "cok-sik-ayni-bildirim" }, { status: 429 });
  }
  lastSent.set(key, now);
  // Bellek sızmasın — eski kayıtları ara sıra temizle
  if (lastSent.size > 500) {
    for (const [k, v] of lastSent) if (now - v > MIN_GAP_MS * 4) lastSent.delete(k);
  }

  // 3) Hedefin cihaz anahtarını ve bildirim tercihini oku
  let token = null;
  try {
    const db = admin.database();
    const snap = await db.ref(`profiles/${toUid}/push`).get();
    const p = snap.exists() ? snap.val() : null;
    // Ayrım önemli: hedef hiç kaydolmamış olabilir (bildirim izni vermemiştir) ya da
    // bilerek kapatmış olabilir. İkisi farklı sorun, farklı çözüm.
    if (!p) return NextResponse.json({ ok: false, error: "hedefin-cihazi-kayitli-degil" });
    if (p.enabled === false) return NextResponse.json({ ok: false, error: "hedef-bildirimleri-kapatmis" });
    token = p.token || null;
  } catch (e) {
    return NextResponse.json({ ok: false, error: "db" }, { status: 500 });
  }
  if (!token) return NextResponse.json({ ok: false, error: "hedefin-cihazi-kayitli-degil" });

  // 4) Gönder
  try {
    await admin.messaging().send({
      token,
      notification: { title, body: message || "" },
      webpush: {
        notification: {
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          tag: tag || "ab-push",
          renotify: true,
          vibrate: [40, 60, 40],
        },
        fcmOptions: { link: "/" },
      },
      data: { tag: tag || "ab-push" },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    // Anahtar geçersizleşmişse (uygulama silinmiş, izin geri alınmış) temizle
    const code = e?.errorInfo?.code || e?.code || "";
    if (code.includes("registration-token-not-registered") || code.includes("invalid-argument")) {
      try { await admin.database().ref(`profiles/${toUid}/push/token`).remove(); } catch (e2) {}
    }
    return NextResponse.json({ ok: false, error: code || "send-failed" }, { status: 500 });
  }
}
