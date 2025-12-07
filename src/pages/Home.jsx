import { useNavigate } from "react-router-dom";

export default function Home() {
  const nav = useNavigate();
  return (
    <div className="container">
      <h2>Welcome to Perceiva</h2>
      <p>Smart Allergy Recommendation System</p>
      <button onClick={() => nav("/medical")}>Start</button>
    </div>
  );
}
