import { useCallback, useEffect, useRef, useState, type WheelEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { app, useApp } from "../lib/store";
import { errorMessage } from "../lib/api";
import css from "./Lightbox.module.css";

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6];

/** Fullscreen image viewer. `zoom === 0` means "fit to window". */
export default function Lightbox() {
  const lightbox = useApp((s) => s.lightbox);
  const [zoom, setZoom] = useState(0);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const stage = useRef<HTMLDivElement>(null);

  const item = lightbox ? lightbox.items[lightbox.index] : null;
  const count = lightbox?.items.length ?? 0;
  const index = lightbox?.index ?? 0;

  useEffect(() => {
    setZoom(0);
    setLoaded(false);
    setFailed(false);
  }, [item?.src]);

  const go = useCallback(
    (delta: number) => {
      if (!lightbox || count < 2) return;
      app.setLightboxIndex((lightbox.index + delta + count) % count);
    },
    [lightbox, count],
  );

  const fitScale = useCallback((): number => {
    const el = stage.current;
    if (!el || !natural.w || !natural.h) return 1;
    return Math.min(1, (el.clientWidth - 32) / natural.w, (el.clientHeight - 32) / natural.h);
  }, [natural]);

  const effective = zoom === 0 ? fitScale() : zoom;

  function zoomBy(direction: 1 | -1) {
    const cur = effective;
    const next =
      direction > 0
        ? (ZOOM_STEPS.find((z) => z > cur + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1])
        : ([...ZOOM_STEPS].reverse().find((z) => z < cur - 0.001) ?? ZOOM_STEPS[0]);
    setZoom(next);
  }

  useEffect(() => {
    if (!lightbox) return;
    function onKey(e: KeyboardEvent) {
      switch (e.key) {
        case "Escape":
          app.closeLightbox();
          break;
        case "ArrowRight":
        case "j":
        case " ":
          go(1);
          break;
        case "ArrowLeft":
        case "k":
          go(-1);
          break;
        case "+":
        case "=":
          zoomBy(1);
          break;
        case "-":
        case "_":
          zoomBy(-1);
          break;
        case "0":
        case "f":
          setZoom(0);
          break;
        case "1":
          setZoom(1);
          break;
        default:
          return;
      }
      e.preventDefault();
      e.stopPropagation();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  if (!lightbox || !item) return null;

  function onWheel(e: WheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1 : -1);
  }

  const sized = zoom !== 0 && natural.w > 0;
  const width = sized ? Math.round(natural.w * zoom) : undefined;
  const height = sized ? Math.round(natural.h * zoom) : undefined;

  return (
    <div className={css.overlay} onClick={() => app.closeLightbox()} role="dialog" aria-label={item.title}>
      <div className={css.top} onClick={(e) => e.stopPropagation()}>
        <span className={css.title} title={item.title}>
          {item.title}
        </span>
        {count > 1 && (
          <span className={`muted ${css.counter}`}>
            {index + 1} / {count}
          </span>
        )}
        {natural.w > 0 && (
          <span className={`muted ${css.dims}`}>
            {natural.w}×{natural.h} · {Math.round(effective * 100)}%
          </span>
        )}
        <span className={css.grow}></span>
        <button className={css.btn} onClick={() => zoomBy(-1)} title="Zoom out (−)">
          −
        </button>
        <button className={css.btn} onClick={() => zoomBy(1)} title="Zoom in (+)">
          +
        </button>
        <button className={`${css.btn} ${zoom === 0 ? css.on : ""}`} onClick={() => setZoom(0)} title="Fit to window (0)">
          Fit
        </button>
        <button className={`${css.btn} ${zoom === 1 ? css.on : ""}`} onClick={() => setZoom(1)} title="Actual size (1)">
          100%
        </button>
        {item.href && (
          <button
            className={css.btn}
            onClick={() => void openUrl(item.href!).catch((e) => app.notify(errorMessage(e), "error"))}
            title="Open in browser"
          >
            ↗
          </button>
        )}
        <button className={css.btn} onClick={() => app.closeLightbox()} title="Close (Esc)">
          ✕
        </button>
      </div>

      {count > 1 && (
        <>
          <button className={`${css.nav} ${css.prev}`} onClick={(e) => (e.stopPropagation(), go(-1))} title="Previous (←)">
            ‹
          </button>
          <button className={`${css.nav} ${css.next}`} onClick={(e) => (e.stopPropagation(), go(1))} title="Next (→)">
            ›
          </button>
        </>
      )}

      <div ref={stage} className={`${css.stage} ${zoom === 0 ? css.fit : css.scroll}`} onWheel={onWheel}>
        {failed ? (
          <div className={css.failed} onClick={(e) => e.stopPropagation()}>
            Couldn't load this image.
            {item.href && (
              <button className="ghost" onClick={() => void openUrl(item.href!).catch((e) => app.notify(errorMessage(e), "error"))}>
                Open in browser
              </button>
            )}
          </div>
        ) : (
          <img
            key={item.src}
            src={item.src}
            alt={item.title}
            className={`${css.img} ${loaded ? css.loaded : ""}`}
            style={sized ? { width, height } : undefined}
            onClick={(e) => {
              e.stopPropagation();
              setZoom(zoom === 0 ? 1 : 0);
            }}
            onLoad={(e) => {
              const el = e.currentTarget;
              setNatural({ w: el.naturalWidth, h: el.naturalHeight });
              setLoaded(true);
            }}
            onError={() => setFailed(true)}
            draggable={false}
          />
        )}
        {!loaded && !failed && <span className={`spin ${css.spinner}`}></span>}
      </div>
    </div>
  );
}
