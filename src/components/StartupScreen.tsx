import { Layers3 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getStartupExitDelay,
  STARTUP_EXIT_MS,
} from "../lib/startup";

type StartupScreenProps = {
  ready: boolean;
  onComplete: () => void;
};

function now() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function prefersReducedMotion() {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    return false;
  }
}

export function StartupScreen({ ready, onComplete }: StartupScreenProps) {
  const [exiting, setExiting] = useState(false);
  const startedAtRef = useRef(now());
  const exitStartedRef = useRef(false);
  const completedRef = useRef(false);
  const completionTimerRef = useRef<number | undefined>(undefined);
  const onCompleteRef = useRef(onComplete);
  const reducedMotionRef = useRef(prefersReducedMotion());

  onCompleteRef.current = onComplete;

  const finish = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    onCompleteRef.current();
  }, []);

  const beginExit = useCallback(() => {
    if (exitStartedRef.current) return;
    exitStartedRef.current = true;

    if (reducedMotionRef.current) {
      finish();
      return;
    }

    setExiting(true);
    completionTimerRef.current = window.setTimeout(finish, STARTUP_EXIT_MS);
  }, [finish]);

  useEffect(() => {
    const elapsed = now() - startedAtRef.current;
    const timeout = window.setTimeout(
      beginExit,
      getStartupExitDelay(elapsed, false, reducedMotionRef.current),
    );

    return () => window.clearTimeout(timeout);
  }, [beginExit]);

  useEffect(() => {
    if (!ready) return undefined;

    const elapsed = now() - startedAtRef.current;
    const timeout = window.setTimeout(
      beginExit,
      getStartupExitDelay(elapsed, true, reducedMotionRef.current),
    );

    return () => window.clearTimeout(timeout);
  }, [beginExit, ready]);

  useEffect(() => {
    return () => window.clearTimeout(completionTimerRef.current);
  }, []);

  return (
    <section
      className={`startup-screen ${exiting ? "startup-screen-exiting" : ""}`}
      data-tauri-drag-region
      role="status"
      aria-label="Daymark 正在启动"
      aria-live="polite"
    >
      <div className="startup-screen-content" aria-hidden="true">
        <Layers3 className="startup-screen-icon" size={30} strokeWidth={1.45} />
        <div className="startup-screen-brand">DAYMARK</div>
        <div className="startup-screen-tagline">把今天留下，让明天找得到。</div>
      </div>
    </section>
  );
}
