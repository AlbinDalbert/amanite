type Props = {
  checked: boolean;
  description: string;
  label: string;
  onChange: (checked: boolean) => void;
};

function DerivedLinksOption({ checked, description, label, onChange }: Props) {
  return (
    <label className="export-check-row">
      <input checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} type="checkbox" />
      <span><strong>{label}</strong><small>{description}</small></span>
    </label>
  );
}

export default DerivedLinksOption;
