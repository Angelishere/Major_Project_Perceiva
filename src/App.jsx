import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useState } from "react";

import Home from "./pages/Home";
import MedicalDetails from "./pages/MedicalDetails";
import AllergyDetails from "./pages/AllergyDetails";
import EmergencyDetails from "./pages/EmergencyDetails";
import Success from "./pages/Success";
import Video_Chat_sender from "./components/Video_Chat_sender";
import Video_Chat from "./components/Video_Chat";
import Login from "./components/Login/Login";
import Register from "./components/Register/Register";

function App() {
  const [formData, setFormData] = useState({
    name: "",
    age: "",
    gender: "",
    conditions: [],
    allergens: [],
    severity: "",
    reactions: [],
    emergencyName: "",
    emergencyPhone: "",
    epipen: false
  });

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/medical" element={<MedicalDetails formData={formData} setFormData={setFormData} />} />
        <Route path="/allergy" element={<AllergyDetails formData={formData} setFormData={setFormData} />} />
        <Route path="/emergency" element={<EmergencyDetails formData={formData} setFormData={setFormData} />} />
        <Route path="/success" element={<Success />} />
        <Route path="/videosend" element={<Video_Chat_sender/>} />
        <Route path="/videorec" element={<Video_Chat/>} />
        <Route path="/login" element={<Login/>} />
        <Route path="/register" element={<Register/>} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
