import MedicalForm from "../components/MedicalForm";
import { useNavigate } from "react-router-dom";

export default function MedicalDetails({ formData, setFormData }) {
  const nav = useNavigate();
  return <MedicalForm formData={formData} setFormData={setFormData} onNext={() => nav("/allergy")} />;
}
