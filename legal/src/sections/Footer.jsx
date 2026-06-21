import './Footer.css';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <span className="footer-name">Cartethyia</span>
          <span className="footer-tagline">Discord RPG Bot · Not affiliated with WuWa / Kuro Games</span>
        </div>
        <nav className="footer-links">
          <a href="https://discord.com/oauth2/authorize?client_id=1510163339177623642&permissions=277025459200&scope=bot+applications.commands" className="footer-link" target="_blank" rel="noopener noreferrer">Add to Discord</a>
          <a href="https://discord.gg/vgVmRMc2Gb" className="footer-link" target="_blank" rel="noopener noreferrer">Support Server</a>
          <a href="https://www.patreon.com/c/Cartethyia_bot/membership" className="footer-link" target="_blank" rel="noopener noreferrer">Patreon</a>
          <a href="https://discordbotlist.com/bots/cartethyia/upvote" className="footer-link" target="_blank" rel="noopener noreferrer">Vote</a>
          <a href="/privacy.html" className="footer-link">Privacy</a>
          <a href="/terms.html" className="footer-link">Terms</a>
        </nav>
        <p className="footer-copy">© {new Date().getFullYear()} Cartethyia. All rights reserved.</p>
      </div>
    </footer>
  );
}
