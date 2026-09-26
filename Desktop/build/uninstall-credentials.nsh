!macro customUnInstall
  ${ifNot} ${isUpdated}
    Delete "$APPDATA\Desktop for Step Code\step-runtime\auth.dpapi"
    Delete "$APPDATA\Desktop for Step Code\step-runtime\auth.json"
    Delete "$APPDATA\Desktop for Step Code\step-runtime\legacy-auth.json"
  ${endif}
!macroend
