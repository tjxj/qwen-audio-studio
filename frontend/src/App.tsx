import {Route, Routes} from "react-router-dom";
import {AppShell} from "./components/shell/AppShell";
import CreatePage from "./features/create/CreatePage";
import HelpPage from "./features/help/HelpPage";
import ResultPage from "./features/results/ResultPage";
import HistoryRoute from "./features/history/HistoryRoute";
import ProjectsRoute from "./features/projects/ProjectsRoute";
import SettingsRoute from "./features/settings/SettingsRoute";
import ReferenceLibraryRoute from "./features/references/ReferenceLibraryRoute";

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<CreatePage />} />
        <Route path="/projects" element={<ProjectsRoute />} />
        <Route path="/references" element={<ReferenceLibraryRoute />} />
        <Route path="/history" element={<HistoryRoute />} />
        <Route path="/settings" element={<SettingsRoute />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/results/:jobId" element={<ResultPage />} />
      </Routes>
    </AppShell>
  );
}
