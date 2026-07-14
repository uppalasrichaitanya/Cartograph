"use client";

export function LoadingSkeleton() {
  return (
    <div className="loading-skeleton" aria-busy="true" aria-label="Loading analysis">
      <div className="skeleton-header">
        <div className="skeleton-title" />
        <div className="skeleton-stats">
          <div className="skeleton-stat" />
          <div className="skeleton-stat" />
          <div className="skeleton-stat" />
          <div className="skeleton-stat" />
        </div>
      </div>
      <div className="skeleton-graph">
        <div className="skeleton-node" />
        <div className="skeleton-node" />
        <div className="skeleton-node" />
        <div className="skeleton-node" />
        <div className="skeleton-node" />
        <div className="skeleton-node" />
        <div className="skeleton-node" />
        <div className="skeleton-node" />
      </div>
      <div className="skeleton-anomalies">
        <div className="skeleton-anomaly" />
        <div className="skeleton-anomaly" />
        <div className="skeleton-anomaly" />
      </div>
    </div>
  );
}
