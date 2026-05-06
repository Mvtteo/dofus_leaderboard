export default function Background() {
  return (
    <div className="bg-container">
      <div className="bg-gradient" />
      <div className="bg-grid" />
      <div className="streak" style={{ top: '28%', transform: 'rotate(-8deg)' }} />
      <div className="streak2" style={{ top: '35%', transform: 'rotate(5deg)' }} />
      <div className="streak" style={{ top: '72%', transform: 'rotate(6deg)', opacity: 0.7 }} />
      <div className="streak2" style={{ top: '80%', transform: 'rotate(-4deg)', opacity: 0.6 }} />
      <div className="magic-mist" />
    </div>
  );
}
