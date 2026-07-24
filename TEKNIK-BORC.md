# Teknik Borç / Bekleyen İşler

Bu dosya, oyuncu sayısı arttığında (veya bir sonraki büyük bakım turunda) ele alınması gereken,
şimdilik bilerek ertelenen maddeleri tutar. Her madde neden ertelendiğini de içeriyor.

## Güvenlik

- **Ekonomi client-authoritative** (`gold`/`elo`/`wins` doğrudan istemciden yazılıyor, sadece
  tip/aralık kontrolü var). Gerçek çözüm Cloud Functions ile sunucu tarafı doğrulama —
  oyuncu sayısı azken risk düşük, büyüyünce öncelikli ele alınmalı.
- **`siege_rooms` kuralı hâlâ gevşek** (`rooms` gibi sıkılaştırılmadı — o zaman kapsam dışı
  bırakıldı çünkü host-otoriteli motor karmaşık, dikkatli/ayrı bir oturum gerektiriyor).
  `rooms` için yapılan aynı mantık (sadece present/host'a göre read/write) uygulanabilir.
- **Google Login** (`handleGoogleLogin`) bağlı değil, kullanıcı karar bekliyor: düzgün
  bağlamak için `linkWithPopup` ile anonim hesaba bağlama gerekiyor (şu an `signInWithPopup`
  ile bağlarsak anonim ilerleme kaybolmuş gibi görünür). Karar verilince haber verilecek.

## Performans

- **Tek dev component mimarisi** — `Game()` fonksiyonu ~7000 satır, 179 `useState`, 93 `useRef`.
  Herhangi bir state değişimi tüm fonksiyonu yeniden çalıştırıyor. Gerçek çözüm: Kuşatma/
  Salvo/Tersane/Klasik motorlarını ayrı component'lere/hook'lara bölmek. Riski düşük değil,
  ayrı ve planlı bir refactor oturumu gerektirir.
- **Kuşatma ve Salvo tahtaları hâlâ her render'da yeniden allocate ediliyor**
  (`board={emptyGrid()}` gibi satır içi çağrılar). Sadece klasik/arena/bot/Tersane'nin
  kullandığı ANA saldırı tahtası `useMemo`'ya alındı (en sık kullanılan yol). Kuşatma motoru
  yakın zamanda dikkatli kurulduğu için (heartbeat/tolerans sistemi) şimdilik dokunulmadı —
  aynı `useMemo` mantığıyla düzeltilebilir.
- **~93 adet `animation: ... infinite`, 10 `backdropFilter` (blur), 28 `drop-shadow`,
  65 çok katmanlı `boxShadow`.** Tek tek felaket değil ama üst üste bindiklerinde
  (özellikle blur+drop-shadow birlikte) mobilde GPU'yu zorluyor, düşük/orta segment
  telefonlarda kare düşürebilir. Öneri: blur kullanılan yerlerde önceden bulanıklaştırılmış
  bir arka plan (gradient/PNG) ile simüle etmek.
- **`emptyGrid()` deseni dosyada çok tekrarlıyor** (review ekranı, salvo reveal, kuşatma vb.)
  — çoğu statik ekran olduğu için öncelik düşük, ama tutarlılık için hepsi `useMemo`'ya
  alınabilir.

## Bug (araştırma bekliyor)

- **Masaüstünde "sefere çıktık" (sailNotice) popup'ı çok büyük çıkıyor.** CSS satır satır
  incelendi (`min(84vw, 320px)` zaten sınırlı görünüyor), matematiksel olarak sebep
  bulunamadı. Ekran görüntüsü bekleniyor — görülünce hızlıca çözülür.

## Ölü kod / temizlik (düşük öncelik)

- `endGameTestBtn`/`testModeMsg` gibi birkaç kullanılmayan çeviri string'i kaldı (zararsız).
