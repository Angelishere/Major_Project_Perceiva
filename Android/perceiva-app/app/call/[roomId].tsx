import React, { useEffect, useState, useRef } from "react";
import {
    View,
    Text,
    TouchableOpacity,
    Alert,
    StyleSheet,
    ActivityIndicator,
    AppState,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, router, Href } from "expo-router";
import {
    Room,
    RoomEvent,
    Track,
    VideoPresets,
} from "livekit-client";
import { VideoView, AudioSession } from "@livekit/react-native";
import api from "../../api/api";
import { useCall } from "../../context/CallContext";

type TrackInfo = {
    sid: string;
    videoTrack: any;
    audioTrack: any;
    participantIdentity: string;
};

export default function CallScreen() {
    const { roomId, targetUserId } = useLocalSearchParams<{ roomId: string; targetUserId: string }>();
    const { setActiveCall } = useCall();

    const [status, setStatus] = useState<"waiting" | "connecting" | "connected" | "ended">("waiting");
    const [localTrack, setLocalTrack] = useState<any>(null);
    const [remoteTracks, setRemoteTracks] = useState<TrackInfo[]>([]);
    const [muted, setMuted] = useState(false);

    const roomRef = useRef<Room | null>(null);
    const cancelledRef = useRef(false);

    function log(msg: string) {
        console.log(`[Call] ${msg}`);
    }

    useEffect(() => {
        cancelledRef.current = false;

        (async () => {
            log("Waiting for call to be answered...");
            while (!cancelledRef.current) {
                try {
                    const statusRes = await api.get("/api/call/status", {
                        params: { roomID: roomId },
                    });
                    if (statusRes?.data?.status === "active") break;
                } catch (e: any) {
                    const httpStatus = e?.response?.status;
                    if (httpStatus === 404 || httpStatus === 403) {
                        handleCallEnded();
                        return;
                    }
                }
                await new Promise((r) => setTimeout(r, 1000));
            }

            if (cancelledRef.current) return;
            setStatus("connecting");
            await initCall();
        })();

        return () => {
            cancelledRef.current = true;
            cleanup();
        };
    }, []);

    useEffect(() => {
        const subscription = AppState.addEventListener("change", (nextAppState) => {
            if (nextAppState === "background" || nextAppState === "inactive") {
                roomRef.current?.localParticipant?.setCameraEnabled(false);
            } else if (nextAppState === "active") {
                roomRef.current?.localParticipant?.setCameraEnabled(true);
            }
        });

        return () => subscription.remove();
    }, []);

    async function initCall() {
        try {
            await AudioSession.configureAudio({
                android: {
                    preferredOutputList: ["speaker"],
                    audioTypeOptions: {
                        manageAudioFocus: true,
                        audioMode: "inCommunication",
                    },
                },
            });
            await AudioSession.startAudioSession();

            const res = await api.post("/api/call/get-room", {
                targetUserId: targetUserId,
            });

            const { livekitUrl, token } = res.data;

            const newRoom = new Room({
                adaptiveStream: true,
                dynacast: true,
                videoCaptureDefaults: {
                    resolution: VideoPresets.h720.resolution,
                },
            });

            roomRef.current = newRoom;

            setupRoomListeners(newRoom);

            await newRoom.connect(livekitUrl, token);

            await newRoom.localParticipant.enableCameraAndMicrophone();

            const localVideoPub = newRoom.localParticipant.getTrackPublication(Track.Source.Camera);
            if (localVideoPub?.track) {
                setLocalTrack(localVideoPub.track);
            }

            newRoom.remoteParticipants.forEach((participant) => {
                participant.trackPublications.forEach((pub) => {
                    if (pub.track && pub.track.kind === "video") {
                        addRemoteTrack(pub.track, participant.identity);
                    }
                });
            });

            setStatus("connected");
        } catch (error: any) {
            Alert.alert("Connection Failed", "Could not connect to the call.", [
                { text: "Go Back", onPress: handleCallEnded },
            ]);
        }
    }

    function addRemoteTrack(track: any, identity: string) {
        setRemoteTracks((prev) => {
            if (prev.find((t) => t.sid === track.sid)) return prev;
            return [
                ...prev,
                {
                    sid: track.sid,
                    videoTrack: track,
                    audioTrack: null,
                    participantIdentity: identity,
                },
            ];
        });
    }

    function setupRoomListeners(room: Room) {
        room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
            if (track.kind === "video") {
                addRemoteTrack(track, participant.identity);
            }
        });

        room.on(RoomEvent.TrackUnsubscribed, (track) => {
            setRemoteTracks((prev) => prev.filter((t) => t.sid !== track.sid));
        });

        room.on(RoomEvent.ParticipantDisconnected, (participant) => {
            setRemoteTracks((prev) =>
                prev.filter((t) => t.participantIdentity !== participant.identity)
            );
        });

        room.on(RoomEvent.Disconnected, () => {
            handleCallEnded();
        });
    }

    async function handleEndCall() {
        try {
            await api.post("/api/call/end-call", { roomID: roomId });
        } catch { }

        await cleanup();
        handleCallEnded();
    }

    function handleCallEnded() {
        setStatus("ended");
        setActiveCall(null);

        if (router.canGoBack()) router.back();
        else router.replace("/(auth)" as Href);
    }

    async function cleanup() {
        try {
            if (roomRef.current) {
                const localParticipant = roomRef.current.localParticipant;
                if (localParticipant) {
                    localParticipant.trackPublications.forEach((pub) => {
                        pub.track?.stop();
                    });
                }

                await roomRef.current.disconnect(true);
                roomRef.current = null;
            }

            setLocalTrack(null);
            setRemoteTracks([]);
        } catch { }
    }

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
            <View style={styles.remoteVideoContainer}>
                {remoteTracks.length > 0 && remoteTracks[0].videoTrack ? (
                    <VideoView
                        style={styles.remoteVideo}
                        videoTrack={remoteTracks[0].videoTrack}
                        objectFit="contain"
                    />
                ) : (
                    <View style={styles.noRemoteVideo}>
                        <Text style={styles.noRemoteText}>
                            Waiting for the other participant's video...
                        </Text>
                    </View>
                )}
            </View>

            <View style={styles.controlsBar}>
                <TouchableOpacity
                    style={[styles.muteButton, muted && styles.muteButtonActive]}
                    onPress={() => {
                        const newMuted = !muted;
                        setMuted(newMuted);
                        roomRef.current?.localParticipant?.setMicrophoneEnabled(!newMuted);
                    }}
                >
                    <Text style={styles.muteText}>{muted ? "🔇 Unmute" : "🎙️ Mute"}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.endCallButton}
                    onPress={handleEndCall}
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

    controlsBar: {
        position: "absolute",
        bottom: 40,
        left: 0,
        right: 0,
        flexDirection: "row",
        justifyContent: "center",
        alignItems: "center",
        gap: 16,
    },

    muteButton: {
        paddingVertical: 14,
        paddingHorizontal: 24,
        backgroundColor: "#555",
        borderRadius: 30,
    },

    muteButtonActive: {
        backgroundColor: "#ffc107",
    },

    muteText: {
        color: "#fff",
        fontSize: 16,
        fontWeight: "700",
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