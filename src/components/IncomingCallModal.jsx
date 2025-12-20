import React from "react";

export default function IncomingCallModal({ call, onAnswer, onReject }) {
  if (!call) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0,0,0,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
    >
      <div
        style={{
          background: "white",
          borderRadius: 12,
          padding: 30,
          maxWidth: 400,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 48, marginBottom: 16 }}>📞</div>
        <h2 style={{ marginBottom: 8 }}>Incoming Call</h2>
        <p style={{ fontSize: 18, color: "#333", marginBottom: 24 }}>
          {call.caller?.username || "Unknown"} is calling...
        </p>

        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <button
            onClick={() => onAnswer(call)}
            style={{
              padding: "12px 24px",
              background: "#28a745",
              color: "white",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 16,
              fontWeight: 600,
            }}
          >
            ✅ Answer
          </button>
          <button
            onClick={() => onReject(call)}
            style={{
              padding: "12px 24px",
              background: "#dc3545",
              color: "white",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 16,
              fontWeight: 600,
            }}
          >
            ❌ Reject
          </button>
        </div>
      </div>
    </div>
  );
}