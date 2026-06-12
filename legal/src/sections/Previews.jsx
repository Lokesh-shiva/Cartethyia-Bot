import TiltedCard from '../components/TiltedCard/TiltedCard';
import useReveal from '../hooks/useReveal';
import './Previews.css';

const PREVIEWS = [
  {
    cmd: '/boss',
    title: 'Boss Battles',
    desc: 'Challenge one of 9 world-tier bosses in turn-based combat. Watch the vibration bar shatter as you land crits. Defeat them before they enrage at 40% HP — when they hit back harder and shatter recovery drops to 60%.',
    img: '/battle.png',
    caption: '/boss — Boss Battle',
  },
  {
    cmd: '/profile',
    title: 'Character Profile',
    desc: 'Your full character sheet at a glance — level, element, stats, equipped weapon with its Weapon Bond lore, Resonance Aura charges, and your recent party in the sidebar. Every stat scales with gear, echoes, and set bonuses.',
    img: '/profile.png',
    caption: '/profile — Character Card',
    reverse: true,
  },
  {
    cmd: '/echo',
    title: 'Echo Collection',
    desc: 'Each echo is a canvas card with rarity, element, main stat, and up to four substats that scale 1.5× by Lv 25. Hunt field bosses and dungeons to collect them, then build set bonuses for powerful passive effects.',
    img: '/echo.png',
    caption: '/echo — Echo Card',
  },
  {
    cmd: '/weapons',
    title: 'Arsenal Browser',
    desc: 'Browse your full weapon collection with a select menu — each entry shows rarity, ATK, level, and its Weapon Bond flavor text. Equip from a side-by-side comparison card before you commit.',
    img: '/weapons.png',
    caption: '/weapons — Arsenal',
    reverse: true,
  },
  {
    cmd: '/stats',
    title: 'Combat Stats',
    desc: 'See every final number the game actually uses — HP, ATK, DEF, Crit, Elem DMG, and a full breakdown of every bonus source: innate element bonuses, echo substats, set effects, weapon passive, and your evolved ability.',
    img: '/stats.png',
    caption: '/stats — Combat Numbers',
  },
];

function PreviewRow({ item }) {
  const labelRef = useReveal(item.reverse ? 'right' : 'left');
  const cardRef  = useReveal(item.reverse ? 'left' : 'right');

  return (
    <div className={`preview-row${item.reverse ? ' reverse' : ''}`}>
      <div ref={labelRef} className="preview-label will-reveal">
        <div className="preview-cmd"><span>{item.cmd}</span></div>
        <div className="preview-title">{item.title}</div>
        <div className="preview-desc">{item.desc}</div>
      </div>
      <div ref={cardRef} className="preview-card will-reveal">
        <TiltedCard
          imageSrc={item.img}
          altText={item.title}
          captionText={item.caption}
          rotateAmplitude={12}
          scaleOnHover={1.04}
          showTooltip={true}
        />
      </div>
    </div>
  );
}

export default function Previews() {
  return (
    <section id="previews" className="section">
      <div className="section-label">In action</div>
      <h2 className="section-title">See it in your server</h2>
      <p className="section-sub">Rich canvas cards, embed UIs, and interactive select menus — all delivered right in Discord.</p>
      <div className="previews-wrap">
        {PREVIEWS.map(p => <PreviewRow key={p.cmd} item={p} />)}
      </div>
    </section>
  );
}
