import { useEffect, useRef } from 'react';
import './Hero.css';

export default function Hero() {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { el.classList.remove('will-reveal'); el.classList.add('reveal-up'); obs.disconnect(); }
    }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <section className="hero-section">
      <div ref={ref} className="hero-inner will-reveal">
        <div className="hero-badge">Discord RPG Bot</div>
        <h1 className="hero-title">
          Your adventure<br />
          <span className="hero-accent">starts in Discord</span>
        </h1>
        <p className="hero-sub">
          Level up your resonator, equip echoes, challenge world bosses, and evolve a unique ability — all inside your Discord server.
        </p>
        <div className="hero-actions">
          <a href="https://discord.com/oauth2/authorize?client_id=1510163339177623642&permissions=277025459200&scope=bot+applications.commands" className="btn btn-primary" target="_blank" rel="noopener noreferrer">
            Add to Discord
          </a>
          <a href="https://discordbotlist.com/bots/cartethyia/upvote" className="btn btn-ghost" target="_blank" rel="noopener noreferrer">
            Vote for rewards
          </a>
        </div>
        <div className="hero-stats">
          <div className="hero-stat"><span className="hero-stat-num" data-count="9">0</span><span className="hero-stat-label">World Levels</span></div>
          <div className="hero-stat-div" />
          <div className="hero-stat"><span className="hero-stat-num" data-count="50">0</span><span className="hero-stat-label">Echo slots</span></div>
          <div className="hero-stat-div" />
          <div className="hero-stat"><span className="hero-stat-num" data-count="6">0</span><span className="hero-stat-label">Elements</span></div>
        </div>
      </div>
    </section>
  );
}
