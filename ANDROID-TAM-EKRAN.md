# Android APK — Tam Ekran (Immersive) Kurulumu

Bu depo saf bir **Next.js web uygulamasıdır**; içinde Android native projesi yoktur.
Aşağıdaki adımlar, APK'yı ürettiğin **ayrı Android projesinde** uygulanır.

---

## 1. MainActivity.kt

Dosya yolu: `app/src/main/java/<paket/yolun>/MainActivity.kt`

```kotlin
package com.senin.paketin   // ← kendi paket adınla değiştir

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // İçeriğin sistem çubuklarının altına kadar uzanmasını sağlar (edge-to-edge)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        hideSystemBars()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        // Uygulamaya her geri dönüldüğünde çubuklar yeniden gizlenir
        if (hasFocus) hideSystemBars()
    }

    private fun hideSystemBars() {
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        // Hem alt navigasyon hem üst durum çubuğu gizlenir
        controller.hide(WindowInsetsCompat.Type.systemBars())
        // Kullanıcı kenardan kaydırsa bile çubuklar kısa süre sonra tekrar gizlenir
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }
}
```

> **Not:** Verdiğin kodda bu mantık yalnızca `onWindowFocusChanged` içindeydi.
> `onCreate`'e de eklemek gerekir; aksi halde uygulama ilk açıldığında çubuklar
> bir an görünür kalır. Yukarıdaki sürüm ikisini de kapsıyor.

---

## 2. Gerekli bağımlılık

`app/build.gradle` (veya `build.gradle.kts`) içinde:

```gradle
implementation "androidx.core:core-ktx:1.13.1"
implementation "androidx.appcompat:appcompat:1.7.0"
```

`WindowCompat`, `WindowInsetsCompat` ve `WindowInsetsControllerCompat`
sınıfları `androidx.core` paketinden gelir.

---

## 3. Tema (çentikli ekranlar için)

`res/values/themes.xml`:

```xml
<style name="Theme.AmiralBatti" parent="Theme.AppCompat.NoActionBar">
    <item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>
    <item name="android:statusBarColor">@android:color/transparent</item>
    <item name="android:navigationBarColor">@android:color/transparent</item>
</style>
```

`AndroidManifest.xml` içinde activity'ye bu temayı ver:

```xml
<activity
    android:name=".MainActivity"
    android:theme="@style/Theme.AmiralBatti"
    android:screenOrientation="portrait"
    android:exported="true">
```

---

## 4. WebView ayarları (WebView tabanlı APK ise)

```kotlin
webView.settings.apply {
    javaScriptEnabled = true
    domStorageEnabled = true          // localStorage — günlük sandık için şart
    mediaPlaybackRequiresUserGesture = false  // ses efektleri için
    cacheMode = WebSettings.LOAD_DEFAULT
}
```

---

## Web tarafında zaten yapılanlar

- `public/manifest.json` → `"display": "fullscreen"`
  (PWA olarak "Ana ekrana ekle" ile kurulunca çubuklar gizlenir)
- `src/app/layout.js` → kullanıcının ilk dokunuşunda `requestFullscreen()`
  çağrılır ve ekran dikey konuma kilitlenir
- `viewport-fit=cover` + `env(safe-area-inset-*)` → çentik ve alt çubuk
  bölgelerine içerik taşmaz

**Önemli:** Uygulamayı Chrome'da normal bir sekmede açarsan tarayıcı adres çubuğu
ve sistem çubukları görünmeye devam eder. Tam ekran için ya APK'yı kullan ya da
Chrome menüsünden **"Ana ekrana ekle"** deyip oradan aç.
