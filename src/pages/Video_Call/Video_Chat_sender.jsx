// Video_Chat_Sender.jsx
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ZegoExpressEngine } from "zego-express-engine-webrtc";
import api from "../../api/api";

const TOKEN_ENDPOINT = "https://major-project-perceiva.onrender.com/api/zego/token";
const ROOM_ID = "glassRoom1";
const STREAM_ID_PREFIX = "pi_sender_";
  

export default function Video_Chat_sender({ tokenEndpoint = TOKEN_ENDPOINT }) {
  const navigate = useNavigate();

  const [engine, setEngine] = useState(null);
  const [appID, setAppID] = useState(null);
  const [userID, setUserID] = useState(null);
  const [token, setToken] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [availableDevices, setAvailableDevices] = useState({ video: [], audio: [] });
  const [selectedVideoId, setSelectedVideoId] = useState("");
  const [selectedAudioId, setSelectedAudioId] = useState("");
  const [publishing, setPublishing] = useState(false);
  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null); // holds preview or published stream
  const [streamID, setStreamID] = useState(STREAM_ID_PREFIX + Date.now());
  const [logs, setLogs] = useState([]);
  const [useObs, setUseObs] = useState(false);

  // helper logger
  function log(msg) {
    setLogs(s => [new Date().toLocaleTimeString() + " - " + msg, ...s].slice(0, 120));
    console.log(msg);
  }

  // cleanup on unmount
  useEffect(() => {
    return () => {
      try {
        stopPreviewStream();
        if (engine) {
          try { engine.destroy(); } catch (e) { console.warn("engine destroy failed", e); }
        }
      } catch (e) {
        console.warn("Cleanup error", e);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refreshDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stop and clear any existing preview stream
  function stopPreviewStream() {
    try {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
        localStreamRef.current = null;
      }
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }
      log("Preview stopped");
    } catch (e) {
      console.warn("stopPreviewStream error", e);
      log("stopPreviewStream error: " + (e.message || e));
    }
  }

  // Create a preview from currently selectedVideoId (or default camera)
  async function previewSelectedDevice(deviceId) {
    try {
      const videoId = deviceId || selectedVideoId;
      log("Starting preview for device: " + (videoId || "default"));
      stopPreviewStream();

      const constraints = videoId
        ? { video: { deviceId: { exact: videoId } }, audio: false }
        : { video: true, audio: false };

      log("preview constraints: " + JSON.stringify(constraints));

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      // keep a reference so publishing can reuse it
      localStreamRef.current = stream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.muted = true;
        try {
          await localVideoRef.current.play();
          log("Preview playing");
        } catch (playErr) {
          console.warn("Video play() failed:", playErr);
          log("Preview play() blocked by autoplay policy. Click preview to allow playback.");
        }
      }
    } catch (err) {
      console.error("previewSelectedDevice getUserMedia failed:", err);
      log("Failed to open camera for preview: " + (err.message || err));
      alert("Failed to open camera for preview: " + (err.message || err.name || err));
    }
  }

  async function refreshDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const video = devices.filter(d => d.kind === "videoinput");
      const audio = devices.filter(d => d.kind === "audioinput");
      setAvailableDevices({ video, audio });

      // auto-select if OBS requested
      const obs = video.find(v => /obs virtual camera/i.test(v.label));
      if (useObs && obs) {
        setSelectedVideoId(obs.deviceId);
        log("OBS Virtual Camera auto-selected");
        // Use the obs deviceId directly instead of relying on state update
        setTimeout(() => previewSelectedDevice(obs.deviceId), 200);
      } else {
        const videoToSelect = selectedVideoId || (video[0] && video[0].deviceId);
        if (videoToSelect && videoToSelect !== selectedVideoId) {
          setSelectedVideoId(videoToSelect);
          setTimeout(() => previewSelectedDevice(videoToSelect), 200);
        } else {
          setTimeout(() => previewSelectedDevice(), 200);
        }
      }

      if (!selectedAudioId && audio[0]) setSelectedAudioId(audio[0].deviceId);
      log("Device list refreshed");
    } catch (e) {
      log("Could not list devices: " + (e.message || e));
    }
  }

  useEffect(() => {
    if (useObs) {
      const obs = availableDevices.video.find(v => /obs virtual camera/i.test(v.label));
      if (obs) {
        setSelectedVideoId(obs.deviceId);
        log("OBS Virtual Camera selected");
        setTimeout(() => previewSelectedDevice(obs.deviceId), 150);
      } else {
        log("OBS Virtual Camera not found. Start OBS Virtual Camera and click Refresh Devices.");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useObs, availableDevices.video]);

  // create engine once we have an appID
  function initializeEngine(appId) {
    if (engine) {
      try { engine.destroy(); } catch (e) { console.warn("destroy engine failed", e); }
      setEngine(null);
    }
    const zg = new ZegoExpressEngine(appId, "wss://wss.zegocloud.com/ws");
    setEngine(zg);
    setAppID(appId);

    // Listen for SDK errors before login
    zg.on && zg.on("error", (code, msg) => {
      log("SDK Error: code=" + code + " msg=" + msg);
    });
    zg.on && zg.on("engineStateUpdate", (state) => {
      log("Engine state: " + state);
    });

    zg.on && zg.on("roomStreamUpdate", (roomID, updateType, streamList) => {
      log(`roomStreamUpdate: ${updateType} ${streamList.length} streams`);
    });
    zg.on && zg.on("publishStateUpdate", (s, state, error) => {
      log(`publishStateUpdate: ${s} state=${state} error=${JSON.stringify(error)}`);
    });
    zg.on && zg.on("playStateUpdate", (s, state, error) => {
      log(`playStateUpdate: ${s} state=${state} error=${JSON.stringify(error)}`);
    });
    zg.on && zg.on("error", (code, msg) => {
      log(`Zego SDK error: ${code} ${msg}`);
    });

    return zg;
  }

  // Safe fetch + login
  async function fetchTokenAndLogin() {
    try {
      setIsLoggedIn(false);
      log("Requesting token from backend");

      const res = await api.post("/api/zego/token", {
        roomID: ROOM_ID,
      });

      const body = res.data;

      if (!body || !body.token || !body.appID || !body.userID) {
        throw new Error("Invalid token response: " + JSON.stringify(body));
      }

      const tokenStr = String(body.token);
      setToken(tokenStr);
      setUserID(String(body.userID));

      const zg = initializeEngine(Number(body.appID));

      await zg.loginRoom(
        ROOM_ID,
        tokenStr,
        { userID: String(body.userID), userName: "sender" }
      );

      setIsLoggedIn(true);
    } catch (e) {
      log("Token/login error: " + (e.message || e));
      setIsLoggedIn(false);
      throw e;
    }
  }


  // start publish — reuse preview stream if present, but ensure login
  async function startLocalPreviewAndPublish() {
    try {
      if (!engine) {
        log("Engine not initialized - call Fetch Token & Login first");
        alert("Call Fetch Token & Login first");
        return;
      }
      if (!token) {
        log("No token available - call Fetch Token & Login first");
        alert("No token available - call Fetch Token & Login first");
        return;
      }
      if (!isLoggedIn) {
        log("Not logged in - please fetch token and wait for login success before publishing");
        alert("Not logged in - click Fetch Token & Login and wait for success before publishing");
        return;
      }

      // Build stream configuration for Zego's createStream
      const videoConstraint = selectedVideoId
        ? { deviceId: selectedVideoId, width: 640, height: 480, frameRate: 15 }
        : { width: 640, height: 480, frameRate: 15 };

      const audioConstraint = selectedAudioId
        ? { deviceId: selectedAudioId }
        : true;

      log("Creating Zego stream with constraints: " + JSON.stringify({ video: videoConstraint, audio: audioConstraint }));

      try {
        // CRITICAL: Use Zego's createStream instead of getUserMedia
        const zegoStream = await engine.createStream({
          camera: {
            video: videoConstraint,
            audio: audioConstraint
          }
        });

        log("Zego stream created successfully");

        // Store reference and attach to video preview
        localStreamRef.current = zegoStream;

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = zegoStream;
          localVideoRef.current.muted = true;
          try {
            await localVideoRef.current.play();
            log("Preview playing");
          } catch (e) {
            log("preview play() failed: " + (e.message || e));
          }
        }

        // Now publish the Zego-created stream
        const pubRes = await engine.startPublishingStream(streamID, zegoStream);
        setPublishing(true);
        log("✅ Publishing succeeded! streamID=" + streamID);
      } catch (streamErr) {
        log("Failed to create/publish stream: " + (streamErr.message || JSON.stringify(streamErr)));
        console.error("Stream creation/publish error:", streamErr);

        if (String(streamErr).toLowerCase().includes("not login") || String(streamErr).toLowerCase().includes("not logged")) {
          alert("Publish failed: SDK not logged in. Please click 'Fetch Token & Login' again, wait for login success, then Start Publish.");
        } else {
          alert("Failed to create/publish stream: " + (streamErr.message || JSON.stringify(streamErr)));
        }
      }
    } catch (e) {
      log("Failed to start publishing: " + (e.message || JSON.stringify(e)));
      console.error(e);
      alert("Failed to start publishing: " + (e.message || e));
    }
  }

  async function stopPublish() {
    try {
      if (engine && publishing) {
        await engine.stopPublishingStream(streamID);
        setPublishing(false);
        log("Stopped publishing");
      }

      // Destroy the Zego stream and stop preview
      if (localStreamRef.current) {
        if (engine) {
          try {
            await engine.destroyStream(localStreamRef.current);
            log("Destroyed Zego stream");
          } catch (e) {
            console.warn("destroyStream warning:", e);
          }
        }
        localStreamRef.current = null;
      }

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }
    } catch (e) {
      log("Stop publish error: " + (e.message || e));
    }
  }

  function handlePreviewClick() {
    if (localVideoRef.current) {
      localVideoRef.current.muted = true;
      localVideoRef.current.play().then(() => log("User-initiated play successful")).catch(e => log("User play failed: " + (e.message || e)));
    }
  }

  return (
    <div style={{ fontFamily: "Inter, Arial, sans-serif", padding: 16, maxWidth: 980 }}>
      <h1>Glass Sender — Publish OBS or Laptop Camera to Zego</h1>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", marginBottom: 6 }}>Room ID</label>
        <input value={ROOM_ID} readOnly style={{ width: 240 }} />
        <label style={{ display: "block", marginTop: 8 }}>Stream ID</label>
        <input value={streamID} onChange={e => setStreamID(e.target.value)} style={{ width: 320 }} />
      </div>

      <div style={{ display: "flex", gap: 20 }}>
        <div style={{ flex: 1 }}>
          <h4>Choose Input Source</h4>

          <div style={{ marginBottom: 8 }}>
            <label style={{ marginRight: 8 }}>
              <input type="checkbox" checked={useObs} onChange={e => setUseObs(e.target.checked)} />
              {" "}Prefer OBS Virtual Camera (auto-select if available)
            </label>
            <button onClick={refreshDevices} style={{ marginLeft: 12 }}>Refresh Devices</button>
            <button onClick={previewSelectedDevice} style={{ marginLeft: 8 }}>Preview</button>
            <button onClick={() => navigator.mediaDevices.getUserMedia({ video: true, audio: false }).then(s => { localVideoRef.current && (localVideoRef.current.srcObject = s); setTimeout(() => { s.getTracks().forEach(t => t.stop()); if (localVideoRef.current) localVideoRef.current.srcObject = null; }, 4000); }).catch(e => { alert("Quick test failed: " + (e.message || e)); })} style={{ marginLeft: 8 }}>Test Camera</button>
          </div>

          <div style={{ marginTop: 8 }}>
            <div style={{ marginBottom: 6 }}>Video input (select laptop camera or OBS):</div>
            <select value={selectedVideoId} onChange={e => { const deviceId = e.target.value; setSelectedVideoId(deviceId); setUseObs(false); setTimeout(() => previewSelectedDevice(deviceId), 100); }} style={{ width: "100%" }}>
              {availableDevices.video.map(v => <option key={v.deviceId} value={v.deviceId}>{v.label || v.deviceId}</option>)}
            </select>
            <small style={{ color: "#666" }}>If OBS Virtual Camera is running and you checked the checkbox, it will be auto-selected</small>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 6 }}>Audio input (select laptop mic):</div>
            <select value={selectedAudioId} onChange={e => setSelectedAudioId(e.target.value)} style={{ width: "100%" }}>
              {availableDevices.audio.map(a => <option key={a.deviceId} value={a.deviceId}>{a.label || a.deviceId}</option>)}
            </select>
            <small style={{ color: "#666" }}>If you want OBS audio, ensure OBS is publishing audio to a virtual device and select it here</small>
          </div>

          <div style={{ marginTop: 12 }}>
            <button onClick={async () => {
              try {
                await fetchTokenAndLogin();
                log("Ready to publish. Click Start Publish after login success.");
              } catch (e) {
                log("Login failed: " + (e.message || e));
                alert("Login failed: " + (e.message || e));
              }
            }}>Fetch Token & Login</button>

            <button onClick={() => startLocalPreviewAndPublish()} disabled={!token || publishing || !isLoggedIn} style={{ marginLeft: 8 }}>Start Publish</button>
            <button onClick={() => stopPublish()} disabled={!publishing} style={{ marginLeft: 8 }}>Stop Publish</button>
          </div>

          <div style={{ marginTop: 12 }}>
            <label>Or paste a test token (dev):</label><br />
            <input placeholder="paste token here" value={token} onChange={e => setToken(e.target.value)} style={{ width: "100%" }} />
          </div>
        </div>

        <div style={{ width: 520 }}>
          <h4>Local Preview</h4>
          <video ref={localVideoRef} autoPlay playsInline muted style={{ width: "100%", background: "#000", cursor: "pointer" }} onClick={handlePreviewClick} />
          <div style={{ marginTop: 8 }}>
            <strong>Status:</strong> {publishing ? "Publishing to Zego (stream: " + streamID + ")" : isLoggedIn ? "Logged in (idle)" : "Idle / not logged in"}
          </div>

          <div style={{ marginTop: 12 }}>
            <h5>Detected Devices</h5>
            <div style={{ fontSize: 13 }}>
              <div><strong>Video:</strong></div>
              <ul>
                {availableDevices.video.map(v => <li key={v.deviceId}>{v.label || v.deviceId} <span style={{ color: "#666" }}>({v.deviceId})</span></li>)}
              </ul>
              <div><strong>Audio:</strong></div>
              <ul>
                {availableDevices.audio.map(a => <li key={a.deviceId}>{a.label || a.deviceId} <span style={{ color: "#666" }}>({a.deviceId})</span></li>)}
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <h4>Logs</h4>
        <div style={{ maxHeight: 320, overflow: "auto", background: "#111", color: "#dff", padding: 8, fontFamily: "monospace" }}>
          {logs.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      </div>
    </div>
  );
}
