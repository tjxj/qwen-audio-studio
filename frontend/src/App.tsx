import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/shell/AppShell";
import CreatePage from "./features/create/CreatePage";
import HelpPage from "./features/help/HelpPage";
import ResultPage from "./features/results/ResultPage";
import HistoryRoute from "./features/history/HistoryRoute";
import ProjectsRoute from "./features/projects/ProjectsRoute";
import SettingsRoute from "./features/settings/SettingsRoute";
import ReferenceLibraryRoute from "./features/references/ReferenceLibraryRoute";
import LibraryPage from "./features/library/LibraryPage";
import { TemplateLibrary } from "./features/templates/TemplateLibrary";
import { PlayerProvider } from "./features/player/PlayerProvider";

export default function App() {
  return (
    <PlayerProvider>
      <AppShell>
        <Routes>
          <Route path="/" element={<CreatePage />} />
          <Route
            path="/projects"
            element={<Navigate to="/library?view=projects" replace />}
          />
          <Route
            path="/references"
            element={<Navigate to="/?panel=voices" replace />}
          />
          <Route
            path="/history"
            element={<Navigate to="/library?view=jobs" replace />}
          />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/templates" element={<TemplateLibrary />} />
          <Route path="/settings" element={<SettingsRoute />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/results/:jobId" element={<ResultPage />} />
        </Routes>
      </AppShell>
    </PlayerProvider>
  );
}
