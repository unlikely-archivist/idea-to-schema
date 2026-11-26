import type { Field, Spec } from "./api";

// Renders the form from the spec data itself, never from generated code.
export function FormPreview({ spec, revisionId }: { spec: Spec; revisionId: string }) {
  return (
    <form className="preview" onSubmit={(e) => e.preventDefault()}>
      <p className="summary">{spec.summary}</p>
      {spec.fields.map((field) => (
        <PreviewField key={field.key} field={field} idPrefix={`preview-${revisionId}`} />
      ))}
    </form>
  );
}

function PreviewField({ field, idPrefix }: { field: Field; idPrefix: string }) {
  const id = `${idPrefix}-${field.key}`;
  const helpId = field.help ? `${id}-help` : undefined;
  const common = { id, name: field.key, required: field.required, "aria-describedby": helpId };

  const label = (
    <label htmlFor={id}>
      {field.label}
      {field.required && <span aria-hidden="true"> *</span>}
    </label>
  );
  const help = field.help && (
    <p id={helpId} className="help">
      {field.help}
    </p>
  );

  // A checkbox reads best with its label after it.
  if (field.type === "boolean") {
    return (
      <div className="field field-checkbox">
        <input type="checkbox" {...common} />
        {label}
        {help}
      </div>
    );
  }

  return (
    <div className="field">
      {label}
      {renderInput(field, common)}
      {help}
    </div>
  );
}

type CommonProps = { id: string; name: string; required: boolean; "aria-describedby"?: string };

function renderInput(field: Field, common: CommonProps) {
  switch (field.type) {
    case "text":
      return <textarea rows={3} {...common} />;
    case "enum":
      return (
        <select defaultValue="" {...common}>
          <option value="" disabled>
            Choose one
          </option>
          {field.options?.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      );
    case "number":
    case "date":
    case "email":
      return <input type={field.type} {...common} />;
    default:
      return <input type="text" {...common} />;
  }
}
