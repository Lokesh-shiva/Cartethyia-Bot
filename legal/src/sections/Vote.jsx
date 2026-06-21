import useReveal from '../hooks/useReveal';
import './Vote.css';

const REWARDS = [
  { emoji: '💠', amount: '1 000', label: 'Credits',    desc: 'Spend in the shop on records, materials, and upgrades' },
  { emoji: '🔷', amount: '20',    label: 'Fractonite', desc: '100 Fractonite = 1 Fracture Key for /wish pulls (40 on weekends)' },
  { emoji: '✖2', amount: '2×',    label: 'Weekend',    desc: 'Double credits and Fractonite every Saturday and Sunday' },
];

const PATRON_TIERS = [
  { name: 'Attuned',   price: '$3/mo', perks: ['2 Lunakite', '80 Fractonite'],                               aura: null },
  { name: 'Ascendant', price: '$5/mo', perks: ['5 Lunakite', '200 Fractonite', '1 Aura Prism'],              aura: '6' },
  { name: 'Calamity',  price: '$10/mo', perks: ['12 Lunakite', '500 Fractonite', '3 Aura Prisms'],           aura: '8' },
];

export default function Vote() {
  const titleRef  = useReveal('up');
  const patronRef = useReveal('up');
  return (
    <section id="vote" className="section">
      {/* ── Vote ── */}
      <div ref={titleRef} className="will-reveal">
        <div className="section-label">Free support</div>
        <h2 className="section-title">Vote for rewards</h2>
        <p className="section-sub">Every vote keeps Cartethyia climbing the rankings — and earns you real in-game rewards instantly.</p>
      </div>
      <div className="vote-grid">
        {REWARDS.map((r, i) => <RewardCard key={r.label} reward={r} delay={i * 0.1} />)}
      </div>
      <div className="vote-cta">
        <div className="vote-buttons">
          <a href="https://discordbotlist.com/bots/cartethyia/upvote" className="btn btn-primary vote-btn" target="_blank" rel="noopener noreferrer">
            Vote on Discord Bot List
          </a>
          <a href="https://top.gg/bot/1510163339177623642/vote" className="btn btn-secondary vote-btn" target="_blank" rel="noopener noreferrer">
            Vote on top.gg
          </a>
          <a href="https://rank.top/bot/cartethyia" className="btn btn-ghost vote-btn" target="_blank" rel="noopener noreferrer">
            Vote on rank.top
          </a>
        </div>
        <p className="vote-note">Resets every 12 hours · 2× rewards on weekends</p>
      </div>

      {/* ── Patreon ── */}
      <div ref={patronRef} className="patron-block will-reveal">
        <div className="section-label" style={{ marginTop: '4rem' }}>Patreon</div>
        <h2 className="section-title">Support &amp; get monthly bundles</h2>
        <p className="section-sub">Pledge once and receive a bundle every month — plus permanent perks that stay active as long as you're subscribed.</p>
        <div className="patron-grid">
          {PATRON_TIERS.map((t, i) => <PatronCard key={t.name} tier={t} delay={i * 0.1} />)}
        </div>
        <div className="vote-cta">
          <a href="https://www.patreon.com/c/Cartethyia_bot/membership" className="btn btn-primary vote-btn" target="_blank" rel="noopener noreferrer">
            Support on Patreon
          </a>
          <p className="vote-note">DM the owner on Patreon · redeem your code with <code>/patron redeem</code></p>
        </div>
      </div>
    </section>
  );
}

function RewardCard({ reward, delay }) {
  const ref = useReveal('up');
  return (
    <div ref={ref} className="vote-reward will-reveal" style={{ animationDelay: `${delay}s` }}>
      <div className="reward-inner">
        <span className="reward-emoji">{reward.emoji}</span>
        <span className="reward-amount">{reward.amount}</span>
        <span className="reward-label">{reward.label}</span>
        <p className="reward-desc">{reward.desc}</p>
      </div>
    </div>
  );
}

function PatronCard({ tier, delay }) {
  const ref = useReveal('up');
  return (
    <div ref={ref} className="patron-card will-reveal" style={{ animationDelay: `${delay}s` }}>
      <div className="patron-name">{tier.name}</div>
      <div className="patron-price">{tier.price}</div>
      <ul className="patron-perks">
        {tier.perks.map(p => <li key={p}>✦ {p}</li>)}
        {tier.aura && <li className="patron-perk-aura">◈ Aura cap → {tier.aura}</li>}
      </ul>
    </div>
  );
}
