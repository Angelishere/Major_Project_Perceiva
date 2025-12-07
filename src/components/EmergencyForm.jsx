export default function EmergencyForm({ formData, setFormData, onNext }) {
  return (
    <div className="container">
      <h2>Emergency Details</h2>

      <input placeholder="Emergency Contact Name"
        onChange={e => setFormData({...formData, emergencyName: e.target.value})} />

      <input placeholder="Emergency Phone"
        onChange={e => setFormData({...formData, emergencyPhone: e.target.value})} />

      <label>
        <input type="checkbox" onChange={e => setFormData({...formData, epipen: e.target.checked})} />
        Carry EpiPen?
      </label>

      <button onClick={onNext}>Submit</button>
    </div>
  );
}
