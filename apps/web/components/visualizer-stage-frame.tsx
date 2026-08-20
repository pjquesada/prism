"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

type VisualizerStageFrameProps = {
  children: ReactNode;
  label: string;
  immersive?: boolean;
  showFullscreen?: boolean;
  className?: string;
};

function isFullscreenActive(target: HTMLElement | null): boolean {
  if (typeof document === "undefined") return false;
  return Boolean(target && document.fullscreenElement === target);
}

function readFullscreenSupported(): boolean {
  return typeof document.fullscreenEnabled === "boolean"
    ? document.fullscreenEnabled
    : typeof document.documentElement.requestFullscreen === "function";
}

/**
 * Display-stage shell that fills its parent. Canvas hosts must be position:absolute; inset:0.
 */
export function VisualizerStageFrame({
  children,
  label,
  immersive = false,
  showFullscreen = true,
  className,
}: VisualizerStageFrameProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const fullscreenSupported = useSyncExternalStore(
    () => () => undefined,
    readFullscreenSupported,
    () => false,
  );

  useEffect(() => {
    const onChange = () => {
      setFullscreen(isFullscreenActive(frameRef.current));
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = frameRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void el.requestFullscreen?.();
  }, []);

  return (
    <div
      className={["prism-visualizer-stage", className].filter(Boolean).join(" ")}
      data-testid="visualizer-stage"
    >
      <div
        ref={frameRef}
        className="prism-visualizer-stage-frame"
        data-immersive={immersive ? "true" : "false"}
        data-fullscreen={fullscreen ? "true" : "false"}
        role="region"
        aria-label={label}
      >
        {children}
        {showFullscreen && fullscreenSupported ? (
          <button
            type="button"
            className="prism-btn prism-btn-ghost absolute right-3 top-3 z-20 min-h-10 px-3 py-1 text-sm"
            data-testid="display-fullscreen"
            onClick={toggleFullscreen}
          >
            {fullscreen ? "Exit full screen" : "Full screen"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
