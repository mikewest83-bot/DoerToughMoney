import "./launch-polish.css";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { hasToken } from "./api.js";
import MikeWidget from "./MikeWidget.jsx";

const rootElement = document.getElementById("root");
const root = createRoot(rootElement);

function LaunchLanding({ onContinue }) {
  return (
    <main className="dt-landing">
      <div className="dt-landing-grid" aria-hidden="true" />
      <nav className="dt-landing-nav">
        <div className="dt-logo">DoerTough<span>Money</span></div>
        <button className="dt-nav-login" onClick={() => onContinue("/login")}>Sign in</button>
      </nav>

      <section className="dt-hero">
        <div className="dt-hero-copy">
          <div className="dt-eyebrow"><span /> Your money. Your decisions. Your advantage.</div>
          <h1>Know what you can <em>safely spend.</em></h1>
          <p className="dt-hero-sub">
            DoerToughMoney brings your accounts, bills, budgets, goals and spending into one clear picture — then helps you decide what to do next.
          </p>
          <div className="dt-hero-actions">
            <button className="dt-primary" onClick={() => onContinue("/signup")}>Get started — it’s free <span>→</span></button>
            <button className="dt-secondary" onClick={() => onContinue("/login")}>I already have an account</button>
          </div>
          <div className="dt-trust"><span>✓</span> Secure bank connections <span>✓</span> Private by design <span>✓</span> No credit card required</div>
        </div>

        <div className="dt-hero-preview" aria-label="DoerToughMoney financial dashboard preview">
          <div className="dt-preview-top"><div><small>SAFE TO SPEND</small><strong>$1,842</strong><span>after upcoming bills</span></div><div className="dt-score">A<small>money score</small></div></div>
          <div className="dt-preview-rule" />
          <div className="dt-preview-row"><div><b>Income</b><span>This month</span></div><strong className="positive">+$5,420</strong></div>
          <div className="dt-preview-row"><div><b>Spending</b><span>Excluding transfers</span></div><strong>-$2,184</strong></div>
          <div className="dt-preview-row"><div><b>Upcoming bills</b><span>Next 30 days</span></div><strong>-$1,394</strong></div>
          <div className="dt-preview-insight"><div className="dt-spark">↗</div><div><b>You’re on track</b><span>You have room to hit your savings goal this month.</span></div></div>
        </div>
      </section>

      <section className="dt-benefits">
        <div><span className="dt-benefit-icon">$</span><h3>Safe to Spend</h3><p>See what’s actually available after bills and obligations.</p></div>
        <div><span className="dt-benefit-icon">✦</span><h3>Doer Intelligence</h3><p>Turn raw transactions into useful decisions and next steps.</p></div>
        <div><span className="dt-benefit-icon">%</span><h3>DealTough</h3><p>Spot opportunities to lower the costs you’re already paying.</p></div>
      </section>

      <section className="dt-bottom-line">
        <div><strong>One place for the money decisions that matter.</strong><span>Connect your bank. See the picture. Do the next right thing.</span></div>
        <button className="dt-primary dt-primary-small" onClick={() => onContinue("/signup")}>Build your money advantage <span>→</span></button>
      </section>
    </main>
  );
}

function ErrorScreen({ error }) {
  return (
    <div style={{ minHeight: "100vh", background: "#F1F1F5", color: "#16151A", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "Inter, system-ui, sans-serif", boxSizing: "border-box" }}>
      <div style={{ width: "100%", maxWidth: 420, background: "#FFFFFF", borderRadius: 24, padding: 28, boxShadow: "0 12px 40px rgba(0,0,0,.12)" }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: "#12A150", color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 800, marginBottom: 20 }}>DT</div>
        <h1 style={{ margin: "0 0 10px", fontSize: 26 }}>DoerToughMoney</h1>
        <p style={{ margin: "0 0 20px", color: "#7A7A86", lineHeight: 1.5 }}>The app hit a startup error. Refresh the page to try again.</p>
        <button onClick={() => window.location.reload()} style={{ width: "100%", border: 0, borderRadius: 14, padding: "14px 18px", background: "#12A150", color: "#FFFFFF", fontSize: 16, fontWeight: 700, cursor: "pointer" }}>Reload DoerToughMoney</button>
        {error && <details style={{ marginTop: 20 }}><summary style={{ cursor: "pointer", color: "#7A7A86" }}>Technical details</summary><pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 11, marginTop: 12, color: "#7A7A86" }}>{error}</pre></details>}
      </div>
    </div>
  );
}

class AppErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("DoerToughMoney React error:", error); console.error("Component stack:", info?.componentStack); }
  render() { return this.state.error ? <ErrorScreen error={this.state.error?.stack || String(this.state.error)} /> : this.props.children; }
}

function AppEntry() {
  const [path, setPath] = useState(window.location.pathname);
  const go = (nextPath) => { window.history.pushState({}, "", nextPath); setPath(nextPath); };
  const publicEntry = path === "/" && !hasToken();
  if (publicEntry) return <LaunchLanding onContinue={go} />;
  return <AppLoader />;
}

function AppLoader() {
  const [App, setApp] = useState(null);
  const [error, setError] = useState(null);
  React.useEffect(() => {
    let alive = true;
    import("./App.jsx").then((module) => { if (alive) setApp(() => module.default); }).catch((err) => { if (alive) setError(err); });
    return () => { alive = false; };
  }, []);
  if (error) return <ErrorScreen error={error?.stack || String(error)} />;
  if (!App) return <div style={{ minHeight: "100vh", background: "#F6F7F9" }} />;
  return <App />;
}

root.render(
  <React.StrictMode>
    <AppErrorBoundary>
      <AppEntry />
      <MikeWidget />
    </AppErrorBoundary>
  </React.StrictMode>
);