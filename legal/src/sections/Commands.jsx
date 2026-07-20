import useReveal from '../hooks/useReveal';
import './Commands.css';

const COMMANDS = [
  { cmd: '/start',        desc: 'Create your resonator and begin your journey' },
  { cmd: '/profile',      desc: 'View your character card — stats, element, weapon, aura' },
  { cmd: '/character',    desc: 'Manage a playable ally (e.g. Solace) — level, ascend, gear, and fight with her' },
  { cmd: '/team',         desc: 'Set which ally fights alongside you in combat' },
  { cmd: '/level',        desc: 'Check your current level and EXP progress' },
  { cmd: '/stats',        desc: 'See final combat numbers and every bonus source' },
  { cmd: '/inventory',    desc: 'View all your currencies and materials' },
  { cmd: '/daily',        desc: 'Claim your daily reward — streak multipliers up to 3×' },
  { cmd: '/dispatch',     desc: 'Send your character on passive AFK farming runs' },
  { cmd: '/ascend',       desc: 'Challenge the ascension boss for your next World Level' },
  { cmd: '/boss',         desc: 'Re-challenge any cleared WL boss for materials' },
  { cmd: '/dungeon',      desc: 'Enter a multi-floor dungeon (costs 1 Resonance Aura)' },
  { cmd: '/field-boss',   desc: '12 elemental field bosses — 6 always open, 6 tougher Named Echo Set guardians at WL2+' },
  { cmd: '/raid',         desc: 'Join or start a multiplayer co-op boss raid' },
  { cmd: '/duel',         desc: 'Challenge another player to 1v1 turn-based PvP' },
  { cmd: '/vibe',         desc: 'Interact socially with another player — earn materials and affinity' },
  { cmd: '/affinity',     desc: 'Check your relationship score and rank with another player' },
  { cmd: '/bond',         desc: 'Form or break a permanent Friend / Partner / Adoption bond' },
  { cmd: '/bonds',        desc: 'View all your active bonds' },
  { cmd: '/ability',      desc: 'View your unique passive ability card' },
  { cmd: '/evolve',       desc: 'Start the Lv 50 ability evolution quest' },
  { cmd: '/awaken',       desc: 'Awaken your ego weapon at Lv 60' },
  { cmd: '/echo',         desc: 'View a single echo as a detailed card' },
  { cmd: '/echoes',       desc: 'View your full equipped echo grid by slot' },
  { cmd: '/echo-equip',   desc: 'Equip an echo to a slot with comparison preview' },
  { cmd: '/echo-upgrade', desc: 'Level an echo 0→25 (+1/+5/Auto with Tuning Modules)' },
  { cmd: '/echo-reveal',  desc: 'Unlock a sealed echo substat (costs 1 Sealing Tube)' },
  { cmd: '/echo-reroll',  desc: 'Reroll all unlocked substats (costs 1 Paradox Core)' },
  { cmd: '/echo-preset',  desc: 'Save and load named echo loadouts' },
  { cmd: '/echo-lock',    desc: 'Lock an echo to protect it from discard and reroll' },
  { cmd: '/echo-discard', desc: 'Dismantle unwanted echoes for Tuning Modules — single or bulk with filters, deselect a few to keep' },
  { cmd: '/weapons',      desc: 'Browse your full weapon arsenal' },
  { cmd: '/weapon-upgrade', desc: 'Level a weapon up to 90 (+1/+10/Auto with Forging Ores)' },
  { cmd: '/equip',        desc: 'Equip a weapon with side-by-side stat comparison' },
  { cmd: '/weapon',       desc: 'View a single weapon card with full stats and passive' },
  { cmd: '/forge',        desc: 'Craft a new weapon with Forging Ores' },
  { cmd: '/weapon-discard', desc: 'Dismantle unwanted weapons for Forging Ores — single or bulk with filters' },
  { cmd: '/weapon-refine', desc: 'Merge a duplicate weapon into +1 Refinement on a kept copy (up to R5)' },
  { cmd: '/wish',         desc: 'Standard banner with Fracture Keys, or limited-time character/weapon banners with Radiant Keys' },
  { cmd: '/shop',         desc: 'Buy materials with Credits; Lunakite unlocks bundle rates on modules, tubes, cores, and records' },
  { cmd: '/use',          desc: 'Use an item from your inventory — e.g. convert Fractonite into Fracture or Radiant Keys' },
  { cmd: '/vote',         desc: 'Get vote links for DBL, top.gg, and rank.top — earn Credits + Fractonite every 12h' },
  { cmd: '/leaderboard',  desc: 'View server rankings by level, World Level, credits, and more' },
  { cmd: '/mail',         desc: 'Read rewards and messages sent to your inbox' },
  { cmd: '/guide',        desc: 'Full interactive guide — every system explained in one place' },
];

function CmdRow({ item, delay }) {
  const ref = useReveal('up');
  return (
    <div ref={ref} className="cmd-row will-reveal" style={{ animationDelay: `${delay}s` }}>
      <div className="cmd-inner">
        <span className="cmd-name">{item.cmd}</span>
        <span className="cmd-desc">{item.desc}</span>
      </div>
    </div>
  );
}

export default function Commands() {
  return (
    <section id="commands" className="section">
      <div className="section-label">Full command list</div>
      <h2 className="section-title">Everything at your fingertips</h2>
      <p className="section-sub">{COMMANDS.length} slash commands — each doing exactly one thing, no menus to learn.</p>
      <div className="cmd-grid">
        {COMMANDS.map((c, i) => <CmdRow key={c.cmd} item={c} delay={i * 0.04} />)}
      </div>
    </section>
  );
}
