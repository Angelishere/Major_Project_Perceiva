import React, { createContext, useContext, useState, useEffect } from "react";
import * as SecureStore from "expo-secure-store";
import api from "../api/api";

type CallUser = {
    _id?: string;
    id?: string;
    username?: string;
    email?: string;
};

type IncomingCall = {
    roomID: string;
    caller: CallUser;
};

type ActiveCall = {
    user: CallUser;
    roomID: string;
} | null;

type CallContextType = {
    incomingCalls: IncomingCall[];
    activeCall: ActiveCall;
    setActiveCall: React.Dispatch<React.SetStateAction<ActiveCall>>;
};

const CallContext = createContext<CallContextType>({
    incomingCalls: [],
    activeCall: null,
    setActiveCall: () => { },
});

export function useCall() {
    return useContext(CallContext);
}

export function CallProvider({ children }: { children: React.ReactNode }) {
    const [incomingCalls, setIncomingCalls] = useState<IncomingCall[]>([]);
    const [activeCall, setActiveCall] = useState<ActiveCall>(null);

    // Poll for incoming calls every 3 seconds
    useEffect(() => {
        const interval = setInterval(async () => {
            try {
                const token = await SecureStore.getItemAsync("token");
                if (!token) return;

                const res = await api.get("/api/call/check-calls");
                setIncomingCalls(res.data.incomingCalls || []);
            } catch (error) {
                console.error("Failed to check calls:", error);
            }
        }, 3000);

        return () => clearInterval(interval);
    }, []);

    const value: CallContextType = {
        incomingCalls,
        activeCall,
        setActiveCall,
    };

    return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}
