import React, { useEffect, useRef, useState } from "react";
import { ZegoExpressEngine } from "zego-express-engine-webrtc";
import api from "../api/api";

export default function ActiveCall({ targetUser, roomID, onEndCall }) {
  const [engine, setEngine] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [remoteStream, setRemoteStream] = useState(null);
  const [logs, setLogs] = useState([]);
  
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
      const res = await api.post(
        "/api/call/get-room",
        { targetUserId: targetUser._id },
        {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        }
      );

      const { appID, token, userID } = res.data;
      log("Got Zego token, logging in...");

      // Initialize Zego
      const zg = new ZegoExpressEngine(appID, "wss://wss.zegocloud.com/ws");
      engineRef.current = zg;
      setEngine(zg);

      // Login to room
      await zg.loginRoom(roomID, token, {
        userID: userID,
        userName: "caller",
      });

      log("Logged into room: " + roomID);

      // Listen for remote stream
      zg.on("roomStreamUpdate", async (_roomID, updateType, streamList) => {
        if (updateType === "ADD") {
          for (const stream of streamList) {
            log("Remote user joined: " + stream.streamID);
            const remote = await zg.startPlayingStream(stream.streamID);
            setRemoteStream(remote);
            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = remote;
              await remoteVideoRef.current.play().catch((e) => log("Autoplay blocked"));
            }
          }
        }
      });

      // Auto-start publishing
      startPublishing(zg);
    } catch (error) {
      log("Call init failed: " + error.message);
      console.error(error);
    }
  }

  async function startPublishing(zg) {
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

      // Publish
      await zg.startPublishingStream(`call_${Date.now()}`, zegoStream);
      setPublishing(true);
      log("✅ Publishing to Zego");
    } catch (error) {
      log("Failed to start publishing: " + error.message);
      console.error(error);
    }
  }

  async function handleEndCall() {
    try {
      // End call on backend
      await api.post(
        "/api/call/end-call",
        { roomID },
        {
          headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
        }
      );

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
        if (publishing) {
          engineRef.current.stopPublishingStream().catch((e) => console.warn(e));
        }
        if (localStreamRef.current) {
          engineRef.current.destroyStream(localStreamRef.current).catch((e) => console.warn(e));
        }
        engineRef.current.destroy();
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
          <h4>You</h4>
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
        <div>
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
        <h4>Call Logs</h4>
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