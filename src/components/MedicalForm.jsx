export default function MedicalForm({ formData, setFormData, onNext }) {
  return (
    <div className="container">
      <h2>Medical Details</h2>

      <input placeholder="Full Name" value={formData.name}
        onChange={e => setFormData({...formData, name: e.target.value})} />

      <input placeholder="Age" type="number" value={formData.age}
        onChange={e => setFormData({...formData, age: e.target.value})} />

      <select onChange={e => setFormData({...formData, gender: e.target.value})}>
        <option>Gender</option>
        <option>Male</option>
        <option>Female</option>
      </select>

      <button onClick={onNext}>Next</button>
    </div>
  );
}
