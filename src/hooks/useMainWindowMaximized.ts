import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { isDesktopRuntime } from "../lib/desktop";

const WEB_PREVIEW_MIN_WIDTH = 1600;

export function useMainWindowMaximized() {
  const desktop = isDesktopRuntime();
  const [maximized, setMaximized] = useState(() =>
    !desktop && typeof window !== "undefined" ? window.innerWidth >= WEB_PREVIEW_MIN_WIDTH : false,
  );

  useEffect(() => {
    if (!desktop) {
      const syncPreviewState = () => setMaximized(window.innerWidth >= WEB_PREVIEW_MIN_WIDTH);
      syncPreviewState();
      window.addEventListener("resize", syncPreviewState);
      return () => window.removeEventListener("resize", syncPreviewState);
    }

    const appWindow = getCurrentWindow();
    let active = true;
    const sync = async () => {
      const next = await appWindow.isMaximized().catch(() => false);
      if (active) setMaximized(next);
    };

    void sync();
    const unlistenPromise = appWindow.onResized(() => {
      void sync();
    });

    return () => {
      active = false;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [desktop]);

  return maximized;
}
