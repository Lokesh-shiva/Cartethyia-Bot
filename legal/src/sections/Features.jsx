import useReveal from '../hooks/useReveal';
import './Features.css';

const FEATURES = [
  {
    id: 'combat', label: 'Combat System', emoji: '⚔️',
    desc: 'Turn-based fights with vibration bars, shatter mechanics, crit chains, and boss enrage at 40% HP.',
    accent: 'rgba(255,107,53,0.18)', reveal: 'left',
  },
  {
    id: 'echo', label: 'Echo Builds', emoji: '🔮',
    desc: 'Collect 1/3/4-cost echoes with randomised substats that scale 1.5× at Lv 25. Build 2/4/5-piece set bonuses.',
    accent: 'rgba(167,139,250,0.18)', reveal: 'up',
  },
  {
    id: 'dungeon', label: 'Dungeons & Raids', emoji: '🏰',
    desc: 'Multi-floor dungeons cost Resonance Aura. Multiplayer raids let you team up to take down elite targets.',
    accent: 'rgba(251,191,36,0.15)', reveal: 'up',
  },
  {
    id: 'wish', label: 'Wish System', emoji: '✨',
    desc: 'Spend Lunakite to pull from the weapon and echo banner. Pity is tracked — guaranteed 5★ within 90 pulls.',
    accent: 'rgba(99,102,241,0.18)', reveal: 'up',
  },
  {
    id: 'element', label: '6 Elements', emoji: '🌀',
    desc: 'Fusion · Glacio · Electro · Aero · Havoc · Spectro. Each grants unique innate bonuses and a combat hook.',
    accent: 'rgba(52,211,153,0.15)', reveal: 'up',
  },
  {
    id: 'prog', label: 'Deep Progression', emoji: '📈',
    desc: 'Level cap tied to World Level. Evolve your ability at Lv 50. Awaken your ego weapon at Lv 60.',
    accent: 'rgba(236,72,153,0.15)', reveal: 'right',
  },
];

function FeatCard({ feat }) {
  const ref = useReveal(feat.reveal);
  return (
    <div ref={ref} className={`feat-card will-reveal feat-${feat.id}`} style={{ '--card-accent': feat.accent }}>
      <div className="feat-content">
        <span className="feat-emoji">{feat.emoji}</span>
        <h3 className="feat-label">{feat.label}</h3>
        <p className="feat-desc">{feat.desc}</p>
      </div>
    </div>
  );
}

export default function Features() {
  return (
    <section id="features" className="section">
      <div className="section-label">What you get</div>
      <h2 className="section-title">A full RPG inside Discord</h2>
      <p className="section-sub">Everything from character building to endgame boss trials — no separate app required.</p>
      <div className="feat-grid">
        {FEATURES.map(f => <FeatCard key={f.id} feat={f} />)}
      </div>
    </section>
  );
}
