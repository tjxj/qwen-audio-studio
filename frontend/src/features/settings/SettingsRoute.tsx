import {useEffect, useState} from "react";
import {clearCredentials, getSession, saveCredentials} from "../../api";
import type {CredentialStatus} from "../../types";
import SettingsPage from "./SettingsPage";

export default function SettingsRoute() {
  const [status, setStatus] = useState<CredentialStatus>({
    apiKeyConfigured: false,
    workspaceConfigured: false
  });
  const [ready, setReady] = useState(false);
  const refresh = () => getSession().then((session) => {
    setStatus({
      apiKeyConfigured: session.credentials.api_key_configured,
      workspaceConfigured: session.credentials.workspace_configured
    });
    setReady(true);
  });
  useEffect(() => { void refresh(); }, []);
  return (
    <SettingsPage
      status={status}
      ready={ready}
      onSave={async (apiKey, workspaceId) => {
        await saveCredentials(apiKey, workspaceId);
        await refresh();
      }}
      onClear={() => void clearCredentials().then(refresh)}
    />
  );
}
