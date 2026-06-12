import useReveal from '../hooks/useReveal';
import GlassSurface from '../components/GlassSurface/GlassSurface';
import './Commands.css';

const COMMANDS = [
  { cmd: '/start',       desc: 'Create your resonator and begin your journey' },
  { cmd: '/profile',     desc: 'View your character card — stats, element, weapon, aura' },
  { cmd: '/ascend',      desc: 'Challenge the ascension boss for your next World Level' },
  { cmd: '/boss',        desc: 'Re-challenge any cleared WL boss for materials' },
  { cmd: '/dungeon',     desc: 'Enter a multi-floor dungeon (costs 1 Resonance Aura)' },
  { cmd: '/raid',        desc: 'Join or create a multiplayer raid' },
  { cmd: '/field-boss',  desc: 'Fight an elemental field boss for a 4-cost echo' },
  { cmd: '/echo',        desc: 'Browse and manage your echo collection' },
  { cmd: '/echo-upgrade',desc: 'Upgrade an echo (+1/+5/Auto with Sealing Tubes)' },
  { cmd: '/echo-equip',  desc: 'Equip an echo to a slot with comparison preview' },
  { cmd: '/echoes',      desc: 'View your full equipped echo grid by slot' },
  { cmd: '/weapons',     desc: 'Browse your full weapon arsenal' },
  { cmd: '/weapon-upgrade', desc: 'Upgrade a weapon (+1/+10/Auto)' },
  { cmd: '/equip',       desc: 'Equip a weapon with side-by-side comparison' },
  { cmd: '/stats',       desc: 'See final combat numbers and every bonus source' },
  { cmd: '/wish',        desc: 'Pull on the echo or weapon banner' },
  { cmd: '/shop',        desc: 'Buy items with Credits — Records, materials, and more' },
  { cmd: '/use',         desc: 'Use an item from your inventory' },
  { cmd: '/evolve',      desc: 'Start the Lv 50 ability evolution quest' },
  { cmd: '/awaken',      desc: 'Awaken your ego weapon at Lv 60' },
  { cmd: '/vote',        desc: 'Vote on Discord Bot List for 1 000 credits + 1 key' },
  { cmd: '/leaderboard', desc: 'View the top resonators by level or combat power' },
  { cmd: '/party',       desc: 'See your recent combat party' },
];

function CmdRow({ item, delay }) {
  const ref = useReveal('up');
  return (
    <div ref={ref} className="cmd-row will-reveal" style={{ animationDelay: `${delay}s` }}>
      <GlassSurface height="100%" borderRadius={12} distortionScale={-140} brightness={46}>
        <div className="cmd-inner">
          <span className="cmd-name">{item.cmd}</span>
          <span className="cmd-desc">{item.desc}</span>
        </div>
      </GlassSurface>
    </div>
  );
}

export default function Commands() {
  return (
    <section id="commands" className="section">
      <div className="section-label">Full command list</div>
      <h2 className="section-title">Everything at your fingertips</h2>
      <p className="section-sub">All {COMMANDS.length} slash commands, each doing exactly one thing — no menus to learn.</p>
      <div className="cmd-grid">
        {COMMANDS.map((c, i) => <CmdRow key={c.cmd} item={c} delay={i * 0.04} />)}
      </div>
    </section>
  );
}
