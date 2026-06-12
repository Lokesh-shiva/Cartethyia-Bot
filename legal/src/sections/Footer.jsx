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
          <a href="/privacy.html" className="footer-link">Privacy Policy</a>
          <a href="/terms.html" className="footer-link">Terms of Service</a>
          <a href="https://discord.gg/YourInvite" className="footer-link" target="_blank" rel="noopener noreferrer">Support Server</a>
          <a href="https://discordbotlist.com/bots/cartethyia/upvote" className="footer-link" target="_blank" rel="noopener noreferrer">Vote</a>
        </nav>
        <p className="footer-copy">© {new Date().getFullYear()} Cartethyia. All rights reserved.</p>
      </div>
    </footer>
  );
}
