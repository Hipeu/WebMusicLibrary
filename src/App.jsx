import { useEffect, useState } from "react";
import MusicLibrary from "./pages/Library";
import SetupWizard from "./pages/SetupWizard";
import { getSettings } from "./services/api";

export default function App() {
  const setupRoute = window.location.pathname === "/setup";
  const [needsSetup, setNeedsSetup] = useState(setupRoute ? true : null);

  useEffect(() => {
    if (setupRoute) return;
    let cancelled = false;
    getSettings().then((result) => {
      if (cancelled) return;
      const required = result?.app_settings?.["setup-complete"] !== "1";
      if (required) window.history.replaceState(null, "", "/setup");
      setNeedsSetup(required);
    }).catch(() => { if (!cancelled) setNeedsSetup(false); });
    return () => { cancelled = true; };
  }, [setupRoute]);

  if (needsSetup === null) return <div className="app-startup-loading">正在读取设置…</div>;
  if (setupRoute || needsSetup) return <SetupWizard />;
  return <MusicLibrary />;
}
