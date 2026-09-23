import {useCallback, useEffect, useState} from "react";
import {getSession} from "../../api";
import type {CredentialStatus} from "../../types";
import SettingsPage from "./SettingsPage";

export default function SettingsRoute() {
  const [status, setStatus] = useState<CredentialStatus>({
    apiKeyConfigured: false,
    workspaceConfigured: false
  });
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const session = await getSession();
      setStatus({
        apiKeyConfigured: session.credentials.api_key_configured,
        workspaceConfigured: session.credentials.workspace_configured
      });
    } catch {
      setStatus({apiKeyConfigured: false, workspaceConfigured: false});
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <SettingsPage
      status={status}
      ready={ready}
      refreshStatus={refresh}
    />
  );
}
