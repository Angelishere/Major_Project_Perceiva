import React from 'react'
import { jwtDecode } from "jwt-decode";
import { Navigate } from "react-router-dom";
import BlindHome from './BlindHome/BlindHome';
import VolunteerHome from './VolunteerHome/VolunteerHome';


const HomeRouter = () => {
    const token = localStorage.getItem("token");

    // 1️⃣ No token → go back to register
    if (!token) {
        return <Navigate to="/login" replace />;
    }

    let decoded;
    try {
        decoded = jwtDecode(token);
    } catch (error) {
        console.error("Invalid token");
        localStorage.removeItem("token");
        return <Navigate to="/login" replace />;
    }

    const role = decoded.role;

    // 2️⃣ Role-based rendering
    if (role === "blind") return <BlindHome />;
    if (role === "volunteer") return <VolunteerHome/>;

    // 3️⃣ Fallback safety
    return <Navigate to="/login" replace />;
}

export default HomeRouter



