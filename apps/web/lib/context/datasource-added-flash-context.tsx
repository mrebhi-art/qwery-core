import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';

const DATASOURCE_BADGE_TIMEOUT_MS = 3500;

type DatasourceAddedFlashContextValue = {
  showDatasourceBadge: boolean;
  triggerDatasourceBadge: () => void;
};

const DatasourceAddedFlashContext =
  createContext<DatasourceAddedFlashContextValue | null>(null);

export function DatasourceAddedFlashProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [showDatasourceBadge, setShowDatasourceBadge] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerDatasourceBadge = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setShowDatasourceBadge(true);
    timeoutRef.current = setTimeout(() => {
      setShowDatasourceBadge(false);
      timeoutRef.current = null;
    }, DATASOURCE_BADGE_TIMEOUT_MS);
  }, []);

  const value: DatasourceAddedFlashContextValue = {
    showDatasourceBadge,
    triggerDatasourceBadge,
  };

  return (
    <DatasourceAddedFlashContext.Provider value={value}>
      {children}
    </DatasourceAddedFlashContext.Provider>
  );
}

export function useDatasourceAddedFlash() {
  const ctx = useContext(DatasourceAddedFlashContext);
  return ctx;
}
