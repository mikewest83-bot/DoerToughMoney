import "./launch-polish.css";
import React from "react";
import { createRoot } from "react-dom/client";

const rootElement = document.getElementById("root");
const root = createRoot(rootElement);

function ErrorScreen({ error }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F1F1F5",
        color: "#16151A",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: "Inter, system-ui, -apple-system, sans-serif",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "#FFFFFF",
          borderRadius: 24,
          padding: 28,
          boxShadow: "0 12px 40px rgba(0,0,0,.12)",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: "#12A150",
            color: "#FFFFFF",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 28,
            fontWeight: 800,
            marginBottom: 20,
          }}
        >
          DT
        </div>

        <h1 style={{ margin: "0 0 10px", fontSize: 26 }}>
          DoerToughMoney
        </h1>

        <p
          style={{
            margin: "0 0 20px",
            color: "#7A7A86",
            lineHeight: 1.5,
          }}
        >
          The app hit a startup error. Refresh the page to try again.
        </p>

        <button
          onClick={() => window.location.reload()}
          style={{
            width: "100%",
            border: 0,
            borderRadius: 14,
            padding: "14px 18px",
            background: "#12A150",
            color: "#FFFFFF",
            fontSize: 16,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Reload DoerToughMoney
        </button>

        {error && (
          <details style={{ marginTop: 20 }}>
            <summary style={{ cursor: "pointer", color: "#7A7A86" }}>
              Technical details
            </summary>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: 11,
                marginTop: 12,
                color: "#7A7A86",
              }}
            >
              {error}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("DoerToughMoney React error:", error);
    console.error("Component stack:", info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return <ErrorScreen error={this.state.error?.stack || String(this.state.error)} />;
    }

    return this.props.children;
  }
}

async function startApp() {
  try {
    const module = await import("./App.jsx");
    const App = module.default;

    if (!App) {
      throw new Error("App.jsx did not provide a default export.");
    }

    root.render(
      <React.StrictMode>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </React.StrictMode>
    );
  } catch (error) {
    console.error("DoerToughMoney startup error:", error);

    root.render(<ErrorScreen error={error?.stack || String(error)} />);
  }
}

startApp();