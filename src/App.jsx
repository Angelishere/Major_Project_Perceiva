import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useState } from "react";

import Home from "./pages/Home";
import Video_Chat_sender from "./pages/Video_Call/Video_Chat_sender";
import Video_Chat from "./pages/Video_Call/Video_Chat";
import Login from "./pages/Login/Login";
import Register from "./pages/Register/Register";
import ProtectedRoute from "./utils/ProtectedRoute";
import CallPage from "./pages/Call/CallPage";
import { CallProvider } from "./context/CallContext";

function App() {

  return (
    <BrowserRouter>
      <Routes>

        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<Home />} />
          <Route path="/videosend" element={<Video_Chat_sender />} />
          <Route path="/videorec" element={<Video_Chat />} />
        </Route>
        <Route element={<ProtectedRoute />}>
          <Route path="/calls" element={
            <CallProvider>
              <CallPage />
            </CallProvider>
          } /></Route>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
