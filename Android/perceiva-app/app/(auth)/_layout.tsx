import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import { Redirect, Stack, Href } from "expo-router";

export default function AuthLayout() {
    const [loading, setLoading] = useState(true);
    const [hasToken, setHasToken] = useState(false);

    useEffect(() => {
        SecureStore.getItemAsync("token").then((token) => {
            setHasToken(!!token);
            setLoading(false);
        });
    }, []);

    if (loading) {
        return (
            <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#f4fff7" }}>
                <ActivityIndicator size="large" color="#28a745" />
            </View>
        );
    }

    if (!hasToken) {
        return <Redirect href={"/login" as Href} />;
    }

    return (
        <Stack
            screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: "#f4fff7" },
            }}
        >
            <Stack.Screen name="index" />
        </Stack>
    );
}
