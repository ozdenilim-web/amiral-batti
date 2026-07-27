import { PRIVACY_TEXT, PRIVACY_TEXT_EN } from "../Game";

export const metadata = {
  title: "Gizlilik Politikası — Amiral Battı",
  description: "Amiral Battı gizlilik politikası ve kullanım koşulları",
};

const S = {
  wrap: {
    minHeight: "100vh",
    background: "#0a0e17",
    color: "#e8edf5",
    padding: "32px 18px 64px",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  inner: { maxWidth: 720, margin: "0 auto" },
  topRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  back: {
    color: "#8fb3ff",
    textDecoration: "none",
    fontWeight: 700,
    fontSize: 15,
  },
  langLink: {
    color: "#8b93a7",
    textDecoration: "none",
    fontWeight: 700,
    fontSize: 13,
    border: "1px solid #2a3550",
    borderRadius: 8,
    padding: "4px 10px",
  },
  body: {
    fontSize: 13.5,
    lineHeight: 1.8,
    color: "#c7cedb",
    fontFamily: "var(--font-mono, monospace)",
    whiteSpace: "pre-wrap",
  },
};

export default function GizlilikPolitikasi({ searchParams }) {
  const lang = searchParams?.lang === "en" ? "en" : "tr";
  const text = lang === "en" ? PRIVACY_TEXT_EN : PRIVACY_TEXT;

  return (
    <div style={S.wrap}>
      <div style={S.inner}>
        <div style={S.topRow}>
          <a href="/" style={S.back}>&larr; {lang === "en" ? "Back to game" : "Oyuna dön"}</a>
          <a href={lang === "en" ? "?lang=tr" : "?lang=en"} style={S.langLink}>
            {lang === "en" ? "Türkçe" : "English"}
          </a>
        </div>
        <div style={S.body}>{text}</div>
      </div>
    </div>
  );
}
