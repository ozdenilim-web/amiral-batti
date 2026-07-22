# AMİRAL BATTI — Proje Devir Notları

Yeni bir sohbet oturumuna geçerken bu dosyanın tamamını ilk mesaja yapıştır.
Böylece hiçbir bağlam kaybolmaz.

---

## 1. PROJE NEDİR

Online çok oyunculu "Amiral Battı" (Battleship) oyunu.
- **Teknoloji:** Next.js (React) + Firebase Realtime Database + Firebase Auth + Firebase Analytics
- **Barındırma:** Vercel — canlı adres: `https://amiral-batti-topaz.vercel.app`
- **Mobil:** PWABuilder ile üretilmiş TWA/APK (Android)
- **Kod neredeyse tek dosyada:** `src/app/Game.js` (~5300 satır, 30+ bileşen)
- **Dil:** Türkçe + İngilizce (her metin `L(appLang,"anahtar")` ile iki dilde)

## 2. DOSYA YAPISI

```
amiral-batti/amiral-batti/
├── src/app/Game.js        ← ANA DOSYA, neredeyse her şey burada
├── src/app/layout.js      ← global CSS, PWA meta, tam ekran betiği, metin seçimi kapalı
├── src/app/page.js        ← sadece Game'i çağırır
├── src/lib/firebase.js    ← Firebase config + Analytics (track/identify) + auth exportları
├── public/manifest.json   ← display: fullscreen
├── public/.well-known/assetlinks.json  ← TWA doğrulaması (paket + parmak izi dolu)
├── public/img/            ← görseller (coin.png, ship-victory.png, ship-defeat.png vb.)
├── public/sfx/            ← ses efektleri (first_kill.mp3, double_kill.mp3, triple_kill.mp3, explosion.mp3)
├── database.rules.json    ← Firebase güvenlik kuralları
├── ANDROID-TAM-EKRAN.md   ← APK tam ekran rehberi (Kotlin)
└── DEVIR-NOTLARI.md       ← bu dosya
```

## 3. FIREBASE

- Proje: `amiral-batti-eef5b`, bölge europe-west1
- Config `src/lib/firebase.js` içinde açık (normal, güvenlik kurallarla sağlanır)
- **Analytics ölçüm kimliği:** `G-CKGZ18ZDPZ` (aktif)
- **Etkin sağlayıcılar:** Google, Anonymous, **Email/Password** (kurtarma kodu için şart)
- Kural değişikliği yapılınca: `firebase deploy --only database` (bazen timeout verir, tekrar dene)

### Firebase veri düğümleri
- `profiles/{uid}` — oyuncu profili (aşağıda alanlar)
- `rooms/{roomId}` — aktif maçlar (biten/eski olanlar temizleniyor)
- `online_players/{uid}` — salondaki idle oyuncular
- `matchmaking`, `matchmaking_arena`, `matchmaking_claims` — eşleşme kuyruğu + atomik kilit
- `match_found/{uid}` — eşleşme bildirimi
- `global_stats` — Yaşayan Ufuk sayaçları (battlesTotal, sunkTotal, day/{tarih})
- `invites` — düello davetleri

### profile alanları (safe* fonksiyonlarıyla temizlenir)
`displayName, wins, losses, totalGames, botGames, onlineGames, gold, honor, level,
levelProgress, loginStreak, avatar, nameSetAt, onboardingDone, createdAt, lastGameAt,
recentResults (son 5 W/L), ach {...}, achievClaimed {...}, daily {...}, voyage {...}, hasRecovery`

## 4. OYUN EKONOMİSİ (birbirine geçmiş 6 dişli)

1. **Altın** — harcanır (arena girişi). Başlangıç 500. Bot galibiyeti 50×seri, günlük sandık 300.
2. **Şeref (honor)** — HARCANAMAZ statü parası, sadece savaşarak. Online galibiyet +10/mağlup +3, bot +5/+2. RÜTBE buna bağlı: ER<100, TEĞMEN 100, YÜZBAŞI 300, KAPTAN 800, KOMODOR 2000, AMİRAL 5000.
3. **İntikam Modu** — üst üste 2 mağlubiyet ×2, 3 ×2.5, 4+ ×3 (sonraki galibiyette altın+XP katlanır). `ach.lossStreak`.
4. **Sefer Dönüşü** — çevrimdışı kazanç; kapasite o gün oynanan maçla artar (0 maç=1s, tavan 12s), saatlik kazanç rütbeyle (15-40). `voyage`.
5. **Günlük görevler** — 1 kolay + 2 orta (zor/efsane günlükten çıkarıldı). Profildeki `daily` sayaçlarından hesaplanır, kalıcı. 3/3 → sandık.
6. **Kazanımlar** — 4 set × 10 başarım, kilitli (oyun/altın/oran kapıları), ödül altın+özel avatar. `ach` + `achievClaimed`.

- XP: online galibiyet 1.0 (arena ×1.1), bot 0.5, kaybeden %25'i.
- Kaybeden altın kaybetmez ama kazanmaz da (arena girişi iade).

## 5. EŞLEŞME MOTORU

- Tek havuz, altın penceresi YOK — anında eşleşme.
- **Çift kilit (acquirePairLock):** kilitler her zaman küçük uid önce alınır → tek oda garantisi (karşılıklı oda kurma hatası çözüldü).
- HAZIRIM diyen = davet/kabul yok, anında eşleşir.
- OYNA'da 7 sn'de insan yoksa BOT maçı garantisi. Arena'da insan şart, yoksa ücret iade.
- Bayat kuyruk kayıtları (>30sn) elenir.

## 6. HESAP / KURTARMA KODU SİSTEMİ

- Hesaplar anonim başlar. İsim seçilince arka planda Email/Password ile kalıcı kimliğe bağlanır:
  `kullaniciadi@oyuncu.amiralbatti.app` + 8 karakterlik kurtarma kodu (ABCD-EFGH).
- Kod açılışta GÖSTERİLMEZ. Ayarlar → 🚪 ÇIKIŞ YAP'a basınca gösterilir, kopyalanır, çıkılır.
- Alınmış isimle girmeye çalışınca kullanıcı adının ALTINDA satır içi "kod gir" alanı açılır → eski hesaba döner.
- Kod cihazda `localStorage: ab_recovery_code`.

## 7. EKRANLAR (phase state'leri)
`splash → (isim seç) → lobby → placing → ready → playing → gameover`
Ayrıca: onboarding_intro (4 adımlık öğretici — eğitim savaşı KALDIRILDI, sonunda ana sayfaya döner), waiting (oda kodu — kaldırıldı).

- **Ana ekran (lobby):** profil kartı + XP barı, OYNA (fiziksel tuş + nefes alan hale), SALON/ARENA, BOT/SIRALAMA, KAZANIMLAR, GÖREVLER şeridi, Yaşayan Ufuk (saate göre gökyüzü + rütbe gemisi + kaptan siluetleri).
- **Oyun ekranı:** SABİT (kaydırma yok), tahta ResizeObserver ile ölçülür. Filo şeridi (3D parlak kutucuklar, vurunca ince beyaz X, Amiral T-formunda). Emoji tek butonda (3sn bekleme). Süre barı. Üst bar: ⚑ayrıl ⚙ayar 🔊ses (30×30, sağ üstte).
- **Gameover:** Ödül Raporu penceresi (animasyonlu XP/altın/şeref/görev/kazanım) → ZAFER/BOZGUN (harf harf düşen, gemi görseli) → YENİ SAVAŞ (büyük kanca).

## 8. ÇÖZÜLEN BÜYÜK HATALAR (tekrar etmesin)
- Bot maçında boş sayfa → değişken tanımdan önce kullanılıyordu (placeCell). **DERS: yeni const'ı bloğun EN BAŞINDA tanımla.**
- Online ödül işlenmiyor → kazanan kaybedenin profilini yazamıyordu (kural). Artık **her oyuncu KENDİ profilini yazar** (applyOnlineResultSelf).
- Görevler işlenmiyordu → sayaçlar bellekteydi + online sayılmıyor + 7 alan eksikti. Artık profildeki `daily`.
- Çift sayım riski → DB yazımı setState updater İÇİNDEYDİ. Artık `myProfileRef` üzerinden, updater DIŞINDA.
- Günlük görev hep aynı çıkıyordu → LCG düşük bitleri zayıf, `Math.floor(rng/65536)%n` kullanıldı.
- Tahta 12×12 (11 + etiket satırı/sütunu), 11 değil.

## 9. AÇIK İŞLER / GELECEK
- **Güvenlik (kritik, henüz YAPILMADI):** Kurallar `auth.uid===$uid` → herkes kendi altınını/şerefini yazabilir. Gerçek çözüm Cloud Functions. honor/ach/daily/level için doğrulama yok.
- Dosya bölme (5300 satır tek dosya) — bakım borcu.
- Google Play Veri Güvenliği formu (Analytics konum/cihaz topluyor, gizlilik metnine eklendi).
- Mavi navigasyon çubuğu: assetlinks push edilip APK yeniden kurulunca çözülür (TWA doğrulaması).

## 10. ÇALIŞMA AKIŞI
- Her değişiklik `src/app/Game.js`'e. Sözdizimi kontrolü:
  `npx esbuild src/app/Game.js --loader:.js=jsx --outfile=/dev/null`
- Kaydetmeden önce mantık/hesap testleri node ile yapılıyor.
- **Push (kullanıcı kendi terminalinden):**
  ```
  cd C:\Users\İlim\Desktop\amiral-batti\amiral-batti
  git add -A
  git commit -m "mesaj"
  git push origin main
  ```
- `.git\index.lock` hatası olursa: `del .git\index.lock`
- APK: PWABuilder → adres gir → Package For Stores → Android → fullscreen → Generate → `Amiral Battı.apk` telefona.
- **signing.keystore + signing-key-info dosyaları KAYBEDİLMEMELİ** (güncelleme için şart).

## 11. TASARIM DİLİ
- Renkler: cyan `#00e5ff` (accent), altın `#ffd700`, kırmızı `#ff4757` (hit), koyu lacivert `#050b18` (bg)
- Font: warrior (Barlow Condensed), mono (Space Mono)
- İçerik genişliği: tek standart `maxWidth:400`, kenar boşluğu `clamp(10px,4vw,16px)`
- Mobil performans: sadece transform/opacity animasyonu; box-shadow/filter nabızları KAPALI
- Butonlarda parlama süpürmesi (`playSheen`/`dmShine` keyframe), ikonsuz, sade
