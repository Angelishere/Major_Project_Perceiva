import EmergencyForm from "../components/EmergencyForm";
import { useNavigate } from "react-router-dom";

export default function EmergencyDetails({ formData, setFormData }) {
  const nav = useNavigate();
  return <EmergencyForm formData={formData} setFormData={setFormData} onNext={() => nav("/success")} />;
}
