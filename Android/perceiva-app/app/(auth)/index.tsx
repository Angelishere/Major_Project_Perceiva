import React, { useEffect, useState } from "react";
import {
    View,
    Text,
    TouchableOpacity,
    Alert,
    StyleSheet,
    ActivityIndicator,
    ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import * as SecureStore from "expo-secure-store";
import { router, Href } from "expo-router";
import { jwtDecode } from "jwt-decode";
import { useCall } from "../../context/CallContext";
import IncomingCallModal from "../../components/IncomingCallModal";
import api from "../../api/api";

type DecodedToken = {
    role: string;
    [key: string]: unknown;
};

// ─── Navbar ──────────────────────────────────────────────────
function AppHeader({ onLogout }: { onLogout: () => void }) {
    return (
        <View style={styles.navbar}>
            <Text style={styles.navTitle}>Perceiva Glasses</Text>
            <TouchableOpacity
                style={styles.logoutButton}
                onPress={onLogout}
                activeOpacity={0.7}
            >
                <Text style={styles.logoutText}>Logout</Text>
            </TouchableOpacity>
        </View>
    );
}

// ─── Blind Home ──────────────────────────────────────────────
function BlindHome() {
    const { incomingCalls, activeCall, setActiveCall } = useCall();
    const [calling, setCalling] = useState(false);

    async function handleCallVolunteer() {
        try {
            setCalling(true);
            const token = await SecureStore.getItemAsync("token");
            if (!token) {
                Alert.alert("Error", "Not authenticated");
                setCalling(false);
                return;
            }

            const res = await api.post("/api/call/request-volunteer", {});
            const { volunteer, roomID } = res.data;

            setActiveCall({ user: volunteer, roomID });

            // Video call is deferred — show placeholder
            Alert.alert(
                "Call Connected",
                `Connected to ${volunteer?.username || "volunteer"}.\n\nVideo calls are coming soon in the next update.`,
                [
                    {
                        text: "End Call",
                        onPress: async () => {
                            try {
                                await api.post("/api/call/end-call", { roomID });
                            } catch (e) {
                                console.error("Failed to end call:", e);
                            }
                            setActiveCall(null);
                            setCalling(false);
                        },
                    },
                ]
            );
        } catch (error: any) {
            console.error("Failed to request volunteer:", error);
            Alert.alert(
                "Connection Failed",
                error.response?.data?.message || "Failed to connect with volunteer"
            );
            setCalling(false);
        }
    }

    async function handleAnswerCall(call: any) {
        try {
            await api.post("/api/call/answer-call", { roomID: call.roomID });
            setActiveCall({ user: call.caller, roomID: call.roomID });

            Alert.alert(
                "Call Answered",
                "Video calls are coming soon in the next update.",
                [
                    {
                        text: "End Call",
                        onPress: async () => {
                            try {
                                await api.post("/api/call/end-call", { roomID: call.roomID });
                            } catch (e) {
                                console.error(e);
                            }
                            setActiveCall(null);
                        },
                    },
                ]
            );
        } catch (error) {
            console.error("Failed to answer call:", error);
        }
    }

    async function handleRejectCall(call: any) {
        try {
            await api.post("/api/call/end-call", { roomID: call.roomID });
        } catch (error) {
            console.error("Failed to reject call:", error);
        }
    }

    const currentIncomingCall = incomingCalls[0];

    return (
        <View style={styles.homeContent}>
            <Text style={styles.welcomeTitle}>Welcome</Text>
            <Text style={styles.welcomeSubtitle}>
                Press the button below to connect with an available volunteer
            </Text>

            <TouchableOpacity
                style={[
                    styles.callButton,
                    (calling || activeCall) && styles.callButtonDisabled,
                ]}
                onPress={handleCallVolunteer}
                disabled={calling || !!activeCall}
                activeOpacity={0.8}
            >
                <Text style={styles.callButtonText}>
                    {calling ? "⏳ Connecting..." : "📞 Call a Volunteer"}
                </Text>
            </TouchableOpacity>

            <TouchableOpacity
                style={styles.connectGlassesButton}
                onPress={() => Alert.alert("Connect Glasses", "Glasses connection coming soon.")}
                activeOpacity={0.8}
            >
                <Text style={styles.connectGlassesText}>🕶️ Connect Glasses</Text>
            </TouchableOpacity>

            <IncomingCallModal
                call={currentIncomingCall}
                onAnswer={handleAnswerCall}
                onReject={handleRejectCall}
            />
        </View>
    );
}

// ─── Volunteer Home ──────────────────────────────────────────
function VolunteerHome() {
    const { incomingCalls, activeCall, setActiveCall } = useCall();
    const [isAvailable, setIsAvailable] = useState(false);
    const [toggling, setToggling] = useState(false);
    const [loadingProfile, setLoadingProfile] = useState(true);

    // Fetch availability on mount
    useEffect(() => {
        (async () => {
            try {
                const res = await api.get("/api/profile");
                setIsAvailable(res.data.isAvailable || false);
            } catch (error) {
                console.error("Failed to fetch profile:", error);
            } finally {
                setLoadingProfile(false);
            }
        })();
    }, []);

    async function handleToggleAvailability() {
        try {
            setToggling(true);
            const newAvailability = !isAvailable;
            const res = await api.put("/api/profile", {
                isAvailable: newAvailability,
            });
            setIsAvailable(res.data.isAvailable);
        } catch (error) {
            console.error("Failed to update availability:", error);
            Alert.alert("Error", "Failed to update availability. Please try again.");
        } finally {
            setToggling(false);
        }
    }

    async function handleAnswerCall(call: any) {
        try {
            await api.post("/api/call/answer-call", { roomID: call.roomID });
            const callerUser = {
                ...call.caller,
                _id: call.caller.id || call.caller._id,
            };
            setActiveCall({ user: callerUser, roomID: call.roomID });

            Alert.alert(
                "Call Answered",
                `Connected to ${callerUser?.username || "user"}.\n\nVideo calls are coming soon in the next update.`,
                [
                    {
                        text: "End Call",
                        onPress: async () => {
                            try {
                                await api.post("/api/call/end-call", { roomID: call.roomID });
                            } catch (e) {
                                console.error(e);
                            }
                            setActiveCall(null);
                        },
                    },
                ]
            );
        } catch (error) {
            console.error("Failed to answer call:", error);
        }
    }

    async function handleRejectCall(call: any) {
        try {
            await api.post("/api/call/end-call", { roomID: call.roomID });
        } catch (error) {
            console.error("Failed to reject call:", error);
        }
    }

    const currentIncomingCall = incomingCalls[0];

    if (loadingProfile) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#28a745" />
            </View>
        );
    }

    return (
        <View style={styles.homeContent}>
            <Text style={styles.welcomeTitle}>Volunteer Dashboard</Text>
            <Text style={styles.welcomeSubtitle}>
                Keep the app open to receive calls from blind users.
            </Text>

            {/* Availability Toggle */}
            <View
                style={[
                    styles.availabilityCard,
                    isAvailable
                        ? styles.availabilityAvailable
                        : styles.availabilityUnavailable,
                ]}
            >
                <View style={styles.availabilityInfo}>
                    <Text
                        style={[
                            styles.availabilityTitle,
                            { color: isAvailable ? "#155724" : "#721c24" },
                        ]}
                    >
                        {isAvailable ? "✅ You are Available" : "❌ You are Unavailable"}
                    </Text>
                    <Text
                        style={[
                            styles.availabilityDesc,
                            { color: isAvailable ? "#155724" : "#721c24" },
                        ]}
                    >
                        {isAvailable
                            ? "You will receive calls from blind users"
                            : "Blind users cannot call you"}
                    </Text>
                </View>

                <TouchableOpacity
                    style={[
                        styles.toggleButton,
                        {
                            backgroundColor: isAvailable ? "#dc3545" : "#28a745",
                            opacity: toggling ? 0.6 : 1,
                        },
                    ]}
                    onPress={handleToggleAvailability}
                    disabled={toggling}
                    activeOpacity={0.7}
                >
                    <Text style={styles.toggleButtonText}>
                        {toggling
                            ? "Updating..."
                            : isAvailable
                                ? "Go Unavailable"
                                : "Go Available"}
                    </Text>
                </TouchableOpacity>
            </View>

            {/* Incoming calls or waiting */}
            {currentIncomingCall ? (
                <IncomingCallModal
                    call={currentIncomingCall}
                    onAnswer={handleAnswerCall}
                    onReject={handleRejectCall}
                />
            ) : (
                <View style={styles.waitingCard}>
                    <Text style={styles.waitingText}>
                        <Text style={{ fontWeight: "700" }}>No incoming calls.</Text>{" "}
                        Waiting for blind users to connect...
                    </Text>
                </View>
            )}
        </View>
    );
}

// ─── Main Home Screen ────────────────────────────────────────
export default function HomeScreen() {
    const [role, setRole] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            const token = await SecureStore.getItemAsync("token");
            if (!token) {
                router.replace("/login" as Href);
                return;
            }

            try {
                const decoded = jwtDecode<DecodedToken>(token);
                setRole(decoded.role);
            } catch (error) {
                console.error("Invalid token");
                await SecureStore.deleteItemAsync("token");
                router.replace("/login" as Href);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    async function handleLogout() {
        await SecureStore.deleteItemAsync("token");
        router.replace("/login" as Href);
    }

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#28a745" />
            </View>
        );
    }

    return (
        <SafeAreaView style={styles.safeArea}>
            <AppHeader onLogout={handleLogout} />
            <ScrollView contentContainerStyle={styles.scrollContent}>
                {role === "blind" && <BlindHome />}
                {role === "volunteer" && <VolunteerHome />}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: "#fff",
    },
    loadingContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#f4fff7",
    },
    scrollContent: {
        flexGrow: 1,
    },

    // ── Navbar ──
    navbar: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: "#eee",
        backgroundColor: "#fff",
    },
    navTitle: {
        fontSize: 20,
        fontWeight: "700",
        color: "#1a1a1a",
    },
    logoutButton: {
        paddingVertical: 6,
        paddingHorizontal: 14,
        backgroundColor: "#f0f0f0",
        borderRadius: 6,
    },
    logoutText: {
        fontSize: 14,
        fontWeight: "600",
        color: "#333",
    },

    // ── Home Content ──
    homeContent: {
        padding: 32,
        alignItems: "center",
    },
    welcomeTitle: {
        fontSize: 26,
        fontWeight: "700",
        color: "#1a1a1a",
        marginBottom: 12,
        textAlign: "center",
    },
    welcomeSubtitle: {
        fontSize: 16,
        color: "#666",
        marginBottom: 30,
        textAlign: "center",
        lineHeight: 22,
    },

    // ── Call Button (Blind) ──
    callButton: {
        paddingVertical: 16,
        paddingHorizontal: 40,
        backgroundColor: "#28a745",
        borderRadius: 12,
    },
    callButtonDisabled: {
        backgroundColor: "#ccc",
    },
    callButtonText: {
        fontSize: 20,
        fontWeight: "700",
        color: "#fff",
    },
    connectGlassesButton: {
        marginTop: 16,
        paddingVertical: 16,
        paddingHorizontal: 40,
        backgroundColor: "#17a2b8",
        borderRadius: 12,
    },
    connectGlassesText: {
        fontSize: 20,
        fontWeight: "700",
        color: "#fff",
    },

    // ── Availability Card (Volunteer) ──
    availabilityCard: {
        width: "100%",
        padding: 16,
        borderWidth: 2,
        borderRadius: 10,
        marginBottom: 24,
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },
    availabilityAvailable: {
        backgroundColor: "#d4edda",
        borderColor: "#28a745",
    },
    availabilityUnavailable: {
        backgroundColor: "#f8d7da",
        borderColor: "#dc3545",
    },
    availabilityInfo: {
        flex: 1,
        paddingRight: 12,
    },
    availabilityTitle: {
        fontSize: 16,
        fontWeight: "700",
    },
    availabilityDesc: {
        fontSize: 14,
        marginTop: 6,
    },
    toggleButton: {
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 6,
    },
    toggleButtonText: {
        color: "#fff",
        fontSize: 14,
        fontWeight: "600",
    },

    // ── Waiting Card ──
    waitingCard: {
        width: "100%",
        padding: 16,
        backgroundColor: "#f8f9fa",
        borderRadius: 8,
    },
    waitingText: {
        fontSize: 15,
        color: "#333",
    },
});
