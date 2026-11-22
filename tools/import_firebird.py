#!/usr/bin/env python3
"""Impor data dari datapos.fdb (Firebird 2.5) ke database SQLite aplikasi baru.

Membaca lewat isql di container Docker Firebird 2.5, lalu menulis ke SQLite
memakai schema.sql yang sama dengan yang dipakai aplikasi Rust.

Contoh:
  python3 -I tools/import_firebird.py \
      --container tokopro-fb --fdb /data/DATAPOS.FDB \
      --out "$HOME/Library/Application Support/com.tokopro.app/tokopro.db"

Catatan:
- Password user lama terenkripsi dengan algoritma VB6 (ModEncrypt) yang belum
  diketahui, jadi kolom pswduser diisi NULL. Aplikasi meminta user itu masuk
  dengan password "admin" lalu langsung membuat password baru.
- MDBARANG diimpor paling akhir supaya trigger stok tidak menghitung ulang
  mutasi transaksi lama (angka stok lama sudah final).
"""
import argparse
import os
import sqlite3
import subprocess
import sys

SEP = "\x1f"
START = "@@R@@"
END = "@@E@@"

ORDER = [
    "TSETING", "MDSATUAN", "MDKELOMPOK", "MDKATEGORI", "MDPELANGGAN", "MDPEMASOK",
    "MDKARYAWAN", "MDUSER", "MDMENU", "MDUSERMENU", "MDJENISNONTUNAI", "MDJENISNONTUNAIITEM",
    "MDBARANGBARCODE", "MDBARANGBONUS", "MDBARANGDISKON", "MDBARANGPDP",
    "TRANSAKSI", "TRANSAKSIDETIL", "TRANSAKSIPOIN", "TRKARTUPIUTANG", "TRKARTUPIUTANGDETIL",
    "KEUANGAN", "APPLOG",
    "MDBARANG",  # terakhir, lihat docstring
]


def isql(args, sql: str) -> str:
    cmd = ["docker", "exec", "-i", args.container, "/usr/local/firebird/bin/isql",
           "-user", "SYSDBA", "-password", args.password, args.fdb]
    res = subprocess.run(cmd, input=sql.encode("ascii"), capture_output=True, check=False)
    if res.returncode != 0:
        sys.exit(f"isql gagal: {res.stderr.decode('cp1252', 'replace')}")
    # Charset database NONE; teks aslinya dari Windows Indonesia, jadi cp1252.
    return res.stdout.decode("cp1252", "replace")


def columns(args, table):
    out = isql(args, (
        "set list on; select '" + START + "' || trim(rdb$field_name) || '" + END + "' as c "
        f"from rdb$relation_fields where rdb$relation_name='{table}' order by rdb$field_position;"
    ))
    return [line.split(START, 1)[1].split(END, 1)[0] for line in out.split("\n") if START in line]


def rows(args, table, cols):
    parts = []
    for c in cols:
        v = f'cast("{c}" as varchar(300))'
        v = f"replace(replace({v}, ascii_char(13), ' '), ascii_char(10), ' ')"
        parts.append(f"coalesce({v}, ascii_char(30))")  # ascii 30 = NULL
    expr = f" || ascii_char(31) || ".join(parts)
    out = isql(args, f"set list on; select '{START}' || {expr} || '{END}' as r from \"{table}\";")
    for line in out.split("\n"):
        if START not in line:
            continue
        body = line.split(START, 1)[1].rsplit(END, 1)[0]
        yield [None if v == "\x1e" else v for v in body.split(SEP)]


def convert(col, value):
    if value is None:
        return None
    lc = col.lower()
    if lc.startswith("jam") and len(value) > 8:
        return value[:8]
    return value


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--container", default="tokopro-fb")
    ap.add_argument("--fdb", default="/data/DATAPOS.FDB")
    ap.add_argument("--password", default="masterkey")
    ap.add_argument("--out", required=True)
    ap.add_argument("--force", action="store_true", help="timpa file SQLite yang sudah ada")
    args = ap.parse_args()

    if os.path.exists(args.out):
        if not args.force:
            sys.exit(f"{args.out} sudah ada. Pakai --force untuk menimpanya.")
        os.remove(args.out)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)

    schema_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src-tauri", "src", "schema.sql")
    with open(schema_path, encoding="utf-8") as f:
        schema = f.read()

    db = sqlite3.connect(args.out)
    db.executescript(schema)
    db.execute("PRAGMA foreign_keys = OFF")

    for table in ORDER:
        cols = columns(args, table)
        sqlite_cols = {r[1].lower() for r in db.execute(f"PRAGMA table_info({table.lower()})")}
        keep = [i for i, c in enumerate(cols) if c.lower() in sqlite_cols]
        if len(keep) != len(cols):
            missing = [c for c in cols if c.lower() not in sqlite_cols]
            print(f"  peringatan: kolom {table} tidak ada di SQLite: {missing}")
        names = [cols[i].lower() for i in keep]
        ph = ",".join("?" * len(names))
        sql = f'INSERT INTO {table.lower()} ({",".join(chr(34) + n + chr(34) for n in names)}) VALUES ({ph})'
        n = 0
        for r in rows(args, table, cols):
            if len(r) != len(cols):
                sys.exit(f"Baris {table} rusak: {len(r)} kolom, harusnya {len(cols)}")
            vals = [convert(cols[i], r[i]) for i in keep]
            if table == "MDUSER":
                vals[names.index("pswduser")] = None
            db.execute(sql, vals)
            n += 1
        print(f"{table:<22} {n:>6} baris")

    db.commit()
    db.execute("PRAGMA foreign_keys = ON")
    bad = db.execute("PRAGMA foreign_key_check").fetchall()
    if bad:
        print(f"peringatan: {len(bad)} baris melanggar foreign key, contoh: {bad[:3]}")
    db.close()
    print(f"Selesai: {args.out}")


if __name__ == "__main__":
    main()
