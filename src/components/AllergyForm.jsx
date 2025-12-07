export default function AllergyForm({ formData, setFormData, onNext }) {
  const toggleAllergy = (item) => {
    const updated = formData.allergens.includes(item)
      ? formData.allergens.filter(a => a !== item)
      : [...formData.allergens, item];
      
    setFormData({ ...formData, allergens: updated });
  };

  return (
    <div className="container">
      <h2>Allergy Details</h2>

      {["Milk", "Nuts", "Egg", "Dust"].map(item => (
        <label key={item}>
          <input type="checkbox" onChange={() => toggleAllergy(item)} />
          {item}
        </label>
      ))}

      <select onChange={e => setFormData({...formData, severity: e.target.value})}>
        <option>Severity</option>
        <option>Mild</option>
        <option>Moderate</option>
        <option>Severe</option>
      </select>

      <button onClick={onNext}>Next</button>
    </div>
  );
}
