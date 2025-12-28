import { BrowserRouter, Routes, Route } from "react-router-dom";

import Video_Chat_sender from "./pages/Video_Call/Video_Chat_sender";
import Video_Chat from "./pages/Video_Call/Video_Chat";
import Login from "./pages/Login/Login";
import Register from "./pages/Register/Register";
import ProtectedRoute from "./utils/ProtectedRoute";
import CallPage from "./pages/Call/CallPage";
import { CallProvider } from "./context/CallContext";
import Navbar from "./components/Navbar/Navbar";
import Home from "./pages/Home/Home";

function App() {

  return (
    <BrowserRouter>
      <Navbar />
      <Routes>

        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<Home/>} />
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
