import { FolderKanban, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Project } from "../../types";

export default function ProjectsPage({ projects }: { projects: Project[] }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () =>
      projects.filter((item) =>
        item.name.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [projects, query],
  );
  return (
    <section className="data-page">
      <header>
        <div>
          <span>本地创作资产</span>
          <h1>项目</h1>
        </div>
        <FolderKanban size={24} />
      </header>
      <label className="search-field">
        <Search size={16} />
        <input
          aria-label="搜索项目"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索项目名称"
        />
      </label>
      {projects.length === 0 ? (
        <div className="empty-state">
          <FolderKanban size={30} />
          <strong>还没有项目</strong>
          <p>
            从创作台生成第一条音频后，Prompt、参数、版本和验收报告会自动归档到这里。
          </p>
          <Link to="/">
            <Plus size={16} />
            创建第一个声音场景
          </Link>
        </div>
      ) : null}
      <div className="project-list">
        {filtered.map((project) => (
          <article key={project.id}>
            <div className="project-icon">
              <FolderKanban size={20} />
            </div>
            <div>
              <strong>{project.name}</strong>
              <span>
                {project.mode} · {project.updatedAt || "刚刚更新"}
              </span>
            </div>
            <div className="project-actions">
              {project.finalJobId ? (
                <Link
                  className="project-open-link"
                  to={`/results/${project.finalJobId}`}
                >
                  最终版本
                </Link>
              ) : null}
              <Link
                className="project-open-link"
                to={`/?project=${encodeURIComponent(project.id)}`}
              >
                继续创作
              </Link>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
