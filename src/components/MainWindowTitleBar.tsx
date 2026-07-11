import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Layers3, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { isDesktopRuntime } from "../lib/desktop";

export function MainWindowTitleBar() {
  const desktop = isDesktopRuntime();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!desktop) return undefined;

    const appWindow = getCurrentWindow();
    let active = true;

    const syncMaximizedState = async () => {
      const next = await appWindow.isMaximized().catch(() => false);
      if (active) setMaximized(next);
    };

    void syncMaximizedState();
    const unlistenPromise = appWindow.onResized(() => {
      void syncMaximizedState();
    });

    return () => {
      active = false;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [desktop]);

  if (!desktop) return null;

  const appWindow = getCurrentWindow();
  const runWindowAction = (action: Promise<void>) => {
    void action.catch((error) => {
      console.error("Daymark 窗口操作失败", error);
    });
  };

  const toggleMaximize = () => {
    runWindowAction(appWindow.toggleMaximize());
  };

  return (
    <header
      className="main-window-titlebar"
      data-tauri-drag-region
      onDoubleClick={toggleMaximize}
    >
      <div className="main-window-titlebar-brand" data-tauri-drag-region>
        <Layers3 size={15} strokeWidth={1.8} aria-hidden="true" />
        <span data-tauri-drag-region>Daymark</span>
      </div>
      <div className="main-window-titlebar-drag" data-tauri-drag-region />
      <div className="main-window-titlebar-controls" onDoubleClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="main-window-titlebar-button"
          onClick={() => runWindowAction(appWindow.minimize())}
          title="最小化"
          aria-label="最小化 Daymark"
        >
          <Minus size={16} strokeWidth={1.6} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="main-window-titlebar-button"
          onClick={toggleMaximize}
          title={maximized ? "还原" : "最大化"}
          aria-label={maximized ? "还原 Daymark 窗口" : "最大化 Daymark 窗口"}
        >
          {maximized ? (
            <Copy size={13} strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <Square size={13} strokeWidth={1.5} aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          className="main-window-titlebar-button main-window-titlebar-close"
          onClick={() => runWindowAction(appWindow.close())}
          title="关闭到托盘"
          aria-label="关闭 Daymark 到托盘"
        >
          <X size={17} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
