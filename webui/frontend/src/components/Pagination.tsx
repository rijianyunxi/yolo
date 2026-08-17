export function Pagination({
  page,
  pageCount,
  onChange,
}: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="pagination">
      <button type="button" className="btn" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        上一页
      </button>
      <span>
        {page} / {pageCount}
      </span>
      <button type="button" className="btn" disabled={page >= pageCount} onClick={() => onChange(page + 1)}>
        下一页
      </button>
    </div>
  );
}
