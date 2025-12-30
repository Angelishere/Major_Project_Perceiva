import { jwtDecode } from "jwt-decode";
import { Navigate, useNavigate } from "react-router-dom";
import BlindRegister from "./BlindRegister/BlindRegister";
import VolunteerRegister from "./VolunteerRegister/VolunteerRegister";

const RegisterRouter = () => {
  
  const token = localStorage.getItem("token");

  // 1️⃣ No token → go back to register
  if (!token) {
    return <Navigate to="/register" replace />;
  }

  let decoded;
  try {
    decoded = jwtDecode(token);
  } catch (error) {
    console.error("Invalid token");
    localStorage.removeItem("token");
    return <Navigate to="/register" replace />;
  }

  const role = decoded.role;

  // 2️⃣ Role-based rendering
  if (role === "blind") return <BlindRegister />;
  if (role === "volunteer") return <VolunteerRegister />;

  // 3️⃣ Fallback safety
  return <Navigate to="/register" replace />;
};

export default RegisterRouter;
