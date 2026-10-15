/** Shared live/settled label treatment for thinking and tool process rows. */
export function ProcessRowLabel({ label, running }: { label: string; running: boolean }) {
  return <span className="process-tool-label" data-running={running || undefined}>
    {label}<span className="tool-summary-shimmer" data-label={label} aria-hidden="true"/>
  </span>;
}
