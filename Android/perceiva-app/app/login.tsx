import React, { useEffect, useState } from "react";
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import * as SecureStore from "expo-secure-store";
import { router, Link, Href } from "expo-router";
import api from "../api/api";

export default function Login() {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);

    // If already logged in, redirect to home
    useEffect(() => {
        SecureStore.getItemAsync("token").then((token) => {
            if (token) {
                router.replace("/(auth)" as Href);
            }
        });
    }, []);

    const handleLogin = async () => {
        if (!username.trim() || !password.trim()) {
            Alert.alert("Error", "Please enter both username and password");
            return;
        }

        try {
            setLoading(true);
            const res = await api.post("/login", { username, password });
            await SecureStore.setItemAsync("token", res.data.token);
            console.log("Login Successful");
            router.replace("/(auth)" as Href);
        } catch (error) {
            console.log(error);
            Alert.alert("Login Failed", "Invalid credentials. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <LinearGradient colors={["#667eea", "#764ba2"]} style={styles.gradient}>
            <SafeAreaView style={styles.container}>
                <KeyboardAvoidingView
                    behavior={Platform.OS === "ios" ? "padding" : "height"}
                    style={styles.container}
                >
                    <ScrollView
                        contentContainerStyle={styles.scrollContent}
                        keyboardShouldPersistTaps="handled"
                    >
                        <View style={styles.card}>
                            {/* Header */}
                            <View style={styles.header}>
                                <Text style={styles.title}>Login</Text>
                                <Text style={styles.subtitle}>Sign in to your account</Text>
                            </View>

                            {/* Form */}
                            <View style={styles.form}>
                                <View style={styles.formGroup}>
                                    <Text style={styles.label}>Email or Username</Text>
                                    <TextInput
                                        style={styles.input}
                                        placeholder="Enter your email or username"
                                        placeholderTextColor="#a0aec0"
                                        value={username}
                                        onChangeText={setUsername}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                    />
                                </View>

                                <View style={styles.formGroup}>
                                    <Text style={styles.label}>Password</Text>
                                    <TextInput
                                        style={styles.input}
                                        placeholder="Enter your password"
                                        placeholderTextColor="#a0aec0"
                                        value={password}
                                        onChangeText={setPassword}
                                        secureTextEntry
                                        autoCapitalize="none"
                                    />
                                </View>

                                <TouchableOpacity
                                    style={[styles.button, loading && styles.buttonDisabled]}
                                    onPress={handleLogin}
                                    disabled={loading}
                                    activeOpacity={0.8}
                                >
                                    <LinearGradient
                                        colors={["#667eea", "#764ba2"]}
                                        style={styles.buttonGradient}
                                    >
                                        <Text style={styles.buttonText}>
                                            {loading ? "Signing in..." : "Login"}
                                        </Text>
                                    </LinearGradient>
                                </TouchableOpacity>
                            </View>

                            {/* Footer */}
                            <View style={styles.footer}>
                                <Text style={styles.footerText}>
                                    Don't have an account?{" "}
                                    <Link href={"/register" as Href} style={styles.footerLink}>
                                        Register
                                    </Link>
                                </Text>
                            </View>
                        </View>
                    </ScrollView>
                </KeyboardAvoidingView>
            </SafeAreaView>
        </LinearGradient>
    );
}

const styles = StyleSheet.create({
    gradient: {
        flex: 1,
    },
    container: {
        flex: 1,
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
        maxWidth: 420,
        padding: 30,
        borderRadius: 18,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.22,
        shadowRadius: 22,
        elevation: 12,
    },
    header: {
        alignItems: "center",
        marginBottom: 25,
    },
    title: {
        fontSize: 30,
        fontWeight: "700",
        color: "#2d3748",
        marginBottom: 6,
    },
    subtitle: {
        fontSize: 15,
        color: "#718096",
    },
    form: {
        marginBottom: 20,
    },
    formGroup: {
        marginBottom: 18,
    },
    label: {
        fontSize: 15,
        fontWeight: "600",
        color: "#2d3748",
        marginBottom: 6,
    },
    input: {
        width: "100%",
        paddingVertical: 12,
        paddingHorizontal: 14,
        fontSize: 16,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: "#cbd5e0",
        backgroundColor: "#fff",
        color: "#2d3748",
    },
    button: {
        marginTop: 10,
        borderRadius: 12,
        overflow: "hidden",
    },
    buttonDisabled: {
        opacity: 0.7,
    },
    buttonGradient: {
        paddingVertical: 14,
        alignItems: "center",
        borderRadius: 12,
    },
    buttonText: {
        fontSize: 18,
        fontWeight: "600",
        color: "#ffffff",
    },
    footer: {
        alignItems: "center",
        marginTop: 15,
    },
    footerText: {
        fontSize: 14,
        color: "#4a5568",
    },
    footerLink: {
        color: "#667eea",
        fontWeight: "600",
    },
});
