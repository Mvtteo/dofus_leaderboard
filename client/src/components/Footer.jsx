export default function Footer() {
  return (
    <footer className="footer">
      <span>OGRE — ALLIANCE PVP TRACKER</span>
      <span className="footer-dot" />
      <span>Mise à jour : {new Date().toLocaleString('fr-FR')}</span>
    </footer>
  );
}
