import React from "react";
import {
    Modal,
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
} from "react-native";

type CallUser = {
    _id?: string;
    id?: string;
    username?: string;
};

type IncomingCall = {
    roomID: string;
    caller: CallUser;
};

type Props = {
    call: IncomingCall | undefined;
    onAnswer: (call: IncomingCall) => void;
    onReject: (call: IncomingCall) => void;
};

export default function IncomingCallModal({ call, onAnswer, onReject }: Props) {
    if (!call) return null;

    return (
        <Modal transparent animationType="fade" visible={!!call}>
            <View style={styles.overlay}>
                <View style={styles.card}>
                    <Text style={styles.icon}>📞</Text>
                    <Text style={styles.title}>Incoming Call</Text>
                    <Text style={styles.callerName}>
                        {call.caller?.username || "Unknown"} is calling...
                    </Text>

                    <View style={styles.buttonRow}>
                        <TouchableOpacity
                            style={[styles.button, styles.answerButton]}
                            onPress={() => onAnswer(call)}
                            activeOpacity={0.8}
                        >
                            <Text style={styles.buttonText}>✅ Answer</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.button, styles.rejectButton]}
                            onPress={() => onReject(call)}
                            activeOpacity={0.8}
                        >
                            <Text style={styles.buttonText}>❌ Reject</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.7)",
        justifyContent: "center",
        alignItems: "center",
    },
    card: {
        backgroundColor: "#ffffff",
        borderRadius: 16,
        padding: 30,
        width: "85%",
        maxWidth: 400,
        alignItems: "center",
    },
    icon: {
        fontSize: 48,
        marginBottom: 16,
    },
    title: {
        fontSize: 22,
        fontWeight: "700",
        color: "#1a1a1a",
        marginBottom: 8,
    },
    callerName: {
        fontSize: 18,
        color: "#333",
        marginBottom: 24,
    },
    buttonRow: {
        flexDirection: "row",
        gap: 12,
    },
    button: {
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 10,
    },
    answerButton: {
        backgroundColor: "#28a745",
    },
    rejectButton: {
        backgroundColor: "#dc3545",
    },
    buttonText: {
        color: "#ffffff",
        fontSize: 16,
        fontWeight: "600",
    },
});
