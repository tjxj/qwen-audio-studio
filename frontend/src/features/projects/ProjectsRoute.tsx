import {useQuery} from "@tanstack/react-query";
import {listProjects} from "../../api";
import ProjectsPage from "./ProjectsPage";

export default function ProjectsRoute() {
  const query = useQuery({queryKey: ["projects"], queryFn: listProjects});
  return <ProjectsPage projects={query.data || []} />;
}
