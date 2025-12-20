import React, { useState, useEffect } from "react";
import api from "../api/api";

export default function UserListCard({ onCallUser }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUsers();
  }, []);

  async function fetchUsers() {
    try {
      const res = await api.get("/api/call/users", {
        headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
      });
      setUsers(res.data.users || []);
    } catch (error) {
      console.error("Failed to fetch users:", error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div style={{ padding: 20 }}>Loading users...</div>;
  }

  return (
    <div style={{ padding: 20 }}>
      <h3>Available Users</h3>
      {users.length === 0 && <p>No other users available</p>}
      
      <div style={{ display: "grid", gap: 12 }}>
        {users.map((user) => (
          <div
            key={user._id}
            style={{
              padding: 12,
              background: "#f8f9fa",
              borderRadius: 8,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>{user.username}</div>
              <div style={{ fontSize: 13, color: "#666" }}>{user.email}</div>
            </div>
            <button
              onClick={() => onCallUser(user)}
              style={{
                padding: "8px 16px",
                background: "#28a745",
                color: "white",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              📞 Call
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}