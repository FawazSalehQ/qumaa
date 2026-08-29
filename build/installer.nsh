; Custom NSIS uninstall step.
;
; The resume library lives in %APPDATA%\cv-filter, outside the install
; directory, so the standard uninstaller leaves it untouched. That is the right
; default: someone reinstalling expects their candidates to still be there, and
; silently deleting a recruiting database during an uninstall is unrecoverable.
;
; So the user is asked, and the default answer is No. MB_DEFBUTTON2 matters
; here: without it, a reflexive Enter on the dialog would wipe the library.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
      "Also delete your resume library and settings?$\r$\n$\r$\nThis removes every resume you imported. The original files on your computer are not affected.$\r$\n$\r$\nChoose No to keep the library for a future reinstall." \
      /SD IDNO IDYES deleteData IDNO keepData
    deleteData:
      RMDir /r "$APPDATA\cv-filter"
    keepData:
  ${endIf}
!macroend
