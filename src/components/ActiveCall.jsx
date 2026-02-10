import React, { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import api from "../api/api";

export default function ActiveCall({ targetUser, roomID, onEndCall }) {
  const [room, setRoom] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [remoteParticipant, setRemoteParticipant] = useState(null);
  const [logs, setLogs] = useState([]);
  const [myUserID, setMyUserID] = useState(null);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const roomRef = useRef(null);

  function log(msg) {
    console.log(msg);
    setLogs((s) => [new Date().toLocaleTimeString() + " - " + msg, ...s].slice(0, 50));
  }

  useEffect(() => {
    initCall();

    // Handle tab close / browser navigation
    const handleBeforeUnload = (e) => {
      if (roomRef.current) {
        roomRef.current.disconnect(true);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      cleanup();
    };
    // eslint-disable-next-line
  }, []);

  async function initCall() {
    try {
      log("Initializing call...");

      // Get LiveKit token from backend
      const targetId = targetUser?._id ?? targetUser?.id;
      const res = await api.post(
        "/api/call/get-room",
        { targetUserId: targetId }
      );

      const { livekitUrl, token, userID } = res.data;
      setMyUserID(userID);
      log(`Got LiveKit token for userID: ${userID}`);

      // Initialize LiveKit Room
      const newRoom = new Room({
        adaptiveStream: true,
        dynacast: true,
      });
      roomRef.current = newRoom;
      setRoom(newRoom);

      // Set up event listeners before connecting
      setupRoomListeners(newRoom);

      // Connect to room
      await newRoom.connect(livekitUrl, token);
      log("Connected to room: " + roomID);

      // Enable camera and microphone
      await newRoom.localParticipant.enableCameraAndMicrophone();
      log("Camera and microphone enabled");
      setPublishing(true);

      // Attach local video
      const localVideoTrack = newRoom.localParticipant.getTrackPublication(Track.Source.Camera);
      if (localVideoTrack?.track && localVideoRef.current) {
        localVideoTrack.track.attach(localVideoRef.current);
        log("✅ Local video attached");
      }

      // Check for existing remote participants
      newRoom.remoteParticipants.forEach((participant) => {
        handleParticipantConnected(participant);
      });

    } catch (error) {
      log("Call init failed: " + error.message);
      console.error(error);
    }
  }

  function setupRoomListeners(room) {
    room.on(RoomEvent.ParticipantConnected, (participant) => {
      log(`Participant joined: ${participant.identity}`);
      handleParticipantConnected(participant);
    });

    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      log(`Participant left: ${participant.identity}`);
      setRemoteParticipant(null);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
    });

    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      log(`Track subscribed: ${track.kind} from ${participant.identity}`);
      if (track.kind === "video" && remoteVideoRef.current) {
        track.attach(remoteVideoRef.current);
        log("✅ Remote video attached");
      }
      if (track.kind === "audio") {
        // Audio tracks auto-play when attached to an element
        const audioElement = track.attach();
        document.body.appendChild(audioElement);
        log("✅ Remote audio attached");
      }
    });

    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      log(`Track unsubscribed: ${track.kind}`);
      track.detach();
    });

    room.on(RoomEvent.Disconnected, () => {
      log("Disconnected from room");
    });
  }

  function handleParticipantConnected(participant) {
    setRemoteParticipant(participant);

    // Subscribe to existing tracks
    participant.trackPublications.forEach((publication) => {
      if (publication.track) {
        if (publication.track.kind === "video" && remoteVideoRef.current) {
          publication.track.attach(remoteVideoRef.current);
          log(`✅ Attached existing video from ${participant.identity}`);
        }
        if (publication.track.kind === "audio") {
          const audioElement = publication.track.attach();
          document.body.appendChild(audioElement);
          log(`✅ Attached existing audio from ${participant.identity}`);
        }
      }
    });
  }

  async function handleEndCall() {
    try {
      // End call on backend
      await api.post("/api/call/end-call", { roomID });

      await cleanup();
      onEndCall();
    } catch (error) {
      console.error("End call failed:", error);
      await cleanup();
      onEndCall();
    }
  }

  async function cleanup() {
    try {
      log("Starting cleanup...");

      if (roomRef.current) {
        // Unpublish all tracks first
        const localParticipant = roomRef.current.localParticipant;
        if (localParticipant) {
          localParticipant.trackPublications.forEach((publication) => {
            if (publication.track) {
              publication.track.stop();
              log(`Stopped track: ${publication.track.kind}`);
            }
          });
        }

        // Disconnect from room - AWAIT this!
        await roomRef.current.disconnect(true); // true = stop all tracks
        log("Disconnected from room");
        roomRef.current = null;
        setRoom(null);
      }

      // Remove any audio elements we added to document.body
      const audioElements = document.querySelectorAll('audio');
      audioElements.forEach((el) => {
        if (el.parentNode === document.body) {
          el.remove();
          log("Removed audio element");
        }
      });

      // Clear remote participant reference
      setRemoteParticipant(null);
      setPublishing(false);

      log("✅ Cleanup complete");
    } catch (e) {
      console.error("Cleanup error:", e);
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
          {!remoteParticipant && (
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