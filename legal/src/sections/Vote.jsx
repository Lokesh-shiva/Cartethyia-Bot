import useReveal from '../hooks/useReveal';
import './Vote.css';

const REWARDS = [
  { emoji: '💎', amount: '1 000', label: 'Credits', desc: 'Spend in the shop on records, materials, and upgrades' },
  { emoji: '🔑', amount: '1',     label: 'Resonance Key', desc: 'Instant dungeon entry — no Aura required' },
  { emoji: '✖️2', amount: '2×',   label: 'Weekend bonus', desc: 'Double rewards every Saturday and Sunday' },
];

export default function Vote() {
  const titleRef = useReveal('up');
  return (
    <section id="vote" className="section">
      <div ref={titleRef} className="will-reveal">
        <div className="section-label">Support the bot</div>
        <h2 className="section-title">Vote for rewards</h2>
        <p className="section-sub">Every vote on Discord Bot List keeps Cartethyia climbing the rankings — and earns you real in-game rewards instantly.</p>
      </div>
      <div className="vote-grid">
        {REWARDS.map((r, i) => <RewardCard key={r.label} reward={r} delay={i * 0.1} />)}
      </div>
      <div className="vote-cta">
        <a
          href="https://discordbotlist.com/bots/cartethyia/upvote"
          className="btn btn-primary vote-btn"
          target="_blank"
          rel="noopener noreferrer"
        >
          Vote on Discord Bot List
        </a>
        <p className="vote-note">Resets every 12 hours · 2× rewards on weekends</p>
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
