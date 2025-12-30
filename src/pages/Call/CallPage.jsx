import React, { useState } from "react";
import { useCall } from "../../context/CallContext";
import ActiveCall from "../../components/ActiveCall";
import IncomingCallModal from "../../components/IncomingCallModal";
import api from "../../api/api";
import Navbar from "../../components/Navbar/Navbar";

export default function CallPage() {
  const { incomingCalls, activeCall, setActiveCall } = useCall();
  const [selectedUser, setSelectedUser] = useState(null);
  const [calling, setCalling] = useState(false);

  async function handleRequestVolunteer() {
    try {
      setCalling(true);
      const token = localStorage.getItem("token");
      if (!token) { 
        alert("Not authenticated"); 
        setCalling(false);
        return; 
      }

      const res = await api.post(
        "/api/call/request-volunteer",
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const { volunteer, roomID } = res.data;
      setActiveCall({ user: volunteer, roomID });
      setSelectedUser(volunteer);
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
      setSelectedUser(call.caller);
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
    setSelectedUser(null);
    setCalling(false);
  }

  const currentIncomingCall = incomingCalls[0];

  if (activeCall && selectedUser) {
    return (
      <ActiveCall
        targetUser={selectedUser}
        roomID={activeCall.roomID}
        onEndCall={handleEndCall}
      />
    );
  }

  return (
    <div>
      <Navbar />
      <div style={{ padding: 20, maxWidth: 800, margin: "0 auto" }}>
        <h1>Video Calls</h1>
        
        <button
          onClick={handleRequestVolunteer}
          disabled={calling || activeCall}
          style={{
            padding: "12px 24px",
            fontSize: 16,
            fontWeight: 600,
            background: calling ? "#ccc" : "#28a745",
            color: "white",
            border: "none",
            borderRadius: 8,
            cursor: calling ? "not-allowed" : "pointer",
          }}
        >
          {calling ? "⏳ Connecting..." : "📞 Call Volunteer"}
        </button>

        {currentIncomingCall && (
          <IncomingCallModal
            call={currentIncomingCall}
            onAnswer={handleAnswerCall}
            onReject={handleRejectCall}
          />
        )}
      </div>
    </div>
  );
}