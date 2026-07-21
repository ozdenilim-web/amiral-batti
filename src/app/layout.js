import { Barlow_Condensed, Space_Mono } from "next/font/google";

const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800", "900"],
  style: ["normal", "italic"],
  variable: "--font-warrior",
  display: "swap",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata = {
  title: "Amiral Battı — Online",
  description: "Multiplayer Amiral Battı oyunu",
};

export default function RootLayout({ children }) {
  return (
    <html lang="tr" className={`${barlowCondensed.variable} ${spaceMono.variable}`}>
      <head>
        {/* PWA */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#050b18" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Amiral Battı" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />

        {/* MOBİL AKICILIK — dokunma gecikmesi, kaydırma ve yazı tipi yumuşatma */}
        <style dangerouslySetInnerHTML={{__html: `
          * { -webkit-tap-highlight-color: transparent; }
          html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
          body {
            /* 300ms dokunma gecikmesini kaldırır — butonlar anında tepki verir */
            touch-action: manipulation;
            /* Kenarda lastik gibi esneme/yenileme mobilde kare düşürür */
            overscroll-behavior: none;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
            text-rendering: optimizeSpeed;
          }
          button { touch-action: manipulation; }
          img { content-visibility: auto; }
          /* Pil tasarrufu / erişilebilirlik modunda tüm süslemeler dursun */
          @media (prefers-reduced-motion: reduce) {
            *, *::before, *::after {
              animation-duration: 0.01ms !important;
              animation-iteration-count: 1 !important;
              transition-duration: 0.01ms !important;
            }
          }
        `}} />

        <script dangerouslySetInnerHTML={{__html: `
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', function() {
              navigator.serviceWorker.register('/sw.js');
            });
          }
        `}} />
      </head>
      <body style={{ margin: 0, padding: 0, background: "#0a0e17", overflowX: "hidden", width: "100%", maxWidth: "100vw" }}>
        {children}
      </body>
    </html>
  );
}
