import { useEffect, useRef } from 'react';

const CLASS_MAP = {
  up: 'reveal-up',
  left: 'reveal-left',
  right: 'reveal-right',
  fade: 'reveal-fade',
};

export default function useReveal(direction = 'up', threshold = 0.12) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cls = CLASS_MAP[direction] || 'reveal-up';
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        el.classList.remove('will-reveal');
        el.classList.add(cls);
        obs.disconnect();
      }
    }, { threshold });
    obs.observe(el);
    return () => obs.disconnect();
  }, [direction, threshold]);

  return ref;
}
