import React, { useState } from "react";
import { useCall } from "../../context/CallContext";
import UserListCard from "../../components/UserListCard";
import ActiveCall from "../../components/ActiveCall";
import IncomingCallModal from "../../components/IncomingCallModal";
import api from "../../api/api";
import Navbar from "../../components/Navbar/Navbar";

function generateRoomId(userId1, userId2) {
  const ids = [userId1, userId2].sort();
  return `call_${ids[0]}_${ids[1]}`;
}

export default function CallPage() {
  const { incomingCalls, activeCall, setActiveCall } = useCall();
  const [selectedUser, setSelectedUser] = useState(null);

  async function handleCallUser(user) {
    try {
      // Get current user ID from JWT
      const token = localStorage.getItem("token");
      if (!token) { alert("Not authenticated"); return; }
      const payload = JSON.parse(atob(token.split(".")[1]));
      const currentUserId = payload.userId;

      const roomID = generateRoomId(currentUserId, user._id);

      // Initiate call on backend
      await api.post(
        "/api/call/initiate-call",
        { targetUserId: user._id },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      // Start active call
      setActiveCall({ user, roomID });
      setSelectedUser(user);
    } catch (error) {
      console.error("Failed to initiate call:", error);
      alert("Failed to start call");
    }
  }

  async function handleAnswerCall(call) {
    try {
      // Answer call on backend
      await api.post(
        "/api/call/answer-call",
        { roomID: call.roomID },
        {
          headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
        }
      );

      // Start active call
      setActiveCall({ user: call.caller, roomID: call.roomID });
      setSelectedUser(call.caller);
    } catch (error) {
      console.error("Failed to answer call:", error);
    }
  }

  async function handleRejectCall(call) {
    try {
      await api.post(
        "/api/call/end-call",
        { roomID: call.roomID },
        {
          headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
        }
      );
    } catch (error) {
      console.error("Failed to reject call:", error);
    }
  }

  function handleEndCall() {
    setActiveCall(null);
    setSelectedUser(null);
  }

  // Show incoming call modal
  const currentIncomingCall = incomingCalls[0]; // Show first call

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
      <Navbar/>
      <div style={{ padding: 20, maxWidth: 800, margin: "0 auto" }}>
      <h1>Video Calls</h1>
      <UserListCard onCallUser={handleCallUser} />

      {/* Incoming call notification */}
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