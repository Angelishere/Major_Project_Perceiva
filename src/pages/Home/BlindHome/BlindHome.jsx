import React, { useState } from "react";
import { useCall } from "../../../context/CallContext";
import ActiveCall from "../../../components/ActiveCall";
import IncomingCallModal from "../../../components/IncomingCallModal";
import api from "../../../api/api";
import Navbar from "../../../components/Navbar/Navbar";

export default function BlindHome() {
  const { incomingCalls, activeCall, setActiveCall } = useCall();
  const [calling, setCalling] = useState(false);
  const [selectedVolunteer, setSelectedVolunteer] = useState(null);

  async function handleCallVolunteer() {
    try {
      setCalling(true);

      const token = localStorage.getItem("token");
      if (!token) {
        alert("Not authenticated");
        setCalling(false);
        return;
      }

      // Request available volunteer from backend (atomic lock)
      const res = await api.post(
        "/api/call/request-volunteer",
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const { volunteer, roomID } = res.data;

      setSelectedVolunteer(volunteer);
      setActiveCall({ user: volunteer, roomID });
    } catch (error) {
      console.error("Failed to request volunteer:", error);
      alert(error.response?.data?.message || "Failed to connect with volunteer");
      setCalling(false);
    }
  }

  async function handleAnswerCall(call) {
    try {
      const token = localStorage.getItem("token");
      await api.post(
        "/api/call/answer-call",
        { roomID: call.roomID },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setActiveCall({ user: call.caller, roomID: call.roomID });
      setSelectedVolunteer(call.caller);
    } catch (error) {
      console.error("Failed to answer call:", error);
    }
  }

  async function handleRejectCall(call) {
    try {
      const token = localStorage.getItem("token");
      await api.post(
        "/api/call/end-call",
        { roomID: call.roomID },
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } catch (error) {
      console.error("Failed to reject call:", error);
    }
  }

  function handleEndCall() {
    setActiveCall(null);
    setSelectedVolunteer(null);
    setCalling(false);
  }

  // Show active call
  if (activeCall && selectedVolunteer) {
    return (
      <ActiveCall
        targetUser={selectedVolunteer}
        roomID={activeCall.roomID}
        onEndCall={handleEndCall}
      />
    );
  }

  const currentIncomingCall = incomingCalls[0];

  return (
    <div>
      <div
        style={{
          padding: 40,
          maxWidth: 600,
          margin: "0 auto",
          textAlign: "center",
        }}
      >
        <h1 style={{ marginBottom: 20 }}>Welcome</h1>
        <p style={{ fontSize: 16, color: "#666", marginBottom: 30 }}>
          Press the button below to connect with an available volunteer
        </p>

        <button
          onClick={handleCallVolunteer}
          disabled={calling || activeCall}
          style={{
            padding: "16px 40px",
            fontSize: 20,
            fontWeight: 700,
            background: calling ? "#ccc" : "#28a745",
            color: "white",
            border: "none",
            borderRadius: 12,
            cursor: calling ? "not-allowed" : "pointer",
            transition: "background 0.3s",
          }}
        >
          {calling ? "⏳ Connecting..." : "📞 Call a Volunteer"}
        </button>
      </div>

      {/* Incoming call modal for volunteer callbacks */}
      <IncomingCallModal
        call={currentIncomingCall}
        onAnswer={handleAnswerCall}
        onReject={handleRejectCall}
      />
    </div>
  );
}