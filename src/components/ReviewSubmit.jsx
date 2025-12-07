export default function ReviewSubmit({ formData }) {
  return (
    <div className="container">
      <h2>Review</h2>
      <pre>{JSON.stringify(formData, null, 2)}</pre>
    </div>
  );
}
