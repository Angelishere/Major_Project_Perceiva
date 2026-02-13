import { Link, useNavigate, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";

export default function Navbar() {
  const navigate = useNavigate();
  const location = useLocation(); // Triggers re-render on route change
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    // Check for token whenever location changes or component mounts
    const token = localStorage.getItem("token");
    setHasToken(!!token);
  }, [location]);

  function handleLogout() {
    try {
      // Remove auth tokens (support both keys just in case)
      localStorage.removeItem("token");
      localStorage.removeItem("authToken");
      setHasToken(false);
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
      <h2 style={{ margin: 0 }}>Perceiva Glasses</h2>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {!hasToken && (
          <Link to="/login" style={{ textDecoration: "none", fontWeight: 600 }}>Login</Link>
        )}
        {hasToken && (
          <button onClick={handleLogout} style={{ padding: "6px 12px", cursor: "pointer", marginTop: 0, width: "auto" }}>Logout</button>
        )}
      </div>
    </div>
  );
}
