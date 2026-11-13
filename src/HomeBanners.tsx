// Storefront home promo carousel (admin: /admin/settings/banners).
// Behaviour and anatomy follow the shadcn/ui Carousel (MIT, https://ui.shadcn.com/docs/components/carousel):
// a viewport with snapping slides, round outline prev/next buttons, keyboard arrows and an
// accessible "carousel" / "slide" role description — built on CSS scroll-snap instead of
// embla, so touch swipe is native and there is no new dependency. Dots and the pause button
// follow the WAI-ARIA APG carousel pattern (auto-rotation stops on hover / focus and can be
// paused; no auto-rotation with reduced motion). Colours come from the storefront tokens,
// so every accent × light/dark works unchanged. No banners → renders nothing.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { Link, useStore } from "./App";
import { t } from "./i18n";
import type { HomeBanner } from "./types";
import "./banners.css";

export const BANNER_INTERVAL_MS = 5000;

const calmMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches ||
  document.documentElement.dataset.motion === "calm";

function Slide({ banner, eager }: { banner: HomeBanner; eager: boolean }) {
  const picture = (
    <picture>
      {banner.mobileImageUrl && <source media="(max-width: 640px)" srcSet={banner.mobileImageUrl} />}
      <img
        src={banner.imageUrl}
        alt={banner.alt}
        width={1600}
        height={600}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        draggable={false}
        className={banner.mobileImageUrl ? "has-mobile" : ""}
      />
    </picture>
  );
  const link = banner.link;
  if (!link) return picture;
  if (link.startsWith("/"))
    return (
      <Link to={link} className="home-banner-link">
        {picture}
      </Link>
    );
  return (
    <a href={link} className="home-banner-link" target="_blank" rel="noopener noreferrer">
      {picture}
      <span className="sr-only"> {t("(เปิดในแท็บใหม่)")}</span>
    </a>
  );
}

export function HomeBanners() {
  const { overview } = useStore();
  const banners = overview?.banners ?? [];
  if (!banners.length) return null;
  return <BannerCarousel banners={banners} />;
}

function BannerCarousel({ banners }: { banners: HomeBanner[] }) {
  const count = banners.length;
  const viewport = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(calmMotion);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  const current = Math.min(index, count - 1);
  const mobileMode = banners.every((b) => b.mobileImageUrl)
    ? "all"
    : banners.some((b) => b.mobileImageUrl)
      ? "mixed"
      : "none";

  // Slide a button / dot / timer asked for; scroll events on the way there are ignored so
  // a smooth scroll never drags the dots back through the slides in between.
  const target = useRef<number | null>(null);
  const goTo = useCallback(
    (wanted: number) => {
      const el = viewport.current;
      const next = ((wanted % count) + count) % count;
      setIndex(next);
      if (!el) return;
      target.current = next;
      el.scrollTo({ left: next * el.clientWidth, behavior: calmMotion() ? "auto" : "smooth" });
    },
    [count],
  );

  // Swipe / trackpad scroll → current slide.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    let frame = 0;
    const sync = () => {
      if (!el.clientWidth) return;
      setIndex(Math.max(0, Math.min(count - 1, Math.round(el.scrollLeft / el.clientWidth))));
    };
    const onScroll = () => {
      if (target.current !== null) {
        if (Math.abs(el.scrollLeft - target.current * el.clientWidth) > 2) return;
        target.current = null;
      }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    };
    const onScrollEnd = () => {
      target.current = null;
      sync();
    };
    // The visitor takes over (swipe, wheel): follow their scroll again.
    const release = () => {
      target.current = null;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("scrollend", onScrollEnd);
    el.addEventListener("touchstart", release, { passive: true });
    el.addEventListener("wheel", release, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("scrollend", onScrollEnd);
      el.removeEventListener("touchstart", release);
      el.removeEventListener("wheel", release);
    };
  }, [count]);

  // Keep the shown slide in place when the viewport width changes (rotation, resize).
  const indexRef = useRef(current);
  indexRef.current = current;
  useEffect(() => {
    const el = viewport.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      el.scrollTo({ left: indexRef.current * width, behavior: "auto" });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const rotating = count > 1 && !paused && !hovered && !focused && visible;
  useEffect(() => {
    if (!rotating) return;
    const timer = setTimeout(() => goTo(current + 1), BANNER_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [rotating, current, goTo]);

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (count < 2) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      goTo(current - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      goTo(current + 1);
    }
  }

  return (
    <section
      className="home-banners"
      aria-roledescription="carousel"
      aria-label={t("โปรโมชั่น")}
      data-mobile={mobileMode}
      onKeyDown={onKeyDown}
      onPointerEnter={(e) => e.pointerType === "mouse" && setHovered(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <div className="home-banners-frame">
        <div className="home-banners-viewport" ref={viewport}>
          {banners.map((banner, i) => (
            <div
              key={banner.id}
              className="home-banner-slide"
              role="group"
              aria-roledescription="slide"
              aria-label={t("{n} จาก {total}", { n: i + 1, total: count })}
              aria-hidden={i !== current}
              inert={i !== current}
              data-banner={banner.id}
            >
              <Slide banner={banner} eager={i === 0} />
            </div>
          ))}
        </div>
        {count > 1 && (
          <>
            <button
              type="button"
              className="home-banners-arrow prev"
              aria-label={t("แบนเนอร์ก่อนหน้า")}
              onClick={() => goTo(current - 1)}
            >
              <ChevronLeft size={20} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="home-banners-arrow next"
              aria-label={t("แบนเนอร์ถัดไป")}
              onClick={() => goTo(current + 1)}
            >
              <ChevronRight size={20} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
      {count > 1 && (
        <div className="home-banners-controls">
          <button
            type="button"
            className="home-banners-pause"
            aria-label={paused ? t("เล่นแบนเนอร์อัตโนมัติ") : t("หยุดเลื่อนแบนเนอร์อัตโนมัติ")}
            aria-pressed={paused}
            onClick={() => setPaused((value) => !value)}
          >
            {paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
          </button>
          <div className="home-banners-dots">
            {banners.map((banner, i) => (
              <button
                key={banner.id}
                type="button"
                className={"home-banners-dot" + (i === current ? " active" : "")}
                aria-label={t("ไปที่แบนเนอร์ {n}", { n: i + 1 })}
                aria-current={i === current ? "true" : undefined}
                onClick={() => goTo(i)}
              />
            ))}
          </div>
        </div>
      )}
      <p className="sr-only" aria-live={rotating ? "off" : "polite"} aria-atomic="true">
        {count > 1 ? t("แบนเนอร์ {n} จาก {total}", { n: current + 1, total: count }) + ": " + banners[current].alt : ""}
      </p>
    </section>
  );
}
