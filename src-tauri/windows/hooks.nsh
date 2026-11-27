; Hook installer NSIS (Tauri 2: bundle.windows.nsis.installerHooks).
; Menghapus aturan firewall "Kasir Jet Pusat" saat Kasir Jet dihapus (rancangan 5.3).
; Aturannya dibuat aplikasi saat komputer dijadikan Pusat, dengan izin administrator. Installer sendiri tidak punya hak itu,
; jadi penghapusan juga meminta izin Windows (UAC), dan hanya bila aturannya memang ada.
; Tidak dijalankan saat pembaruan (/UPDATE) atau uninstall senyap (/S): aturan tetap dipakai oleh versi baru.

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
  ${AndIfNot} ${Silent}
    nsExec::ExecToStack 'netsh advfirewall firewall show rule name="Kasir Jet Pusat"'
    Pop $0
    Pop $1
    ${If} $0 = 0
      ExecShell "runas" "netsh.exe" 'advfirewall firewall delete rule name="Kasir Jet Pusat"' SW_HIDE
    ${EndIf}
  ${EndIf}
!macroend
