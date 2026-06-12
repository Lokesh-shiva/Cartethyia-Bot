import { useEffect, useRef } from 'react';
import Galaxy from './components/Galaxy/Galaxy';
import PillNav from './components/PillNav/PillNav';
import Hero from './sections/Hero';
import Features from './sections/Features';
import Previews from './sections/Previews';
import Elements from './sections/Elements';
import Commands from './sections/Commands';
import Milestones from './sections/Milestones';
import Vote from './sections/Vote';
import Footer from './sections/Footer';

const NAV_ITEMS = [
  { label: 'Features',   href: '#features'   },
  { label: 'Previews',   href: '#previews'   },
  { label: 'Elements',   href: '#elements'   },
  { label: 'Commands',   href: '#commands'   },
  { label: 'Milestones', href: '#milestones' },
  { label: 'Vote',       href: '#vote'       },
];

// Animated stat counters in the hero section
function useCounters() {
  useEffect(() => {
    const els = document.querySelectorAll('.hero-stat-num[data-count]');
    if (!els.length) return;
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        const el = e.target;
        const target = parseInt(el.dataset.count);
        const dur = 2800;
        const t0 = performance.now();
        (function tick(now) {
          const p = Math.min((now - t0) / dur, 1);
          const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
          el.textContent = Math.round(eased * target);
          if (p < 1) requestAnimationFrame(tick);
        })(t0);
        obs.unobserve(el);
      });
    }, { threshold: 0.5 });
    els.forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, []);
}

export default function App() {
  useCounters();

  return (
    <>
      {/* Fixed star background */}
      <div className="galaxy-layer">
        <Galaxy
          hueShift={270}
          saturation={0.6}
          density={1.2}
          glowIntensity={0.35}
          twinkleIntensity={0.4}
          mouseRepulsion={true}
          rotationSpeed={0.04}
          transparent={true}
        />
      </div>

      {/* Navbar */}
      <PillNav
        logo="/logo.png"
        logoAlt="Cartethyia"
        items={NAV_ITEMS}
        initialLoadAnimation={true}
      />

      {/* Page content */}
      <main className="page">
        <Hero />
        <hr className="section-rule" />
        <Features />
        <hr className="section-rule" />
        <Previews />
        <hr className="section-rule" />
        <Elements />
        <hr className="section-rule" />
        <Commands />
        <hr className="section-rule" />
        <Milestones />
        <hr className="section-rule" />
        <Vote />
        <Footer />
      </main>
    </>
  );
}
