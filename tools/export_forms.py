#!/usr/bin/env python3
"""Ekspor form VB6 yang dipakai aplikasi ke src/vb/forms.json dan menu ke src/vb/menu.json."""
import json, os, re, sqlite3, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "..", "analisis", "ui", "forms.json")
OUT = os.path.join(ROOT, "src", "vb")
DB = os.path.expanduser("~/Library/Application Support/com.tokopro.app/tokopro.db")

WANT = re.compile(r"^(FrmMain|FrmZLogin|FrmZHome|FrmTransJual|FrmTransJualOrder|FrmTransBeliOrder|FrmTransJualBayar|FrmTransJualBayarCetak|FrmZOtentikasi|FrmTransBeli|FrmTransBeliBayar|"
                  r"FrmTransStokOpname|FrmTransJualRetur|FrmTransBeliRetur|FrmTransBeliReturBrg|FrmTransJualPiutang|FrmTransBeliHutang|FrmZPengaturan|FrmZPengguna|FrmZEditProfil|FrmMD.*|FrmData.*|FrmCari.*|FrmFilter.*|"
                  r"FrmTranskas|FrmTransKasAdd|FrmTransPoin|FrmTransPoinKoreksi|FrmZDatabase|FrmZAlat|FrmZAlatTgl|FrmZImportExcel|FrmTransStokAwal|FrmCetakBarcode|FrmKatalogBrg|FrmOpsiTextEkspor|FrmZUploadFoto|FrmZDashboard|frmNotification|FrmZSplash)$")
DROP = {"off", "blob_bytes"}


def clean(node):
    props = node.get("props", {})
    for k in list(props):
        v = props[k]
        if k == "Icon" or k in DROP:
            del props[k]
        elif k in ("Picture", "DownPicture", "DisabledPicture", "MouseIcon") and not (
                isinstance(v, str) and v.startswith("data:") and len(v) < 20000):
            del props[k]
    for k in DROP:
        node.pop(k, None)
    for ch in node.get("children", []):
        clean(ch)
    return node


def main():
    with open(SRC, encoding="utf-8") as f:
        forms = json.load(f)
    out = [clean(f) for f in forms if WANT.match(f["name"])]
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "forms.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(len(out), "form:", ", ".join(x["name"] for x in out))

    con = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
    rows = con.execute("select idmenu,namamenu,captionmenu,mlevel,parent,aktif from mdmenu order by idmenu").fetchall()
    con.close()
    nodes = {r[0]: {"id": r[0], "nama": r[1], "caption": r[2], "children": []} for r in rows if r[5] == 1}
    tree = []
    for r in rows:
        if r[5] != 1:
            continue
        if int(r[3]) == 0:
            tree.append(nodes[r[0]])
        elif r[4] in nodes:
            nodes[r[4]]["children"].append(nodes[r[0]])
    with open(os.path.join(OUT, "menu.json"), "w", encoding="utf-8") as f:
        json.dump(tree, f, ensure_ascii=False, indent=1)
    print(len(tree), "menu utama")


if __name__ == "__main__":
    sys.exit(main())
