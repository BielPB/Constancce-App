import React from "react";
import { captureClientError } from "../lib/observability.js";

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    captureClientError(error, {
      module: "react",
      action: String(info?.componentStack || "").slice(0, 500),
    });
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#000",
        color: "#F2F2ED",
        fontFamily: "Poppins, sans-serif",
        padding: 24,
      }}>
        <div style={{
          maxWidth: 520,
          width: "100%",
          background: "#0D0D0D",
          border: "1px solid #242424",
          borderRadius: 18,
          padding: 24,
        }}>
          <div style={{ fontSize: 12, color: "#C9A24A", textTransform: "uppercase", letterSpacing: ".12em" }}>
            Constancce
          </div>
          <h1 style={{ fontSize: 24, margin: "10px 0 8px" }}>Algo saiu do esperado.</h1>
          <p style={{ color: "#9C9C95", lineHeight: 1.6, fontSize: 14 }}>
            Seus dados locais continuam preservados. Recarregue o aplicativo para tentar novamente.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 18,
              width: "100%",
              border: 0,
              borderRadius: 12,
              padding: "12px 16px",
              background: "#C9A24A",
              color: "#141208",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Recarregar Constancce
          </button>
        </div>
      </div>
    );
  }
}
