import { useEffect, useState } from "react";

/** A short build label: version details in the desktop app, or a note that this is the browser preview. */
export function useBuildLabel(): string {
  const [label, setLabel] = useState(window.embercrawl ? "Desktop build" : "Browser preview");
  useEffect(() => {
    let active = true;
    window.embercrawl?.getAppInfo().then((info) => {
      if (active) setLabel(`v${info.version} · Electron ${info.electron} · ${info.arch}`);
    });
    return () => {
      active = false;
    };
  }, []);
  return label;
}
