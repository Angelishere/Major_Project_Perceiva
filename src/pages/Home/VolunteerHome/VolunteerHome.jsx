import React, { useState } from "react";
import { useCall } from "../../../context/CallContext";
import ActiveCall from "../../../components/ActiveCall";
import IncomingCallModal from "../../../components/IncomingCallModal";
import api from "../../../api/api";

const VolunteerHome = () => {
  const { incomingCalls, activeCall, setActiveCall } = useCall();
  const [currentPeer, setCurrentPeer] = useState(null);

  async function handleAnswerCall(call) {
    try {
      const token = localStorage.getItem("token");
      await api.post(
        "/api/call/answer-call",
        { roomID: call.roomID },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const callerUser = { ...call.caller, _id: call.caller.id || call.caller._id };
      setActiveCall({ user: callerUser, roomID: call.roomID });
      setCurrentPeer(callerUser);
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
    setCurrentPeer(null);
  }

  const currentIncomingCall = incomingCalls[0];

  if (activeCall && currentPeer) {
    return (
      <ActiveCall
        targetUser={currentPeer}
        roomID={activeCall.roomID}
        onEndCall={handleEndCall}
      />
    );
  }

  return (
    <div style={{ padding: 32, maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 12 }}>Volunteer Dashboard</h1>
      <p style={{ color: "#555", marginBottom: 24 }}>
        Keep this page open to receive calls from blind users. You will see a popup when a call comes in.
      </p>

      {currentIncomingCall ? (
        <IncomingCallModal
          call={currentIncomingCall}
          onAnswer={handleAnswerCall}
          onReject={handleRejectCall}
        />
      ) : (
        <div style={{ padding: 16, background: "#f8f9fa", borderRadius: 8 }}>
          <strong>No incoming calls.</strong> Waiting for blind users to connect...
        </div>
      )}
    </div>
  );
};

export default VolunteerHome;