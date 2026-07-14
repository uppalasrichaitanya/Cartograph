"use client";

export function BreadcrumbNav({
  folder,
  selectedFileName,
  onNavigateRoot,
  onNavigateFolder,
}: {
  folder: string | null;
  selectedFileName: string | null;
  onNavigateRoot: () => void;
  onNavigateFolder: () => void;
}) {
  return (
    <nav className="breadcrumb-nav" aria-label="Breadcrumb">
      <button
        type="button"
        className={`breadcrumb-item ${!folder ? "is-current" : ""}`}
        onClick={folder ? onNavigateRoot : undefined}
        aria-current={!folder ? "page" : undefined}
      >
        Repository
      </button>
      {folder && (
        <>
          <span className="breadcrumb-separator" aria-hidden="true">›</span>
          <button
            type="button"
            className={`breadcrumb-item ${!selectedFileName ? "is-current" : ""}`}
            onClick={selectedFileName ? onNavigateFolder : undefined}
            aria-current={!selectedFileName ? "page" : undefined}
          >
            {folder}
          </button>
        </>
      )}
      {selectedFileName && (
        <>
          <span className="breadcrumb-separator" aria-hidden="true">›</span>
          <span className="breadcrumb-item is-current" aria-current="page">
            {selectedFileName}
          </span>
        </>
      )}
    </nav>
  );
}
