import { Link, useNavigate } from "react-router-dom";

export default function Navbar() {
  const navigate = useNavigate();

  function handleLogout() {
    try {
      // Remove auth tokens (support both keys just in case)
      localStorage.removeItem("token");
      localStorage.removeItem("authToken");
      // Redirect to login
      navigate("/login", { replace: true });
    } catch (e) {
      // Fallback redirect
      window.location.href = "/login";
    }
  }

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "10px 16px",
      borderBottom: "1px solid #eee",
      background: "#fff"
    }}>
      <h2 style={{ margin: 0 }}>Perceiva - Allergy Safety System</h2>

      <div style={{ display: "flex", gap: 12 }}>
        <Link to="/login" style={{ textDecoration: "none", fontWeight: 600 }}>Login</Link>
        <button onClick={handleLogout} style={{ padding: "6px 12px", cursor: "pointer" }}>Logout</button>
      </div>
    </div>
  );
}
