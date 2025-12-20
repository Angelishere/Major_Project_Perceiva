// Video_Chat.jsx (robust viewer)
import React, { useEffect, useRef, useState } from "react";
import { ZegoExpressEngine } from "zego-express-engine-webrtc";

const TOKEN_ENDPOINT = "https://major-project-perceiva.onrender.com/api/zego/token";
const ROOM_ID = "glassRoom1";
const STREAM_PREFIX = "pi_sender_";

export default function Video_Chat() {
  const videoRef = useRef(null);
  const [logs, setLogs] = useState([]);
  const engineRef = useRef(null);
  const listenerRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const [streamStatus, setStreamStatus] = useState("Waiting for stream...");
  const [currentStreamID, setCurrentStreamID] = useState(null);

  function log(msg) {
    setLogs(s => [new Date().toLocaleTimeString() + " - " + msg, ...s].slice(0, 200));
    console.log(msg);
  }

  useEffect(() => {
    let mounted = true;

    async function initViewer() {
      try {
        log("Requesting token from server...");
        const res = await fetch(TOKEN_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomID: ROOM_ID }),
        });

        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(`Token endpoint returned ${res.status} ${txt}`);
        }

        const body = await res.json().catch(() => null);
        if (!body || !("token" in body) || !body.appID) {
          throw new Error("Invalid token server response");
        }

        // coerce token to string and show preview
        const tokenStr = String(body.token);
        log(`Received token (type: ${typeof tokenStr}) preview: ${tokenStr.slice(0, 80)}`);

        // init engine
        const zg = new ZegoExpressEngine(Number(body.appID), "wss://wss.zegocloud.com/ws");
        engineRef.current = zg;
        
        // Listen for SDK errors before login
        zg.on("error", (code, msg) => {
          log("SDK Error: code=" + code + " msg=" + msg);
        });
        zg.on("engineStateUpdate", (state) => {
          log("Engine state: " + state);
        });

        // login with timeout
        try {
          log("Attempting loginRoom with userID: " + body.userID);
          log("Token length: " + tokenStr.length + " appID: " + Number(body.appID) + " ROOM_ID: " + ROOM_ID);
          // Zego Web SDK signature: loginRoom(roomID, token, user)
          const loginPromise = zg.loginRoom(ROOM_ID, tokenStr, { userID: body.userID || `viewer_${Date.now()}`, userName: "viewer" });
          const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("loginRoom timeout after 10s")), 10000));
          await Promise.race([loginPromise, timeoutPromise]);
          log("Viewer logged into room: " + ROOM_ID);
        } catch (loginErr) {
          const errMsg = loginErr && (loginErr.message || JSON.stringify(loginErr));
          log("loginRoom failed: " + errMsg);
          console.error("loginRoom error object:", loginErr);
          throw loginErr;
        }

        // handle stream add events
        const onRoomStreamUpdate = async (_roomID, updateType, streamList) => {
          try {
            log(`roomStreamUpdate: ${updateType} (${(streamList||[]).length})`);
            if (updateType === "ADD") {
              for (const s of streamList) {
                log("Discovered stream: " + s.streamID);
                if (s.streamID && s.streamID.startsWith(STREAM_PREFIX)) {
                  await playRemoteStream(zg, s.streamID);
                  // first matching stream is sufficient for this simple viewer
                  return;
                }
              }
            }
            if (updateType === "DELETE") {
              log("Stream removed: " + JSON.stringify(streamList.map(x => x.streamID)));
              stopRemoteStream();
            }
          } catch (err) {
            log("roomStreamUpdate handler error: " + (err && (err.message || JSON.stringify(err))));
          }
        };

        listenerRef.current = onRoomStreamUpdate;
        zg.on("roomStreamUpdate", onRoomStreamUpdate);

        // check existing streams (room may already have the sender stream)
        try {
          const roomInfo = await zg.getRoomStreamList(ROOM_ID);
          const match = roomInfo.streamList?.find(s => s.streamID && s.streamID.startsWith(STREAM_PREFIX));
          if (match) {
            log("Stream already exists, playing: " + match.streamID);
            await playRemoteStream(zg, match.streamID);
          } else {
            log("No matching streams yet; waiting for sender to publish...");
          }
        } catch (err) {
          log("getRoomStreamList failed: " + (err && (err.message || JSON.stringify(err))));
        }
      } catch (err) {
        if (!mounted) return;
        log("Viewer init error: " + (err && (err.message || JSON.stringify(err))));
      }
    }

    async function playRemoteStream(zg, streamID) {
      try {
        log("Attempting startPlayingStream: " + streamID);
        setStreamStatus("Connecting to stream: " + streamID);
        const remoteStream = await zg.startPlayingStream(streamID);
        remoteStreamRef.current = remoteStream;
        setCurrentStreamID(streamID);

        // attach and attempt to play (autoplay may require user gesture)
        if (videoRef.current) {
          videoRef.current.srcObject = remoteStream;
          try {
            await videoRef.current.play();
            log("Remote video playback started");
            setStreamStatus("Playing: " + streamID);
          } catch (playErr) {
            log("Autoplay prevented; user-interaction needed to start playback");
            setStreamStatus("Stream connected (click Play button to start)");
            // show a short UI hint (could be improved)
          }
        }
      } catch (err) {
        log("startPlayingStream failed for " + streamID + ": " + (err && (err.message || JSON.stringify(err))));
        setStreamStatus("Failed to play stream: " + (err?.message || "unknown error"));
      }
    }

    function stopRemoteStream() {
      try {
        if (remoteStreamRef.current) {
          remoteStreamRef.current.getTracks().forEach(t => t.stop());
          remoteStreamRef.current = null;
        }
        if (videoRef.current) videoRef.current.srcObject = null;
        log("Stopped remote stream and cleared preview");
        setStreamStatus("Stream stopped");
        setCurrentStreamID(null);
      } catch (err) {
        log("stopRemoteStream error: " + (err && err.message));
      }
    }

    initViewer();

    return () => {
      mounted = false;
      try {
        // remove listener
        const zg = engineRef.current;
        if (zg && listenerRef.current) {
          try { zg.off && zg.off("roomStreamUpdate", listenerRef.current); } catch (e) {}
        }

        stopRemoteStream();

        if (engineRef.current) {
          try { engineRef.current.destroy(); } catch (e) { console.warn("engine destroy failed", e); }
          engineRef.current = null;
        }
      } catch (e) {
        console.warn("Viewer cleanup error", e);
      }
    };
  }, []);

  return (
    <div style={{ padding: 20, fontFamily: "Inter, Arial" }}>
      <h2>Viewer — Watch Smart Glass Stream</h2>
      
      <div style={{ marginBottom: 12, padding: 10, background: "#f0f0f0", borderRadius: 6 }}>
        <strong>Stream Status:</strong> {streamStatus}
        {currentStreamID && <div style={{ fontSize: 12, color: "#666" }}>Stream ID: {currentStreamID}</div>}
      </div>

      <video
        ref={videoRef}
        autoPlay
        playsInline
        controls
        style={{
          width: "640px",
          height: "360px",
          background: "#000",
          borderRadius: 8,
          display: "block",
          cursor: "pointer",
        }}
        onClick={() => videoRef.current?.play()}
      />
      
      <button onClick={() => videoRef.current?.play()} style={{ marginTop: 8, padding: "8px 16px", cursor: "pointer" }}>
        ▶ Play Stream
      </button>

      <div style={{ marginTop: 20 }}>
        <h3>Logs</h3>
        <div
          style={{
            background: "#111",
            color: "#dff",
            padding: 10,
            height: 200,
            overflowY: "auto",
            borderRadius: 6,
            fontFamily: "monospace",
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
