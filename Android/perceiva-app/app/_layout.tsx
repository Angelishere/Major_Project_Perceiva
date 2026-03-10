import { registerGlobals } from "@livekit/react-native";
import { Stack } from "expo-router";
import { CallProvider } from "../context/CallContext";

// Must be called before any LiveKit usage
registerGlobals();

export default function RootLayout() {
    return (
        <CallProvider>
            <Stack
                screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: "#f4fff7" },
                }}
            >
                <Stack.Screen name="index" />
                <Stack.Screen name="login" />
                <Stack.Screen name="register" />
                <Stack.Screen name="addDetails" />
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="call/[roomId]" options={{ gestureEnabled: false }} />
            </Stack>
        </CallProvider>
    );
}
