import React, { useEffect, useState } from "react";
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    Alert,
    Switch,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Picker } from "@react-native-picker/picker";
import * as SecureStore from "expo-secure-store";
import { router, Href } from "expo-router";
import { jwtDecode } from "jwt-decode";
import api from "../api/api";

type DecodedToken = {
    role: string;
    [key: string]: unknown;
};

// ─── Blind Profile Form ─────────────────────────────────────
function BlindProfileForm() {
    const [medicalConditions, setMedicalConditions] = useState("");
    const [allergies, setAllergies] = useState("");
    const [dietaryPreferences, setDietaryPreferences] = useState("");
    const [language, setLanguage] = useState("en");
    const [audioSpeed, setAudioSpeed] = useState("1.0");
    const [loading, setLoading] = useState(false);

    const handleSubmit = async () => {
        try {
            setLoading(true);
            await api.put("/api/profile", {
                medicalConditions: medicalConditions
                    .split(",")
                    .map((i) => i.trim())
                    .filter(Boolean),
                allergies: allergies
                    .split(",")
                    .map((i) => i.trim())
                    .filter(Boolean),
                dietaryPreferences: dietaryPreferences
                    .split(",")
                    .map((i) => i.trim())
                    .filter(Boolean),
                language,
                audioSpeed: Number(audioSpeed),
            });

            Alert.alert("Success", "Profile saved successfully");
            router.replace("/(auth)" as Href);
        } catch (err) {
            console.error(err);
            Alert.alert("Error", "Failed to save profile");
        } finally {
            setLoading(false);
        }
    };

    return (
        <View style={styles.card}>
            <View style={styles.header}>
                <Text style={styles.title}>Blind Profile Setup</Text>
                <Text style={styles.subtitle}>Personalize your Perceiva experience</Text>
            </View>

            <View style={styles.form}>
                <View style={styles.formGroup}>
                    <Text style={styles.label}>Medical Conditions</Text>
                    <TextInput
                        style={styles.input}
                        placeholder="e.g. Diabetes, BP"
                        placeholderTextColor="#555"
                        value={medicalConditions}
                        onChangeText={setMedicalConditions}
                    />
                </View>

                <View style={styles.formGroup}>
                    <Text style={styles.label}>Allergies</Text>
                    <TextInput
                        style={styles.input}
                        placeholder="e.g. Nuts, Milk"
                        placeholderTextColor="#555"
                        value={allergies}
                        onChangeText={setAllergies}
                    />
                </View>

                <View style={styles.formGroup}>
                    <Text style={styles.label}>Dietary Preferences</Text>
                    <TextInput
                        style={styles.input}
                        placeholder="e.g. Vegetarian, Low Sugar"
                        placeholderTextColor="#555"
                        value={dietaryPreferences}
                        onChangeText={setDietaryPreferences}
                    />
                </View>

                <View style={styles.formGroup}>
                    <Text style={styles.label}>Preferred Language</Text>
                    <View style={styles.pickerContainer}>
                        <Picker
                            selectedValue={language}
                            onValueChange={(value) => setLanguage(value)}
                            style={styles.picker}
                        >
                            <Picker.Item label="English" value="en" />
                            <Picker.Item label="Hindi" value="hi" />
                            <Picker.Item label="Malayalam" value="ml" />
                        </Picker>
                    </View>
                </View>

                <View style={styles.formGroup}>
                    <Text style={styles.label}>Audio Speed</Text>
                    <View style={styles.pickerContainer}>
                        <Picker
                            selectedValue={audioSpeed}
                            onValueChange={(value) => setAudioSpeed(value)}
                            style={styles.picker}
                        >
                            <Picker.Item label="Slow" value="0.8" />
                            <Picker.Item label="Normal" value="1.0" />
                            <Picker.Item label="Fast" value="1.2" />
                        </Picker>
                    </View>
                </View>

                <TouchableOpacity
                    style={[styles.button, loading && styles.buttonDisabled]}
                    onPress={handleSubmit}
                    disabled={loading}
                    activeOpacity={0.8}
                >
                    <Text style={styles.buttonText}>
                        {loading ? "Saving..." : "Save Blind Profile"}
                    </Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}

// ─── Volunteer Profile Form ──────────────────────────────────
function VolunteerProfileForm() {
    const [languages, setLanguages] = useState("");
    const [isAvailable, setIsAvailable] = useState(false);
    const [consentGiven, setConsentGiven] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async () => {
        if (!consentGiven) {
            Alert.alert("Consent Required", "You must give consent to continue");
            return;
        }

        try {
            setLoading(true);
            await api.put("/api/profile", {
                languages: languages
                    .split(",")
                    .map((l) => l.trim())
                    .filter(Boolean),
                isAvailable,
                consentGiven,
            });

            Alert.alert("Success", "Volunteer profile saved");
            router.replace("/(auth)" as Href);
        } catch (err) {
            console.error(err);
            Alert.alert("Error", "Failed to save profile");
        } finally {
            setLoading(false);
        }
    };

    return (
        <View style={styles.card}>
            <View style={styles.header}>
                <Text style={styles.title}>Volunteer Registration</Text>
                <Text style={styles.subtitle}>Complete your volunteer profile</Text>
            </View>

            <View style={styles.form}>
                <View style={styles.formGroup}>
                    <Text style={styles.label}>Languages Known</Text>
                    <TextInput
                        style={styles.input}
                        placeholder="English, Hindi, Malayalam"
                        placeholderTextColor="#555"
                        value={languages}
                        onChangeText={setLanguages}
                    />
                </View>

                <View style={styles.switchGroup}>
                    <Text style={styles.switchLabel}>Available for volunteer calls</Text>
                    <Switch
                        value={isAvailable}
                        onValueChange={setIsAvailable}
                        trackColor={{ false: "#ccc", true: "#28a745" }}
                        thumbColor={isAvailable ? "#fff" : "#f4f3f4"}
                    />
                </View>

                <View style={styles.switchGroup}>
                    <Text style={styles.switchLabel}>
                        I give my consent to participate as a volunteer
                    </Text>
                    <Switch
                        value={consentGiven}
                        onValueChange={setConsentGiven}
                        trackColor={{ false: "#ccc", true: "#28a745" }}
                        thumbColor={consentGiven ? "#fff" : "#f4f3f4"}
                    />
                </View>

                <TouchableOpacity
                    style={[styles.button, loading && styles.buttonDisabled]}
                    onPress={handleSubmit}
                    disabled={loading}
                    activeOpacity={0.8}
                >
                    <Text style={styles.buttonText}>
                        {loading ? "Saving..." : "Save Profile"}
                    </Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}

// ─── Main AddDetails Screen ──────────────────────────────────
export default function AddDetails() {
    const [role, setRole] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            const token = await SecureStore.getItemAsync("token");
            if (!token) {
                router.replace("/register" as Href);
                return;
            }

            try {
                const decoded = jwtDecode<DecodedToken>(token);
                setRole(decoded.role);
            } catch (error) {
                console.error("Invalid token");
                await SecureStore.deleteItemAsync("token");
                router.replace("/register" as Href);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#28a745" />
            </View>
        );
    }

    return (
        <SafeAreaView style={styles.pageContainer}>
            <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : "height"}
                style={{ flex: 1 }}
            >
                <ScrollView
                    contentContainerStyle={styles.scrollContent}
                    keyboardShouldPersistTaps="handled"
                >
                    {role === "blind" && <BlindProfileForm />}
                    {role === "volunteer" && <VolunteerProfileForm />}
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    pageContainer: {
        flex: 1,
        backgroundColor: "#f4fff7",
    },
    loadingContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#f4fff7",
    },
    scrollContent: {
        flexGrow: 1,
        justifyContent: "center",
        alignItems: "center",
        padding: 20,
    },
    card: {
        backgroundColor: "#ffffff",
        width: "100%",
        maxWidth: 450,
        padding: 30,
        borderRadius: 12,
        borderWidth: 3,
        borderColor: "#000000",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.2,
        shadowRadius: 12,
        elevation: 10,
    },
    header: {
        alignItems: "center",
        marginBottom: 30,
    },
    title: {
        fontSize: 26,
        fontWeight: "800",
        color: "#000000",
        marginBottom: 10,
        textAlign: "center",
    },
    subtitle: {
        fontSize: 16,
        fontWeight: "600",
        color: "#222222",
        textAlign: "center",
    },
    form: {
        marginBottom: 10,
    },
    formGroup: {
        marginBottom: 22,
    },
    label: {
        fontSize: 18,
        fontWeight: "700",
        color: "#000000",
        marginBottom: 8,
    },
    input: {
        width: "100%",
        paddingVertical: 14,
        paddingHorizontal: 14,
        fontSize: 18,
        borderRadius: 8,
        borderWidth: 2,
        borderColor: "#555555",
        backgroundColor: "#ffffff",
        color: "#000000",
    },
    pickerContainer: {
        borderWidth: 2,
        borderColor: "#555555",
        borderRadius: 8,
        overflow: "hidden",
        backgroundColor: "#ffffff",
    },
    picker: {
        width: "100%",
        height: 50,
        color: "#000000",
    },
    switchGroup: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 22,
        paddingVertical: 8,
    },
    switchLabel: {
        fontSize: 16,
        fontWeight: "600",
        color: "#000000",
        flex: 1,
        paddingRight: 12,
    },
    button: {
        width: "100%",
        paddingVertical: 16,
        borderRadius: 8,
        borderWidth: 3,
        borderColor: "#000000",
        backgroundColor: "#000000",
        alignItems: "center",
        marginTop: 15,
    },
    buttonDisabled: {
        backgroundColor: "#666",
        borderColor: "#666",
    },
    buttonText: {
        fontSize: 20,
        fontWeight: "700",
        color: "#ffffff",
    },
});
