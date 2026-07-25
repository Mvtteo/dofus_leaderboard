export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <span className="footer-brand">Nemesis — Alliance PvP Tracker</span>
        <span className="footer-updated">MAJ {new Date().toLocaleString('fr-FR')}</span>
      </div>
    </footer>
  );
}
