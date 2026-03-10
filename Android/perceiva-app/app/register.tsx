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
import { Picker } from "@react-native-picker/picker";
import * as SecureStore from "expo-secure-store";
import { router, Link, Href } from "expo-router";
import axios from "axios";

export default function Register() {
    const [name, setName] = useState("");
    const [username, setUsername] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [role, setRole] = useState("blind");
    const [loading, setLoading] = useState(false);

    // If already logged in, redirect to home
    useEffect(() => {
        SecureStore.getItemAsync("token").then((token) => {
            if (token) {
                router.replace("/(auth)" as Href);
            }
        });
    }, []);

    const handleSubmit = async () => {
        if (!name.trim() || !username.trim() || !email.trim() || !password.trim()) {
            Alert.alert("Error", "Please fill in all fields");
            return;
        }

        try {
            setLoading(true);
            const res = await axios.post(
                "https://major-project-perceiva.onrender.com/register",
                { name, email, password, username, role },
                { headers: { "Content-Type": "application/json" } }
            );

            if (res.data.message === "User registered successfully") {
                await SecureStore.setItemAsync("token", res.data.token);
                router.replace("/addDetails" as Href);
            }
        } catch (error) {
            console.log(error);
            Alert.alert(
                "Registration Failed",
                "Could not create account. Please try again."
            );
        } finally {
            setLoading(false);
        }
    };

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
                    <View style={styles.card}>
                        {/* Header */}
                        <View style={styles.header}>
                            <Text style={styles.title}>Register</Text>
                            <Text style={styles.subtitle}>Create your account</Text>
                        </View>

                        {/* Form */}
                        <View style={styles.form}>
                            <View style={styles.formGroup}>
                                <Text style={styles.label}>Full Name</Text>
                                <TextInput
                                    style={styles.input}
                                    placeholder="Enter your full name"
                                    placeholderTextColor="#555"
                                    value={name}
                                    onChangeText={setName}
                                    autoCapitalize="words"
                                />
                            </View>

                            <View style={styles.formGroup}>
                                <Text style={styles.label}>User Name</Text>
                                <TextInput
                                    style={styles.input}
                                    placeholder="Enter your user name"
                                    placeholderTextColor="#555"
                                    value={username}
                                    onChangeText={setUsername}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                />
                            </View>

                            <View style={styles.formGroup}>
                                <Text style={styles.label}>Email Address</Text>
                                <TextInput
                                    style={styles.input}
                                    placeholder="Enter your email"
                                    placeholderTextColor="#555"
                                    value={email}
                                    onChangeText={setEmail}
                                    keyboardType="email-address"
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                />
                            </View>

                            <View style={styles.formGroup}>
                                <Text style={styles.label}>Password</Text>
                                <TextInput
                                    style={styles.input}
                                    placeholder="Create a password"
                                    placeholderTextColor="#555"
                                    value={password}
                                    onChangeText={setPassword}
                                    secureTextEntry
                                    autoCapitalize="none"
                                />
                            </View>

                            <View style={styles.formGroup}>
                                <Text style={styles.label}>User Type</Text>
                                <View style={styles.pickerContainer}>
                                    <Picker
                                        selectedValue={role}
                                        onValueChange={(value) => setRole(value)}
                                        style={styles.picker}
                                    >
                                        <Picker.Item label="Blind" value="blind" />
                                        <Picker.Item label="Volunteer" value="volunteer" />
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
                                    {loading ? "Creating Account..." : "Register"}
                                </Text>
                            </TouchableOpacity>
                        </View>

                        {/* Footer */}
                        <View style={styles.footer}>
                            <Text style={styles.footerText}>
                                Already have an account?{" "}
                                <Link href={"/login" as Href} style={styles.footerLink}>
                                    Login
                                </Link>
                            </Text>
                        </View>
                    </View>
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
        fontSize: 32,
        fontWeight: "800",
        color: "#000000",
        marginBottom: 10,
    },
    subtitle: {
        fontSize: 18,
        fontWeight: "600",
        color: "#222222",
    },
    form: {
        marginBottom: 25,
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
    footer: {
        alignItems: "center",
        marginTop: 25,
    },
    footerText: {
        fontSize: 16,
        color: "#000000",
    },
    footerLink: {
        color: "#004d40",
        fontWeight: "700",
        textDecorationLine: "underline",
    },
});
