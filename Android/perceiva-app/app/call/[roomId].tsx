import React, { useEffect, useState, useRef, useCallback } from "react";
import {
    View,
    Text,
    TouchableOpacity,
    Alert,
    StyleSheet,
    ActivityIndicator,
    AppState,
    Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, router, Href } from "expo-router";
import {
    Room,
    RoomEvent,
    Track,
    VideoPresets,
    ConnectionState,
} from "livekit-client";
import { VideoView } from "@livekit/react-native";
import api from "../../api/api";
import { useCall } from "../../context/CallContext";

type TrackInfo = {
    sid: string;
    videoTrack: any;
    audioTrack: any;
    participantIdentity: string;
};

export default function CallScreen() {
    const { roomId } = useLocalSearchParams<{ roomId: string }>();
    const { setActiveCall } = useCall();

    const [status, setStatus] = useState<"waiting" | "connecting" | "connected" | "ended">("waiting");
    const [localTrack, setLocalTrack] = useState<any>(null);
    const [remoteTracks, setRemoteTracks] = useState<TrackInfo[]>([]);
    const [logs, setLogs] = useState<string[]>([]);

    const roomRef = useRef<Room | null>(null);
    const cancelledRef = useRef(false);

    function log(msg: string) {
        console.log(`[Call] ${msg}`);
        setLogs((prev) => [`${new Date().toLocaleTimeString()} - ${msg}`, ...prev].slice(0, 30));
    }

    // ─── Poll for call status then connect ────────────────────
    useEffect(() => {
        cancelledRef.current = false;

        (async () => {
            // Poll until the call is active (callee answered)
            log("Waiting for call to be answered...");
            while (!cancelledRef.current) {
                try {
                    const statusRes = await api.get("/api/call/status", {
                        params: { roomID: roomId },
                    });
                    if (statusRes?.data?.status === "active") break;
                } catch (e: any) {
                    const httpStatus = e?.response?.status;
                    if (httpStatus === 404) {
                        log("Call ended before answer");
                        handleCallEnded();
                        return;
                    }
                    if (httpStatus === 403) {
                        log("Not authorized for this call");
                        handleCallEnded();
                        return;
                    }
                }
                await new Promise((r) => setTimeout(r, 1000));
            }

            if (cancelledRef.current) return;
            setStatus("connecting");
            log("Call answered! Connecting...");
            await initCall();
        })();

        return () => {
            cancelledRef.current = true;
            cleanup();
        };
    }, []);

    // ─── Handle app going to background ───────────────────────
    useEffect(() => {
        const subscription = AppState.addEventListener("change", (nextAppState) => {
            if (nextAppState === "background" || nextAppState === "inactive") {
                // Keep connection alive but could mute camera to save battery
                if (roomRef.current?.localParticipant) {
                    roomRef.current.localParticipant.setCameraEnabled(false);
                }
            } else if (nextAppState === "active") {
                if (roomRef.current?.localParticipant) {
                    roomRef.current.localParticipant.setCameraEnabled(true);
                }
            }
        });

        return () => subscription.remove();
    }, []);

    // ─── Initialize LiveKit call ──────────────────────────────
    async function initCall() {
        try {
            // Get LiveKit token from backend
            const res = await api.post("/api/call/get-room", {
                targetUserId: null, // Server uses roomID to determine participants
            });

            const { livekitUrl, token } = res.data;
            log(`Got LiveKit token. Connecting to ${livekitUrl}...`);

            // Create room
            const newRoom = new Room({
                adaptiveStream: true,
                dynacast: true,
                videoCaptureDefaults: {
                    resolution: VideoPresets.h720.resolution,
                },
            });
            roomRef.current = newRoom;

            // Setup event listeners BEFORE connecting
            setupRoomListeners(newRoom);

            // Connect
            await newRoom.connect(livekitUrl, token);
            log("Connected to LiveKit room");

            // Enable camera and microphone
            await newRoom.localParticipant.enableCameraAndMicrophone();
            log("Camera and microphone enabled");

            // Get local video track
            const localVideoPub = newRoom.localParticipant.getTrackPublication(Track.Source.Camera);
            if (localVideoPub?.track) {
                setLocalTrack(localVideoPub.track);
                log("✅ Local video track ready");
            }

            // Check for existing remote participants
            newRoom.remoteParticipants.forEach((participant) => {
                participant.trackPublications.forEach((pub) => {
                    if (pub.track && pub.track.kind === "video") {
                        addRemoteTrack(pub.track, participant.identity);
                    }
                });
            });

            setStatus("connected");
        } catch (error: any) {
            log("Call init failed: " + error.message);
            console.error("initCall error:", error);
            Alert.alert("Connection Failed", "Could not connect to the call.", [
                { text: "Go Back", onPress: handleCallEnded },
            ]);
        }
    }

    function addRemoteTrack(track: any, identity: string) {
        setRemoteTracks((prev) => {
            // Avoid duplicates
            if (prev.find((t) => t.sid === track.sid)) return prev;
            return [
                ...prev,
                {
                    sid: track.sid,
                    videoTrack: track.kind === "video" ? track : null,
                    audioTrack: track.kind === "audio" ? track : null,
                    participantIdentity: identity,
                },
            ];
        });
    }

    function setupRoomListeners(room: Room) {
        room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
            log(`Track subscribed: ${track.kind} from ${participant.identity}`);
            if (track.kind === "video") {
                addRemoteTrack(track, participant.identity);
            }
            // Audio plays automatically via @livekit/react-native
        });

        room.on(RoomEvent.TrackUnsubscribed, (track) => {
            log(`Track unsubscribed: ${track.sid}`);
            setRemoteTracks((prev) => prev.filter((t) => t.sid !== track.sid));
        });

        room.on(RoomEvent.ParticipantDisconnected, (participant) => {
            log(`Participant left: ${participant.identity}`);
            setRemoteTracks((prev) =>
                prev.filter((t) => t.participantIdentity !== participant.identity)
            );
        });

        room.on(RoomEvent.Disconnected, () => {
            log("Disconnected from room");
            handleCallEnded();
        });
    }

    // ─── End call ─────────────────────────────────────────────
    async function handleEndCall() {
        try {
            await api.post("/api/call/end-call", { roomID: roomId });
        } catch (error) {
            console.error("End call API error:", error);
        }
        await cleanup();
        handleCallEnded();
    }

    function handleCallEnded() {
        setStatus("ended");
        setActiveCall(null);
        if (router.canGoBack()) {
            router.back();
        } else {
            router.replace("/(auth)" as Href);
        }
    }

    async function cleanup() {
        try {
            if (roomRef.current) {
                // Stop local tracks
                const localParticipant = roomRef.current.localParticipant;
                if (localParticipant) {
                    localParticipant.trackPublications.forEach((pub) => {
                        if (pub.track) {
                            pub.track.stop();
                        }
                    });
                }

                await roomRef.current.disconnect(true);
                roomRef.current = null;
            }

            setLocalTrack(null);
            setRemoteTracks([]);
            log("Cleanup complete");
        } catch (e) {
            console.error("Cleanup error:", e);
        }
    }

    // ─── Render ───────────────────────────────────────────────
    if (status === "waiting") {
        return (
            <SafeAreaView style={styles.container}>
                <View style={styles.waitingContainer}>
                    <ActivityIndicator size="large" color="#28a745" />
                    <Text style={styles.waitingText}>
                        Ringing… waiting for the other user to answer
                    </Text>
                    <TouchableOpacity
                        style={styles.cancelButton}
                        onPress={handleEndCall}
                        activeOpacity={0.8}
                    >
                        <Text style={styles.cancelButtonText}>Cancel Call</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    if (status === "connecting") {
        return (
            <SafeAreaView style={styles.container}>
                <View style={styles.waitingContainer}>
                    <ActivityIndicator size="large" color="#007bff" />
                    <Text style={styles.waitingText}>Connecting to call...</Text>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container}>
            {/* Remote Video (full screen background) */}
            <View style={styles.remoteVideoContainer}>
                {remoteTracks.length > 0 && remoteTracks[0].videoTrack ? (
                    <VideoView
                        style={styles.remoteVideo}
                        videoTrack={remoteTracks[0].videoTrack}
                        objectFit="cover"
                    />
                ) : (
                    <View style={styles.noRemoteVideo}>
                        <Text style={styles.noRemoteText}>
                            Waiting for the other participant's video...
                        </Text>
                    </View>
                )}
            </View>

            {/* Local Video (small overlay) */}
            {localTrack && (
                <View style={styles.localVideoContainer}>
                    <VideoView
                        style={styles.localVideo}
                        videoTrack={localTrack}
                        objectFit="cover"
                        mirror={true}
                    />
                </View>
            )}

            {/* End Call Button */}
            <View style={styles.controlsBar}>
                <TouchableOpacity
                    style={styles.endCallButton}
                    onPress={handleEndCall}
                    activeOpacity={0.8}
                >
                    <Text style={styles.endCallText}>❌ End Call</Text>
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#000",
    },
    waitingContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        padding: 40,
    },
    waitingText: {
        color: "#fff",
        fontSize: 18,
        marginTop: 20,
        textAlign: "center",
    },
    cancelButton: {
        marginTop: 30,
        paddingVertical: 12,
        paddingHorizontal: 30,
        backgroundColor: "#dc3545",
        borderRadius: 10,
    },
    cancelButtonText: {
        color: "#fff",
        fontSize: 16,
        fontWeight: "600",
    },

    // Remote video (full screen)
    remoteVideoContainer: {
        flex: 1,
    },
    remoteVideo: {
        flex: 1,
    },
    noRemoteVideo: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#1a1a1a",
    },
    noRemoteText: {
        color: "#aaa",
        fontSize: 16,
    },

    // Local video (picture-in-picture overlay)
    localVideoContainer: {
        position: "absolute",
        top: 60,
        right: 16,
        width: 120,
        height: 160,
        borderRadius: 12,
        overflow: "hidden",
        borderWidth: 2,
        borderColor: "#fff",
        elevation: 5,
    },
    localVideo: {
        flex: 1,
    },

    // Controls
    controlsBar: {
        position: "absolute",
        bottom: 40,
        left: 0,
        right: 0,
        alignItems: "center",
    },
    endCallButton: {
        paddingVertical: 14,
        paddingHorizontal: 40,
        backgroundColor: "#dc3545",
        borderRadius: 30,
    },
    endCallText: {
        color: "#fff",
        fontSize: 18,
        fontWeight: "700",
    },
});
