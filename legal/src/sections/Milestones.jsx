import TiltedCard from '../components/TiltedCard/TiltedCard';
import GlassSurface from '../components/GlassSurface/GlassSurface';
import useReveal from '../hooks/useReveal';
import './Milestones.css';

function MilestoneCard({ badge, title, desc, img, imgAlt, caption, accentClass }) {
  const ref = useReveal('up');
  return (
    <div ref={ref} className={`milestone-card ${accentClass} will-reveal`}>
      <GlassSurface height="100%" borderRadius={24} distortionScale={-160} brightness={50}>
        <div className="mc-body">
          <span className="mc-badge">{badge}</span>
          <h3 className="mc-title">{title}</h3>
          <p className="mc-desc">{desc}</p>
          <div className="mc-card-wrap">
            <TiltedCard
              imageSrc={img}
              altText={imgAlt}
              captionText={caption}
              rotateAmplitude={10}
              scaleOnHover={1.05}
              showTooltip={true}
            />
          </div>
        </div>
      </GlassSurface>
    </div>
  );
}

export default function Milestones() {
  return (
    <section id="milestones" className="section">
      <div className="section-label">Endgame milestones</div>
      <h2 className="section-title">Your resonator evolves with you</h2>
      <p className="section-sub">Two permanent upgrades mark the turning points of the journey — each shaped by your own combat history.</p>
      <div className="milestone-grid">
        <MilestoneCard
          badge="Lv 50 · /evolve"
          title="Ability Evolution"
          desc="Complete a three-part quest — dungeon clears, a WL5+ boss kill, and a material cost — to permanently evolve your ability. The AI rewrites its name, lore, and adds a fourth effect using your full combat history, gear, and personality bonds."
          img="/evolve.png"
          imgAlt="Eclipse of Resolve evolved ability card"
          caption="/evolve — Evolved Ability"
          accentClass="mc-evo"
        />
        <MilestoneCard
          badge="Lv 60 · /awaken"
          title="Ego Weapon Awakening"
          desc="Requires an evolved ability and an equipped weapon. Stats are amplified by rarity (up to ×1.25), the passive is enhanced, and the AI adds a new effect plus a unique awakened name, lore, and art description — all permanent."
          img="/awaken.png"
          imgAlt="Pyrclast Oathbreaker's Edge awakened weapon card"
          caption="/awaken — Awakened Weapon"
          accentClass="mc-awaken"
        />
      </div>
    </section>
  );
}
