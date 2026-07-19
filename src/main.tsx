import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { QuickCaptureHotzoneWindow, QuickCapturePanelWindow } from "./components/QuickCaptureWindow";
import "./index.css";
import { isDesktopRuntime } from "./lib/desktop";
import { applyThemeMode } from "./lib/theme";

applyThemeMode();

const windowLabel = isDesktopRuntime() ? getCurrentWindow().label : "main";
if (windowLabel === "quick-capture-hotzone" || windowLabel === "quick-capture-panel") {
  document.documentElement.dataset.window = windowLabel;
}
const RootView =
  windowLabel === "quick-capture-hotzone"
    ? QuickCaptureHotzoneWindow
    : windowLabel === "quick-capture-panel"
      ? QuickCapturePanelWindow
      : App;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootView />
  </React.StrictMode>,
);

if (windowLabel === "main" && isDesktopRuntime()) {
  void import("./qa/automation")
    .then(({ runQaAutomation }) => runQaAutomation())
    .catch(() => undefined);
}
