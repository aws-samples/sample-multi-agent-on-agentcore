import { FixtureRefPanel } from "./FixtureRefPanel";

interface DataPanelProps {
  username: string | null;
}

export function DataPanel({ username }: DataPanelProps) {
  return (
    <div className="h-full overflow-y-auto">
      <FixtureRefPanel username={username} />
    </div>
  );
}
