import { Stack } from "expo-router";
import { CallProvider } from "../context/CallContext";

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
      </Stack>
    </CallProvider>
  );
}
