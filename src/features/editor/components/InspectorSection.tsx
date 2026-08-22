type InspectorItem = { label: string; onSelect?: () => void };

type InspectorSectionProps = {
  emptyLabel: string;
  items: InspectorItem[];
  title: string;
};

function InspectorSection({ emptyLabel, items, title }: InspectorSectionProps) {
  return (
    <section className="fractal-inspector-section">
      <h3>{title}</h3>
      {items.length > 0 ? (
        <ul>
          {items.map((item, index) => (
            <li key={`${item.label}-${index}`}>
              {item.onSelect ? <button onClick={item.onSelect} type="button">{item.label}</button> : item.label}
            </li>
          ))}
        </ul>
      ) : <p>{emptyLabel}</p>}
    </section>
  );
}

export default InspectorSection;
