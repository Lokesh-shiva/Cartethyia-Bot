import { useEffect, useRef } from 'react';
import useReveal from '../hooks/useReveal';
import './Elements.css';

const ELEMENTS = [
  {
    id: 'fusion', name: 'Fusion', emoji: '🔥', color: '#f97316',
    bonus: '+15% ATK · +15% Crit · +20% Elem DMG',
    hook: 'IGNITE 35% → +25% ATK on hit',
    bars: [{ label: 'ATK', w: 38 }, { label: 'CRIT', w: 38 }, { label: 'ELEM', w: 50 }],
  },
  {
    id: 'glacio', name: 'Glacio', emoji: '❄️', color: '#67e8f9',
    bonus: '+30% DEF · +15% HP · +20% Elem DMG',
    hook: 'FROST_SHIELD 25% → absorb 40% dmg',
    bars: [{ label: 'DEF', w: 75 }, { label: 'HP', w: 38 }, { label: 'ELEM', w: 50 }],
  },
  {
    id: 'electro', name: 'Electro', emoji: '⚡', color: '#a78bfa',
    bonus: '+5% Crit · +20% Crit DMG · +25 Energy/turn',
    hook: 'DISCHARGE crit → +20 energy',
    bars: [{ label: 'CRIT', w: 13 }, { label: 'CR DMG', w: 50 }, { label: 'ENERGY', w: 63 }],
  },
  {
    id: 'aero', name: 'Aero', emoji: '🌪️', color: '#34d399',
    bonus: '+15% ATK · +40% Crit DMG · +20% Elem DMG',
    hook: 'WINDSTRIDE +8% DMG/turn ×5',
    bars: [{ label: 'ATK', w: 38 }, { label: 'CR DMG', w: 100 }, { label: 'ELEM', w: 50 }],
  },
  {
    id: 'havoc', name: 'Havoc', emoji: '🌑', color: '#c084fc',
    bonus: '+15% ATK · +20% Lifesteal · +20% Elem DMG',
    hook: 'VOID_SURGE Shatter → +25% HP',
    bars: [{ label: 'ATK', w: 38 }, { label: 'LEECH', w: 50 }, { label: 'ELEM', w: 50 }],
  },
  {
    id: 'spectro', name: 'Spectro', emoji: '✨', color: '#fde68a',
    bonus: '+30% HP · +20% Elem DMG',
    hook: 'RADIANCE 2% regen + <40% HP: +25% Crit',
    bars: [{ label: 'HP', w: 75 }, { label: 'ELEM', w: 50 }],
  },
];

function ElemCard({ elem, delay }) {
  const ref = useReveal('up');
  const barsRef = useRef(null);

  useEffect(() => {
    const el = barsRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { el.classList.add('bars-active'); obs.disconnect(); }
    }, { threshold: 0.4 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={ref} className="elem-card will-reveal" style={{ '--elem-color': elem.color, '--elem-bg': `url(/bg-${elem.id}.png)`, animationDelay: `${delay}s` }}>
        <div className="elem-inner">
          <div className="elem-header">
            <span className="elem-emoji">{elem.emoji}</span>
            <span className="elem-name" style={{ color: elem.color }}>{elem.name}</span>
          </div>
          <p className="elem-bonus">{elem.bonus}</p>
          <p className="elem-hook">{elem.hook}</p>
          <div ref={barsRef} className="elem-bars">
            {elem.bars.map((b, i) => (
              <div key={b.label} className="elem-bar-row">
                <span className="elem-bar-label">{b.label}</span>
                <div className="elem-bar-track">
                  <div
                    className="elem-bar-fill"
                    style={{ '--bar-w': `${b.w}%`, transitionDelay: `${i * 0.18}s`, background: elem.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
    </div>
  );
}

export default function Elements() {
  return (
    <section id="elements" className="section">
      <div className="section-label">Choose your path</div>
      <h2 className="section-title">Six elements, six playstyles</h2>
      <p className="section-sub">Your element is chosen at level 20 and shapes every fight you take on. No two resonators play the same.</p>
      <div className="elem-grid">
        {ELEMENTS.map((e, i) => <ElemCard key={e.id} elem={e} delay={i * 0.07} />)}
      </div>
    </section>
  );
}
