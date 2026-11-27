// Di form VB lama, Label, Shape, Image, Line, dan Frame tidak bisa menerima fokus: mengkliknya tidak memindahkan kursor
// dari kotak yang sedang aktif. Di webview, klik di elemen seperti itu membuang fokus ke body (mis. kotak scan kasir
// kehilangan kursor dan tabel tampak aktif). Aturan ini berlaku untuk semua layar dan dialog.

/** Elemen yang memang kontrol (bisa difokus atau dipakai dengan mouse); klik di sini dibiarkan apa adanya. */
const KONTROL = [
  "input", "textarea", "select", "button", "a[href]", "label", "summary",
  "[tabindex]", "[contenteditable='true']", ".select-text",
  "[role='option']", "[role='menuitem']", "[role='tab']", "[role='checkbox']", "[role='radio']",
  "[role='slider']", "[role='switch']", "[role='scrollbar']",
].join(", ");

export function pasangTahanFokus() {
  document.addEventListener(
    "mousedown",
    (e) => {
      if (e.button !== 0) return;
      const t = e.target;
      if (!(t instanceof Element) || t.closest(KONTROL)) return;
      e.preventDefault();
    },
    true,
  );
}
