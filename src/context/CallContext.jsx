import React, { createContext, useContext, useState, useEffect } from "react";
import api from "../api/api";

const CallContext = createContext();

export function useCall() {
  return useContext(CallContext);
}

export function CallProvider({ children }) {
  const [incomingCalls, setIncomingCalls] = useState([]);
  const [activeCall, setActiveCall] = useState(null);

  // Poll for incoming calls every 3 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const token = localStorage.getItem("token");
        if (!token) return;

        const res = await api.get("/api/call/check-calls", {
          headers: { Authorization: `Bearer ${token}` },
        });

        setIncomingCalls(res.data.incomingCalls || []);
      } catch (error) {
        console.error("Failed to check calls:", error);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  const value = {
    incomingCalls,
    activeCall,
    setActiveCall,
  };

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}