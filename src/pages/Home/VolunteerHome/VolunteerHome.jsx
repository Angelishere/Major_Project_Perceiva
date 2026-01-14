import React, { useState, useEffect } from "react";
import { useCall } from "../../../context/CallContext";
import ActiveCall from "../../../components/ActiveCall";
import IncomingCallModal from "../../../components/IncomingCallModal";
import api from "../../../api/api";

const VolunteerHome = () => {
  const { incomingCalls, activeCall, setActiveCall } = useCall();
  const [currentPeer, setCurrentPeer] = useState(null);
  const [isAvailable, setIsAvailable] = useState(false);
  const [loading, setLoading] = useState(false);

  // Fetch current availability status on mount
  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await api.get("/api/profile");
        setIsAvailable(res.data.isAvailable || false);
      } catch (error) {
        console.error("Failed to fetch profile:", error);
      }
    };
    fetchProfile();
  }, []);

  // Handle availability toggle
  async function handleToggleAvailability() {
    try {
      setLoading(true);
      const newAvailability = !isAvailable;
      
      const res = await api.put("/api/profile", {
        isAvailable: newAvailability
      });
      
      setIsAvailable(res.data.isAvailable);
      console.log("Availability updated to:", newAvailability);
    } catch (error) {
      console.error("Failed to update availability:", error);
      alert("Failed to update availability. Please try again.");
    } finally {
      setLoading(false);
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

      {/* Availability Toggle */}
      <div style={{
        padding: 16,
        background: isAvailable ? "#d4edda" : "#f8d7da",
        border: `2px solid ${isAvailable ? "#28a745" : "#dc3545"}`,
        borderRadius: 8,
        marginBottom: 24,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center"
      }}>
        <div>
          <strong style={{ fontSize: 16, color: isAvailable ? "#155724" : "#721c24" }}>
            {isAvailable ? "✅ You are Available" : "❌ You are Unavailable"}
          </strong>
          <p style={{ margin: "8px 0 0 0", color: isAvailable ? "#155724" : "#721c24", fontSize: 14 }}>
            {isAvailable 
              ? "You will receive calls from blind users" 
              : "Blind users cannot call you"}
          </p>
        </div>
        <button
          onClick={handleToggleAvailability}
          disabled={loading}
          style={{
            padding: "10px 20px",
            fontSize: 14,
            fontWeight: 600,
            background: isAvailable ? "#dc3545" : "#28a745",
            color: "white",
            border: "none",
            borderRadius: 6,
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.6 : 1,
            transition: "all 0.3s ease"
          }}
        >
          {loading ? "Updating..." : isAvailable ? "Go Unavailable" : "Go Available"}
        </button>
      </div>

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