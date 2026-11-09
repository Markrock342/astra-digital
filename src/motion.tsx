import { useEffect, useRef, useState } from "react";
export function useRouteMotion(route: string) {
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = document.getElementById("content");
    if (!root) return;
    const observed = new WeakSet<Element>();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("motion-enter");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.06 },
    );
    const scan = () =>
      root
        .querySelectorAll(
          ".page-heading,.stats-panel,.activity-panel,.announcement,.product-card,.admin-metrics>.panel,.admin-section,.store-card,.portal-welcome,.checkout-layout>.panel,.wallet-balance,.review-card",
        )
        .forEach((node, index) => {
          if (observed.has(node)) return;
          observed.add(node);
          (node as HTMLElement).style.setProperty(
            "--enter-delay",
            `${Math.min((index % 4) * 65, 195)}ms`,
          );
          observer.observe(node);
        });
    scan();
    const changes = new MutationObserver(scan);
    changes.observe(root, { childList: true, subtree: true });
    root.animate(
      [
        { opacity: 0.6, transform: "translateY(6px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 260, easing: "cubic-bezier(.22,1,.36,1)" },
    );
    return () => {
      observer.disconnect();
      changes.disconnect();
    };
  }, [route]);
}
export function CountUp({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);
  const previous = useRef(0);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(value);
      previous.current = value;
      return;
    }
    let frame = 0,
      start = 0;
    const from = previous.current;
    const tick = (time: number) => {
      if (!start) start = time;
      const t = Math.min(1, (time - start) / 850);
      setDisplay(Math.round(from + (value - from) * (1 - Math.pow(1 - t, 4))));
      if (t < 1) frame = requestAnimationFrame(tick);
      else previous.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <strong aria-label={String(value)}>{display}</strong>;
}
