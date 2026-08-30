import { EmptyState } from './Primitives';

/**
 * One data set, two layouts.
 *
 * A horizontally scrolling table on a phone is technically readable but
 * genuinely unpleasant, so below `sm` each row renders as a stacked card of
 * label/value pairs instead. Columns are declared once and drive both.
 *
 * columns: [{ key, header, render(row), mobileHidden?, primary? }]
 *   primary     - shown as the card title on mobile (first primary wins)
 *   mobileHidden - omitted from the mobile card to keep it scannable
 */
export default function DataTable({
  columns,
  rows,
  rowKey,
  empty,
  actions,
  caption,
}) {
  if (!rows?.length) {
    return empty || <EmptyState title="Nothing here yet" description="Records will appear here once they exist." />;
  }

  const keyFor = (row, index) => (rowKey ? rowKey(row) : row.id || row._id || index);
  const primary = columns.find((column) => column.primary);
  const mobileColumns = columns.filter((column) => !column.mobileHidden && !column.primary);

  return (
    <>
      {/* Desktop / tablet */}
      <div className="table-wrap hidden sm:block">
        <table className="table">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col">{column.header}</th>
              ))}
              {actions && <th scope="col" className="text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={keyFor(row, index)}>
                {columns.map((column) => (
                  <td key={column.key}>{column.render(row)}</td>
                ))}
                {actions && (
                  <td className="text-right">
                    <div className="flex flex-wrap justify-end gap-2">{actions(row)}</div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone */}
      <ul className="space-y-3 sm:hidden">
        {rows.map((row, index) => (
          <li key={keyFor(row, index)} className="card card-p">
            {primary && (
              <div className="mb-3 border-b border-line pb-3">
                <div className="font-semibold text-ink">{primary.render(row)}</div>
              </div>
            )}
            <dl>
              {mobileColumns.map((column) => (
                <div key={column.key} className="stack-row">
                  <dt className="stack-key">{column.header}</dt>
                  <dd className="stack-val">{column.render(row)}</dd>
                </div>
              ))}
            </dl>
            {actions && (
              <div className="mt-4 flex flex-wrap gap-2">{actions(row)}</div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
