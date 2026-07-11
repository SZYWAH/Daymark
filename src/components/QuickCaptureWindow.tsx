import { AppWindow, Check, GripHorizontal, Loader2, RotateCcw, X } from "lucide-react";
import {
  Component,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createJournalEntry } from "../data/itemStore";
import {
  getQuickCapturePanelToken,
  getQuickCaptureRuntimeState,
  collapseQuickCaptureIfPointerOutside,
  finalizeQuickCaptureDrag,
  hideQuickCapturePanel,
  isDesktopRuntime,
  notifyQuickCaptureSaved,
  openMainFromQuickCapture,
  quickCaptureWindowReady,
  returnQuickCaptureToHotzone,
  setQuickCaptureSaving,
  showQuickCapturePanel,
} from "../lib/desktop";
import { getSafeErrorMessage } from "../lib/redaction";
import { applyThemeMode, bindSystemThemeListener, getThemeMode } from "../lib/theme";

const QUICK_CAPTURE_DRAFT_KEY = "personal-knowledge-base:quick-capture-draft:v1";
const QUICK_CAPTURE_DIRTY_KEY = "personal-knowledge-base:quick-capture-dirty:v1";
export function QuickCaptureHotzoneWindow() {
  const openingRef = useRef(false);
  const readyTokenRef = useRef(0);

  useQuickCaptureDocument("quick-capture-hotzone");

  useEffect(() => {
    let disposed = false;
    let unlistenHotzoneShow: (() => void) | undefined;
    let unlistenHotzoneHide: (() => void) | undefined;
    const reportHotzoneToken = async (token: number) => {
      if (!token) return;
      readyTokenRef.current = token;
      await reportQuickCaptureReady("quick-capture-hotzone", token);
    };

    const reportCurrentHotzone = async () => {
      const state = await getQuickCaptureRuntimeState();
      if (state?.state === "HotzoneVisible" && state.hotzoneToken) {
        await reportHotzoneToken(state.hotzoneToken);
      }
    };

    const frame = window.requestAnimationFrame(() => {
      void reportCurrentHotzone().catch(() => undefined);
    });
    const timer = window.setTimeout(() => {
      void reportCurrentHotzone().catch(() => undefined);
    }, 140);
    const lateTimer = window.setTimeout(() => {
      void reportCurrentHotzone().catch(() => undefined);
    }, 520);
    const safetyPoll = window.setInterval(() => {
      void reportCurrentHotzone().catch(() => undefined);
    }, 700);

    if (isDesktopRuntime()) {
      void listen<number>("quick-capture:hotzone-show", (event) => {
        applyThemeMode();
        void reportHotzoneToken(event.payload).catch(() => undefined);
      }).then((handler) => {
        if (disposed) {
          handler();
          return;
        }
        unlistenHotzoneShow = handler;
      }).catch(() => undefined);

      void listen<number>("quick-capture:hotzone-hide", (event) => {
        if (event.payload && readyTokenRef.current && event.payload !== readyTokenRef.current) return;
        readyTokenRef.current = 0;
        openingRef.current = false;
      }).then((handler) => {
        if (disposed) {
          handler();
          return;
        }
        unlistenHotzoneHide = handler;
      }).catch(() => undefined);
    }

    return () => {
      disposed = true;
      unlistenHotzoneShow?.();
      unlistenHotzoneHide?.();
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      window.clearTimeout(lateTimer);
      window.clearInterval(safetyPoll);
    };
  }, []);

  const openFromHotzone = (trigger: "hover" | "click" = "click") => {
    if (openingRef.current) return;
    const hotzoneToken = readyTokenRef.current || undefined;
    openingRef.current = true;
    void showQuickCapturePanel(hotzoneToken, trigger).then((opened) => {
      if (opened) {
        openingRef.current = false;
        return;
      }
      window.setTimeout(() => {
        void getQuickCaptureRuntimeState().then((state) => {
          const latestToken = state?.state === "HotzoneVisible" ? state.hotzoneToken : hotzoneToken;
          return showQuickCapturePanel(latestToken || undefined, trigger);
        }).finally(() => {
          openingRef.current = false;
        });
      }, 320);
    });
    window.setTimeout(() => {
      openingRef.current = false;
    }, 900);
  };

  return (
    <main
      className="quick-capture-hotzone-screen"
      onClick={() => openFromHotzone("click")}
    >
      <button
        className="quick-capture-hotzone-pill"
        type="button"
        aria-label="打开快速记录"
        onClick={(event) => {
          event.stopPropagation();
          openFromHotzone("click");
        }}
        title="打开快速记录"
      >
        <span className="quick-capture-hotzone-glow" />
      </button>
    </main>
  );
}

export function QuickCapturePanelWindow() {
  useQuickCaptureDocument("quick-capture-panel");

  return (
    <QuickCapturePanelBoundary>
      <QuickCaptureStablePanel />
    </QuickCapturePanelBoundary>
  );
}

class QuickCapturePanelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.setState({ failed: true });
  }

  render() {
    if (this.state.failed) return <QuickCaptureEmergencyPanel />;
    return this.props.children;
  }
}

function QuickCaptureEmergencyPanel() {
  useEffect(() => {
    const reportEmergencyReady = () => {
      void getQuickCaptureRuntimeState()
        .then((runtime) => {
          if (!runtime || (runtime.state !== "PanelOpen" && runtime.state !== "PanelDetached") || !runtime.panelToken) return;
          return reportQuickCaptureReady("quick-capture-panel", runtime.panelToken);
        })
        .catch(() => undefined);
    };
    const frame = window.requestAnimationFrame(reportEmergencyReady);
    const timers = [80, 240, 700].map((delay) => window.setTimeout(reportEmergencyReady, delay));
    return () => {
      window.cancelAnimationFrame(frame);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  return (
    <main className="quick-capture-panel-screen quick-capture-panel-screen-fallback">
      <div className="quick-capture-panel-motion quick-capture-panel-fallback">
        <div className="quick-capture-panel-content">
          <header className="quick-capture-panel-header">
            <div className="min-w-0 flex-1">
              <p className="quick-capture-kicker">Quick Capture</p>
              <h1 className="quick-capture-title">快速记录暂时不可用</h1>
            </div>
            <div className="quick-capture-window-actions">
              <QuickCaptureOpenMainButton />
              <button className="quick-capture-icon-button" type="button" onClick={() => void hideQuickCapturePanel()} title="收起" aria-label="收起快速记录">
                <X size={15} />
              </button>
            </div>
          </header>
          <div className="quick-capture-input flex items-center text-sm text-white/58">
            这次悬浮窗渲染失败了。草稿仍保留在本地，重新打开快速记录即可继续。
          </div>
          <footer className="quick-capture-panel-footer">
            <div className="quick-capture-status">这次没有新增到日志；草稿仍在本地。</div>
          </footer>
        </div>
      </div>
    </main>
  );
}

function QuickCaptureOpenMainButton({
  disabled = false,
  onError,
}: {
  disabled?: boolean;
  onError?: (error: unknown) => void;
}) {
  const [opening, setOpening] = useState(false);
  const buttonDisabled = disabled || opening;

  const openMain = async () => {
    if (buttonDisabled) return;
    setOpening(true);
    try {
      await openMainFromQuickCapture();
    } catch (error) {
      onError?.(error);
    } finally {
      setOpening(false);
    }
  };

  return (
    <button
      className="quick-capture-icon-button"
      type="button"
      disabled={buttonDisabled}
      onClick={() => void openMain()}
      title="打开 Daymark"
      aria-label="打开 Daymark"
    >
      <AppWindow size={14} />
    </button>
  );
}

function QuickCaptureStablePanel() {
  const [content, setContent] = useState(readQuickCaptureDraft);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"neutral" | "error">("neutral");
  const [runtimeHint, setRuntimeHint] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedClosing, setSavedClosing] = useState(false);
  const [detached, setDetached] = useState(false);
  const savingRef = useRef(false);
  const savedClosingRef = useRef(false);
  const contentRef = useRef(content);
  const composingRef = useRef(false);
  const draggingRef = useRef(false);
  const pointerInsideRef = useRef(false);
  const saveCloseTimerRef = useRef<number | undefined>(undefined);
  const saveCloseFallbackTimerRef = useRef<number | undefined>(undefined);
  const leaveTimerRef = useRef<number | undefined>(undefined);
  const dragFinalizeTimerRef = useRef<number | undefined>(undefined);
  const focusTimerRefs = useRef<number[]>([]);
  const panelTokenRef = useRef<number | undefined>(undefined);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const clearAutoTimers = () => {
    window.clearTimeout(saveCloseTimerRef.current);
    window.clearTimeout(saveCloseFallbackTimerRef.current);
    window.clearTimeout(leaveTimerRef.current);
    saveCloseTimerRef.current = undefined;
    saveCloseFallbackTimerRef.current = undefined;
    leaveTimerRef.current = undefined;
  };

  const updateSavedClosing = (value: boolean) => {
    savedClosingRef.current = value;
    setSavedClosing(value);
  };

  const showStatus = (value: string, tone: "neutral" | "error" = "neutral") => {
    setMessage(value);
    setMessageTone(tone);
  };

  const isCurrentPanelToken = (token?: number) => Boolean(token && token === panelTokenRef.current);

  const resolvePanelToken = async () => {
    if (panelTokenRef.current) return panelTokenRef.current;
    const token = await getQuickCapturePanelToken().catch(() => 0);
    if (!token) return undefined;
    panelTokenRef.current = token;
    return token;
  };

  const clearDragTimers = () => {
    window.clearTimeout(dragFinalizeTimerRef.current);
    dragFinalizeTimerRef.current = undefined;
  };

  const clearFocusTimers = () => {
    focusTimerRefs.current.forEach((timer) => window.clearTimeout(timer));
    focusTimerRefs.current = [];
  };

  const focusAtEnd = (force = false, expectedToken?: number) => {
    if (expectedToken && expectedToken !== panelTokenRef.current) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    const alreadyFocused = document.activeElement === textarea;
    const idleFocus =
      document.activeElement === document.body ||
      document.activeElement === document.documentElement ||
      document.activeElement === null;
    if (!force && !alreadyFocused && !idleFocus) return;
    if ((force || !alreadyFocused) && isDesktopRuntime()) {
      void getCurrentWindow().setFocus().catch(() => undefined);
    }
    if (force || !alreadyFocused) {
      textarea.focus();
      const end = textarea.value.length;
      textarea.setSelectionRange(end, end);
      textarea.scrollTop = textarea.scrollHeight;
    }
  };

  const scheduleFocusAtEnd = (token: number) => {
    clearFocusTimers();
    [30, 150, 400, 900].forEach((delay) => {
      const timer = window.setTimeout(() => focusAtEnd(delay === 30, token), delay);
      focusTimerRefs.current.push(timer);
    });
  };

  const finalizeWindowDrag = async () => {
    clearDragTimers();
    draggingRef.current = false;
    let token = await resolvePanelToken();
    let result = await finalizeQuickCaptureDrag(token).catch(() => null);
    if (result?.stillDragging) {
      draggingRef.current = true;
      finishWindowDrag();
      return;
    }
    if (result && !result.applied) {
      const runtime = await getQuickCaptureRuntimeState().catch(() => null);
      if (runtime?.panelToken && runtime.panelToken !== token) {
        token = runtime.panelToken;
        panelTokenRef.current = token;
        result = await finalizeQuickCaptureDrag(token).catch(() => null);
      }
    }
    if (result?.stillDragging) {
      draggingRef.current = true;
      finishWindowDrag();
      return;
    }
    if (!result?.applied) return;
    setDetached(result.detached);
    if (!result.detached && result.pointerOutside) {
      pointerInsideRef.current = false;
      scheduleAutoClose();
    }
  };

  const finishWindowDrag = () => {
    if (!draggingRef.current) return;
    clearDragTimers();
    dragFinalizeTimerRef.current = window.setTimeout(() => {
      void finalizeWindowDrag();
    }, 180);
  };

  const startWindowDrag = async (event: ReactPointerEvent<HTMLElement>) => {
    if (savingRef.current || savedClosingRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    draggingRef.current = true;
    cancelAutoClose();
    try {
      await getCurrentWindow().startDragging();
      finishWindowDrag();
    } catch {
      draggingRef.current = false;
    }
  };

  const runWithLatestPanelToken = async (action: (token?: number) => Promise<boolean>) => {
    let token = await resolvePanelToken();
    let completed = await action(token);
    if (completed) return true;
    const runtime = await getQuickCaptureRuntimeState().catch(() => null);
    if (
      runtime?.panelToken
      && runtime.panelToken !== token
      && (runtime.state === "PanelOpen" || runtime.state === "PanelDetached")
    ) {
      token = runtime.panelToken;
      panelTokenRef.current = token;
      completed = await action(token);
    }
    return completed;
  };

  const returnToHotzone = async () => {
    if (savingRef.current || savedClosingRef.current) return;
    await runWithLatestPanelToken(returnQuickCaptureToHotzone);
  };

  const closePanel = async () => {
    if (savingRef.current || savedClosingRef.current) return;
    const runtime = await getQuickCaptureRuntimeState().catch(() => null);
    if (runtime?.state === "PanelDetached") {
      setDetached(true);
      await runWithLatestPanelToken(returnQuickCaptureToHotzone);
      return;
    }
    setDetached(false);
    await runWithLatestPanelToken(hideQuickCapturePanel);
  };

  const cancelAutoClose = () => {
    window.clearTimeout(leaveTimerRef.current);
  };

  const scheduleAutoClose = () => {
    if (savingRef.current || savedClosingRef.current) return;
    if (draggingRef.current) return;
    window.clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = window.setTimeout(() => {
      if (draggingRef.current) return;
      void runWithLatestPanelToken(collapseQuickCaptureIfPointerOutside);
    }, contentRef.current.trim() ? 1_800 : 720);
  };

  const handlePointerEnter = () => {
    pointerInsideRef.current = true;
    cancelAutoClose();
  };

  const handlePointerLeave = () => {
    pointerInsideRef.current = false;
    scheduleAutoClose();
  };

  useEffect(() => {
    contentRef.current = content;
    writeQuickCaptureDraft(content);
  }, [content]);

  useEffect(() => {
    const finishIfDragging = () => {
      if (draggingRef.current) finishWindowDrag();
    };
    window.addEventListener("pointerup", finishIfDragging, true);
    window.addEventListener("pointercancel", finishIfDragging, true);
    window.addEventListener("blur", finishIfDragging);
    document.addEventListener("visibilitychange", finishIfDragging);
    return () => {
      window.removeEventListener("pointerup", finishIfDragging, true);
      window.removeEventListener("pointercancel", finishIfDragging, true);
      window.removeEventListener("blur", finishIfDragging);
      document.removeEventListener("visibilitychange", finishIfDragging);
    };
  }, []);

  useEffect(() => {
    const syncVisiblePanel = (forceFocus = false) => {
      if (!isDesktopRuntime()) return;
      void getQuickCaptureRuntimeState()
        .then((runtime) => {
          if (!runtime || (runtime.state !== "PanelOpen" && runtime.state !== "PanelDetached") || !runtime.panelToken) return;
          panelTokenRef.current = runtime.panelToken;
          setDetached(runtime.state === "PanelDetached");
          if (runtime.degraded) {
            setRuntimeHint(runtime.degradedReason || "顶部悬浮暂时不可用，仍可用托盘或快捷键继续记录。");
          } else if (runtime.escapeAvailable === false) {
            setRuntimeHint("Esc 可能不可用，可以用右上角收起按钮关闭。");
          } else {
            setRuntimeHint("");
          }
          focusAtEnd(forceFocus, runtime.panelToken);
          void reportQuickCaptureReady("quick-capture-panel", runtime.panelToken).catch(() => undefined);
        })
        .catch(() => undefined);
    };
    window.setTimeout(() => syncVisiblePanel(true), 30);
    window.setTimeout(() => syncVisiblePanel(false), 150);
    window.setTimeout(() => syncVisiblePanel(false), 400);
    const poll = window.setInterval(syncVisiblePanel, 700);
    let unlistenMoved: (() => void) | undefined;
    if (isDesktopRuntime()) {
      void getCurrentWindow().onMoved(() => {
        if (!draggingRef.current) return;
        finishWindowDrag();
      }).then((handler) => {
        unlistenMoved = handler;
      }).catch(() => undefined);
    }
    return () => {
      window.clearInterval(poll);
      clearAutoTimers();
      clearDragTimers();
      clearFocusTimers();
      unlistenMoved?.();
    };
  }, []);

  useEffect(() => {
    if (!isDesktopRuntime()) return undefined;

    let disposed = false;
    let unlistenPanelShow: (() => void) | undefined;
    let unlistenPanelHide: (() => void) | undefined;
    let unlistenCollapseRequest: (() => void) | undefined;

    void listen<number>("quick-capture:panel-show", (event) => {
      applyThemeMode();
      clearAutoTimers();
      clearDragTimers();
      clearFocusTimers();
      draggingRef.current = false;
      panelTokenRef.current = event.payload;
      void getQuickCaptureRuntimeState()
        .then((runtime) => {
          setDetached(runtime?.state === "PanelDetached");
          if (runtime?.degraded) {
            setRuntimeHint(runtime.degradedReason || "顶部悬浮暂时不可用，仍可用托盘或快捷键继续记录。");
          } else if (runtime?.escapeAvailable === false) {
            setRuntimeHint("Esc 可能不可用，可以用右上角收起按钮关闭。");
          } else {
            setRuntimeHint("");
          }
        })
        .catch(() => setDetached(false));
      updateSavedClosing(false);
      showStatus("");
      scheduleFocusAtEnd(event.payload);
      window.setTimeout(() => {
        void reportQuickCaptureReady("quick-capture-panel", event.payload).catch(() => undefined);
      }, 60);
    }).then((handler) => {
      if (disposed) {
        handler();
        return;
      }
      unlistenPanelShow = handler;
    }).catch(() => undefined);

    void listen<number>("quick-capture:panel-hide", (event) => {
      if (event.payload && panelTokenRef.current && event.payload !== panelTokenRef.current) return;
      clearAutoTimers();
      clearDragTimers();
      clearFocusTimers();
      draggingRef.current = false;
      if (!event.payload || event.payload === panelTokenRef.current) {
        panelTokenRef.current = undefined;
      }
      setDetached(false);
      updateSavedClosing(false);
      setRuntimeHint("");
    }).then((handler) => {
      if (disposed) {
        handler();
        return;
      }
      unlistenPanelHide = handler;
    }).catch(() => undefined);

    void listen<number>("quick-capture:collapse-request", (event) => {
      if (event.payload) {
        panelTokenRef.current = event.payload;
      }
      void closePanel().catch(() => hideQuickCapturePanel(panelTokenRef.current));
    }).then((handler) => {
      if (disposed) {
        handler();
        return;
      }
      unlistenCollapseRequest = handler;
    }).catch(() => undefined);

    return () => {
      disposed = true;
      clearAutoTimers();
      clearDragTimers();
      clearFocusTimers();
      unlistenPanelShow?.();
      unlistenPanelHide?.();
      unlistenCollapseRequest?.();
    };
  }, []);

  useEffect(() => {
    const onQuickCaptureKey = (event: KeyboardEvent) => {
      if (event.type !== "keydown") return;
      if (event.isComposing || composingRef.current || event.key === "Process" || event.keyCode === 229) return;
      if (isEscapeKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        void closePanel().catch(() => hideQuickCapturePanel(panelTokenRef.current));
        return;
      }

      if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) {
          void save();
        }
      }
    };

    window.addEventListener("keydown", onQuickCaptureKey, true);
    return () => {
      window.removeEventListener("keydown", onQuickCaptureKey, true);
    };
  }, [content, saving]);

  const save = async () => {
    const value = content.trim();
    if (!value || savingRef.current || savedClosingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    const saveToken = await resolvePanelToken();
    if (!isCurrentPanelToken(saveToken)) {
      showStatus("这次快速记录窗口已经过期，请重新打开后保存。", "error");
      savingRef.current = false;
      setSaving(false);
      return;
    }
    await setQuickCaptureSaving(true, saveToken).catch(() => undefined);
    showStatus("正在留下...");
    try {
      await createJournalEntry({ content: value, tags: [], todos: [] });
      markQuickCaptureDirty();
      clearQuickCaptureDraftIfCurrent(value);
      setContent("");
      const notified = await notifyQuickCaptureSaved(saveToken)
        .catch(() => false);
      if (!isCurrentPanelToken(saveToken)) {
        updateSavedClosing(false);
        showStatus(notified ? "已留下。当前打开的是新的快速记录窗口，可以继续记录。" : "已保存。当前窗口已经更新，可以继续使用。");
        return;
      }
      updateSavedClosing(true);
      showStatus(notified ? "已留下，稍后再慢慢整理。" : "已保存。重新打开主窗口后会自动刷新。");
      saveCloseTimerRef.current = window.setTimeout(() => {
        if (!isCurrentPanelToken(saveToken)) return;
        void hideQuickCapturePanel(saveToken).then((hidden) => {
          if (!isCurrentPanelToken(saveToken) || hidden) return;
          updateSavedClosing(false);
          showStatus("已留下，但悬浮窗没有自动收起，可以继续记录或手动收起。", "error");
        });
      }, 760);
      saveCloseFallbackTimerRef.current = window.setTimeout(() => {
        if (!isCurrentPanelToken(saveToken) || !savedClosingRef.current) return;
        updateSavedClosing(false);
        showStatus("已留下，但悬浮窗没有自动收起，可以继续记录或手动收起。", "error");
      }, 2_800);
    } catch (error) {
      const safeError = getSafeErrorMessage(error, "");
      const detail = safeError ? `：${safeError}` : "";
      showStatus(`没保存上，内容还在这里，可以再试${detail}`, "error");
    } finally {
      await setQuickCaptureSaving(false, saveToken).catch(() => undefined);
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleContentChange = (value: string) => {
    window.clearTimeout(saveCloseTimerRef.current);
    window.clearTimeout(saveCloseFallbackTimerRef.current);
    saveCloseTimerRef.current = undefined;
    saveCloseFallbackTimerRef.current = undefined;
    cancelAutoClose();
    contentRef.current = value;
    if (!savingRef.current && message) showStatus("");
    writeQuickCaptureDraft(value);
    setContent(value);
  };

  return (
    <main className="quick-capture-panel-screen">
      <div
        className="quick-capture-panel-motion"
        onPointerEnter={handlePointerEnter}
        onPointerUp={finishWindowDrag}
        onPointerCancel={finishWindowDrag}
        onPointerLeave={handlePointerLeave}
      >
        <div className="quick-capture-panel-content">
          <header className="quick-capture-panel-header">
            <button className="quick-capture-drag-handle" type="button" onPointerDown={startWindowDrag} title="拖动快速记录" aria-label="拖动快速记录">
              <GripHorizontal size={14} />
              <span className="min-w-0">
                <span className="quick-capture-kicker">Quick Capture</span>
                <span className="quick-capture-title">快速记录</span>
              </span>
            </button>
            <div className="quick-capture-window-actions">
              <QuickCaptureOpenMainButton
                disabled={saving || savedClosing}
                onError={(error) => {
                  const safeError = getSafeErrorMessage(error, "");
                  const detail = safeError ? `：${safeError}` : "";
                  showStatus(`没打开 Daymark，可以再试${detail}`, "error");
                }}
              />
              {detached && (
                <button className="quick-capture-icon-button" type="button" onClick={() => void returnToHotzone()} title="回到顶部热区" aria-label="回到顶部热区并收起快速记录">
                  <RotateCcw size={14} />
                </button>
              )}
              <button className="quick-capture-icon-button" type="button" onClick={() => void closePanel()} title="收起" aria-label="收起快速记录">
                <X size={15} />
              </button>
            </div>
          </header>
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(event) => handleContentChange(event.target.value)}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            autoFocus
            disabled={saving || savedClosing}
            spellCheck={false}
            placeholder="写下或粘贴刚想到的内容。"
            className="quick-capture-input"
          />
          <footer className="quick-capture-panel-footer">
            <div className={`quick-capture-status ${messageTone === "error" ? "quick-capture-status-error" : ""}`} role="status" aria-live="polite">
              {message || runtimeHint || (detached ? "已固定在当前位置。Esc 或归位会回到顶部。" : "离开会自动收起，草稿会保留。Enter 留下，Shift + Enter 换行。")}
            </div>
            <button className="quick-capture-primary" type="button" disabled={!content.trim() || saving || savedClosing} onClick={() => void save()}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              {saving ? "正在留下" : "留下"}
            </button>
          </footer>
        </div>
      </div>
    </main>
  );
}

function useQuickCaptureDocument(windowName: string) {
  useEffect(() => {
    try {
      applyThemeMode();
    } catch {
      document.documentElement.dataset.theme = "dark";
      document.documentElement.dataset.themeMode = "dark";
    }
    document.documentElement.dataset.window = windowName;
    const unbindTheme = bindSystemThemeListener(getThemeMode);
    if (isDesktopRuntime()) {
      window.requestAnimationFrame(() => {
        void quickCaptureWindowReady(windowName).catch(() => undefined);
      });
      window.setTimeout(() => {
        void quickCaptureWindowReady(windowName).catch(() => undefined);
      }, 500);
    }

    return () => {
      unbindTheme();
      delete document.documentElement.dataset.window;
    };
  }, [windowName]);
}

async function reportQuickCaptureReady(label: string, token?: number) {
  const needsToken = label === "quick-capture-panel" || label === "quick-capture-hotzone";
  if (needsToken && !token) {
    return;
  }
  await quickCaptureWindowReady(label, needsToken ? token : undefined);
}

function readQuickCaptureDraft() {
  try {
    return window.localStorage.getItem(QUICK_CAPTURE_DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

function isEscapeKey(event: KeyboardEvent | React.KeyboardEvent<HTMLElement>) {
  return event.key === "Escape" || event.key === "Esc" || event.keyCode === 27 || event.which === 27;
}

function writeQuickCaptureDraft(value: string) {
  try {
    if (value.length === 0) {
      window.localStorage.removeItem(QUICK_CAPTURE_DRAFT_KEY);
      return;
    }
    window.localStorage.setItem(QUICK_CAPTURE_DRAFT_KEY, value);
  } catch {
    // Draft persistence is best-effort; saving the journal entry remains explicit.
  }
}

function clearQuickCaptureDraftIfCurrent(value: string) {
  try {
    if ((window.localStorage.getItem(QUICK_CAPTURE_DRAFT_KEY) ?? "").trim() === value.trim()) {
      window.localStorage.removeItem(QUICK_CAPTURE_DRAFT_KEY);
    }
  } catch {
    // Ignore storage cleanup failures in the floating window.
  }
}

function markQuickCaptureDirty() {
  try {
    window.localStorage.setItem(QUICK_CAPTURE_DIRTY_KEY, String(Date.now()));
  } catch {
    // The saved entry is already in IndexedDB; this only helps the main window refresh.
  }
}
