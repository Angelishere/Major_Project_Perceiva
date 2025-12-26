import React, { useEffect, useRef, useState } from "react";
import { ZegoExpressEngine } from "zego-express-engine-webrtc";
import api from "../api/api";

export default function ActiveCall({ targetUser, roomID, onEndCall }) {
  const [engine, setEngine] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [remoteStream, setRemoteStream] = useState(null);
  const [logs, setLogs] = useState([]);
  const [myUserID, setMyUserID] = useState(null);
  
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const engineRef = useRef(null);
  const localStreamRef = useRef(null);

  function log(msg) {
    console.log(msg);
    setLogs((s) => [new Date().toLocaleTimeString() + " - " + msg, ...s].slice(0, 50));
  }

  useEffect(() => {
    initCall();
    return () => cleanup();
    // eslint-disable-next-line
  }, []);

  async function initCall() {
    try {
      log("Initializing call...");

      // Get Zego token from backend
      const targetId = targetUser?._id ?? targetUser?.id;
      const res = await api.post(
        "/api/call/get-room",
        { targetUserId: targetId }
      );

      const { appID, token, userID } = res.data;
      setMyUserID(userID);
      log(`Got Zego token for userID: ${userID}`);

      // Initialize Zego
      const zg = new ZegoExpressEngine(appID, "wss://wss.zegocloud.com/ws");
      engineRef.current = zg;
      setEngine(zg);

      // Login to room
      await zg.loginRoom(roomID, token, {
        userID: userID,
        userName: "user",
      });

      log("Logged into room: " + roomID);

      // Fetch existing streams already in the room and play them
      try {
        const existing = await zg.getRoomStreamList(roomID);
        if (Array.isArray(existing) && existing.length) {
          log(`Initial streams: ${existing.map(s => s.streamID).join(', ')}`);
          for (const s of existing) {
            try {
              const remote = await zg.startPlayingStream(s.streamID);
              setRemoteStream(remote);
              if (remoteVideoRef.current) {
                remoteVideoRef.current.srcObject = remote;
                await remoteVideoRef.current.play().catch((e) => log("Autoplay blocked: " + e.message));
              }
              log(`✅ Playing initial stream: ${s.streamID}`);
            } catch (err) {
              log(`Failed to play initial stream: ${err.message}`);
            }
          }
        } else {
          log("No initial streams; waiting for updates...");
        }
      } catch (e) {
        log("getRoomStreamList failed: " + e.message);
      }

      // Listen for remote stream
      zg.on("roomStreamUpdate", async (_roomID, updateType, streamList) => {
        if (updateType === "ADD") {
          for (const stream of streamList) {
            log(`Remote stream detected: ${stream.streamID}`);
            
            // Play the remote stream
            try {
              const remote = await zg.startPlayingStream(stream.streamID);
              setRemoteStream(remote);
              if (remoteVideoRef.current) {
                remoteVideoRef.current.srcObject = remote;
                await remoteVideoRef.current.play().catch((e) => log("Autoplay blocked: " + e.message));
              }
              log(`✅ Playing remote stream: ${stream.streamID}`);
            } catch (err) {
              log(`Failed to play stream: ${err.message}`);
            }
          }
        } else if (updateType === "DELETE") {
          log(`Remote stream removed`);
          setRemoteStream(null);
        }
      });

      // Auto-start publishing
      startPublishing(zg, userID);
    } catch (error) {
      log("Call init failed: " + error.message);
      console.error(error);
    }
  }

  async function startPublishing(zg, userID) {
    try {
      log("Starting local stream...");

      // Create Zego stream
      const zegoStream = await zg.createStream({
        camera: {
          video: { width: 640, height: 480 },
          audio: true,
        },
      });

      localStreamRef.current = zegoStream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = zegoStream;
        localVideoRef.current.muted = true;
        await localVideoRef.current.play().catch((e) => log("Local preview play blocked"));
      }
      // Publish with consistent stream ID based on userID
      const streamID = `stream_${userID}`;
      await zg.startPublishingStream(streamID, zegoStream);
      setPublishing(true);
      log(`✅ Publishing as: ${streamID}`);
    } catch (err) {
      log("Publishing failed: " + err.message);
    }
  }

  async function handleEndCall() {
    try {
      // End call on backend
      await api.post("/api/call/end-call", { roomID });

      cleanup();
      onEndCall();
    } catch (error) {
      console.error("End call failed:", error);
      cleanup();
      onEndCall();
    }
  }

  function cleanup() {
    try {
      if (engineRef.current) {
        if (publishing && myUserID) {
          const streamID = `stream_${myUserID}`;
          engineRef.current.stopPublishingStream(streamID).catch((e) => console.warn(e));
        }
        if (localStreamRef.current) {
          engineRef.current.destroyStream(localStreamRef.current).catch((e) => console.warn(e));
        }
        engineRef.current.logoutRoom(roomID).catch((e) => console.warn(e));
        engineRef.current = null;
      }

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }

      log("Call ended and cleaned up");
    } catch (e) {
      console.warn("Cleanup error:", e);
    }
  }

  return (
    <div style={{ padding: 20, maxWidth: 1000, margin: "0 auto" }}>
      <h2>Call with {targetUser?.username}</h2>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
        {/* Local Video */}
        <div>
          <h4>You {myUserID && `(${myUserID.slice(0, 8)}...)`}</h4>
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            style={{
              width: "100%",
              height: 300,
              background: "#000",
              borderRadius: 8,
            }}
          />
        </div>

        {/* Remote Video */}
        <div style={{ position: "relative" }}>
          <h4>{targetUser?.username}</h4>
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            style={{
              width: "100%",
              height: 300,
              background: "#000",
              borderRadius: 8,
            }}
          />
          {!remoteStream && (
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                color: "white",
                fontSize: 14,
                background: "rgba(0,0,0,0.7)",
                padding: "10px 20px",
                borderRadius: 8,
              }}
            >
              Waiting for {targetUser?.username} to join...
            </div>
          )}
        </div>
      </div>

      <div style={{ textAlign: "center" }}>
        <button
          onClick={handleEndCall}
          style={{
            padding: "12px 32px",
            background: "#dc3545",
            color: "white",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
            fontSize: 16,
            fontWeight: 600,
          }}
        >
          ❌ End Call
        </button>
      </div>

      {/* Logs */}
      <div style={{ marginTop: 20 }}>
        <h4>Call Logs (Debug)</h4>
        <div
          style={{
            background: "#111",
            color: "#dff",
            padding: 10,
            height: 150,
            overflowY: "auto",
            borderRadius: 6,
            fontFamily: "monospace",
            fontSize: 12,
          }}
        >
          {logs.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      </div>
    </div>
  );
}