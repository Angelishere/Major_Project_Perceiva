import AllergyForm from "../components/AllergyForm";
import { useNavigate } from "react-router-dom";

export default function AllergyDetails({ formData, setFormData }) {
  const nav = useNavigate();
  return <AllergyForm formData={formData} setFormData={setFormData} onNext={() => nav("/emergency")} />;
}
