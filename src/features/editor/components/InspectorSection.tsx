type InspectorSectionProps = {
  emptyLabel: string;
  items: string[];
  title: string;
};

function InspectorSection({ emptyLabel, items, title }: InspectorSectionProps) {
  return (
    <section className="fractal-inspector-section">
      <h3>{title}</h3>
      {items.length > 0 ? (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p>{emptyLabel}</p>
      )}
    </section>
  );
}

export default InspectorSection;
