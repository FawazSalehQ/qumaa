; Custom NSIS uninstall step.
;
; The resume library lives in %APPDATA%\cv-filter, outside the install
; directory, so the standard uninstaller leaves it untouched. That is the right
; default: someone reinstalling expects their candidates to still be there, and
; silently deleting a recruiting database during an uninstall is unrecoverable.
;
; So the user is asked, and the default answer is No. MB_DEFBUTTON2 matters
; here: without it, a reflexive Enter on the dialog would wipe the library.

; electron-builder inserts customHeader after addLangs, at global scope. The
; LANG_* constants exist there; they do not yet exist when this file is included.
; Give every bundled installer language an explicit English fallback so NSIS's
; warnings-as-errors mode never encounters an undefined localized string.
!macro QumaaUninstallLanguage LANGUAGE
  !ifdef LANG_${LANGUAGE}
    !if "${LANGUAGE}" == "Arabic"
      LangString qumaaDeleteLibraryConfirmation ${LANG_${LANGUAGE}} \
        "هل تريد أيضًا حذف مكتبة السير الذاتية والإعدادات؟$\r$\n$\r$\nسيؤدي ذلك إلى حذف جميع السير الذاتية التي استوردتها. لن تتأثر الملفات الأصلية على جهازك.$\r$\n$\r$\nاختر لا للاحتفاظ بالمكتبة عند إعادة تثبيت التطبيق لاحقًا."
    !else
      LangString qumaaDeleteLibraryConfirmation ${LANG_${LANGUAGE}} \
        "Also delete your resume library and settings?$\r$\n$\r$\nThis removes every resume you imported. The original files on your computer are not affected.$\r$\n$\r$\nChoose No to keep the library for a future reinstall."
    !endif
  !endif
!macroend

!macro customHeader
  !ifdef BUILD_UNINSTALLER
    !insertmacro QumaaUninstallLanguage English
    !insertmacro QumaaUninstallLanguage German
    !insertmacro QumaaUninstallLanguage French
    !insertmacro QumaaUninstallLanguage SpanishInternational
    !insertmacro QumaaUninstallLanguage SimpChinese
    !insertmacro QumaaUninstallLanguage TradChinese
    !insertmacro QumaaUninstallLanguage Japanese
    !insertmacro QumaaUninstallLanguage Korean
    !insertmacro QumaaUninstallLanguage Italian
    !insertmacro QumaaUninstallLanguage Dutch
    !insertmacro QumaaUninstallLanguage Danish
    !insertmacro QumaaUninstallLanguage Swedish
    !insertmacro QumaaUninstallLanguage Norwegian
    !insertmacro QumaaUninstallLanguage Finnish
    !insertmacro QumaaUninstallLanguage Russian
    !insertmacro QumaaUninstallLanguage Portuguese
    !insertmacro QumaaUninstallLanguage PortugueseBR
    !insertmacro QumaaUninstallLanguage Polish
    !insertmacro QumaaUninstallLanguage Ukrainian
    !insertmacro QumaaUninstallLanguage Czech
    !insertmacro QumaaUninstallLanguage Slovak
    !insertmacro QumaaUninstallLanguage Hungarian
    !insertmacro QumaaUninstallLanguage Arabic
    !insertmacro QumaaUninstallLanguage Turkish
    !insertmacro QumaaUninstallLanguage Thai
    !insertmacro QumaaUninstallLanguage Vietnamese
  !endif
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    !ifdef LANG_Arabic
      ${if} $LANGUAGE == ${LANG_Arabic}
        MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2|MB_RTLREADING|MB_RIGHT \
          "$(qumaaDeleteLibraryConfirmation)" \
          /SD IDNO IDYES deleteData IDNO keepData
      ${endIf}
    !endif
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
      "$(qumaaDeleteLibraryConfirmation)" \
      /SD IDNO IDYES deleteData IDNO keepData
    deleteData:
      RMDir /r "$APPDATA\cv-filter"
    keepData:
  ${endIf}
!macroend
