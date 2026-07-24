import useReveal from '../hooks/useReveal';
import './Vote.css';

const REWARDS = [
  { emoji: '💠', amount: '1 000', label: 'Credits',    desc: 'Spend in the shop on records, materials, and upgrades' },
  { emoji: '🔷', amount: '100',   label: 'Fractonite', desc: 'Convert with /use into Fracture Keys or Radiant Keys — your choice' },
  { emoji: '✖2', amount: '2×',    label: 'Weekend',    desc: 'Double credits and Fractonite every Saturday and Sunday' },
];

const PATRON_TIERS = [
  { name: 'Attuned',   price: '$3/mo', perks: ['2 Lunakite', '80 Fractonite'],                               aura: null },
  { name: 'Ascendant', price: '$5/mo', perks: ['5 Lunakite', '200 Fractonite', '1 Aura Prism'],              aura: '6' },
  { name: 'Calamity',  price: '$10/mo', perks: ['12 Lunakite', '500 Fractonite', '3 Aura Prisms'],           aura: '8' },
];

const KOFI_URL = 'https://ko-fi.com/cartethyiabot';
const BUNDLES = [
  { name: 'Starter Pack',        price: '$4.25',  emoji: '🔹', perks: ['3 Lunakite', '1 Aura Prism', '100 Fractonite'],  url: 'https://ko-fi.com/s/ea2c57241c' },
  { name: "Wanderer's Bundle",   price: '$5.99',  emoji: '🔷', perks: ['8 Lunakite', '2 Aura Prisms', '250 Fractonite'], url: 'https://ko-fi.com/s/67ae3bed84' },
  { name: 'Voyager Bundle',      price: '$11.99', emoji: '💠', perks: ['18 Lunakite', '5 Aura Prisms', '600 Fractonite'], url: 'https://ko-fi.com/s/719224c10f' },
  { name: 'Resonance Vault',     price: '$22.99', emoji: '🌌', perks: ['40 Lunakite', '10 Aura Prisms', '1500 Fractonite'], url: 'https://ko-fi.com/s/f04dda5050' },
];

export default function Vote() {
  const titleRef  = useReveal('up');
  const patronRef = useReveal('up');
  const kofiRef   = useReveal('up');
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

      {/* ── Ko-fi bundles ── */}
      <div ref={kofiRef} className="patron-block will-reveal">
        <div className="section-label" style={{ marginTop: '4rem' }}>Ko-fi</div>
        <h2 className="section-title">One-time bundles &amp; tips</h2>
        <p className="section-sub">A one-off currency boost, no subscription needed — separate from the monthly Patreon tiers above.</p>
        <div className="patron-grid">
          {BUNDLES.map((b, i) => <BundleCard key={b.name} bundle={b} delay={i * 0.1} />)}
        </div>
        <div className="vote-cta">
          <a href={KOFI_URL} className="btn btn-primary vote-btn" target="_blank" rel="noopener noreferrer">
            ☕ Tip or browse on Ko-fi
          </a>
          <p className="vote-note">Message the owner your order after purchase · redeem your code with <code>/patron redeem</code></p>
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

function BundleCard({ bundle, delay }) {
  const ref = useReveal('up');
  return (
    <a
      ref={ref}
      href={bundle.url}
      target="_blank"
      rel="noopener noreferrer"
      className="patron-card will-reveal"
      style={{ animationDelay: `${delay}s`, textDecoration: 'none', display: 'block' }}
    >
      <div className="patron-name">{bundle.emoji}  {bundle.name}</div>
      <div className="patron-price">{bundle.price}</div>
      <ul className="patron-perks">
        {bundle.perks.map(p => <li key={p}>✦ {p}</li>)}
      </ul>
    </a>
  );
}
