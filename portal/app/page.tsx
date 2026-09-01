"use client";

import { useEffect, useMemo, useState } from "react";
import { TestDesignPanel } from "./test-design-panel";
import { AutomationPanel } from "./automation-panel";
import { ExecutionsPanel } from "./executions-panel";
import { TestPlansPanel } from "./test-plans-panel";
import { DesignPreparationModal } from "./design-preparation-modal";

type Project = {
  id: string;
  name: string;
  description: string;
  state: string;
  visibility: string;
  lastUpdateTime: string;
};
type Plan = {
  id: number;
  name: string;
  state: string;
  areaPath: string;
  iteration: string;
  startDate: string;
  endDate: string;
  rootSuiteId: number | null;
};
type Suite = {
  id: number;
  name: string;
  suiteType: string;
  requirementId: number | null;
  parentSuiteId: number | null;
};
type Point = {
  id: number;
  testCaseId: number;
  configurationId: number;
  configurationName: string;
  outcome: string;
  state: string;
};
type TestCase = { id: number; title: string; order: number; points: Point[] };
type SuiteDetails = {
  testCases: TestCase[];
  points: Point[];
  configurations: { id: number; name: string }[];
};
type Requirement = {
  id: number;
  title: string;
  type: string;
  state: string;
  assignedTo: string;
  iteration: string;
  changedDate: string;
};
type RequirementDetail = Requirement & {
  parentId: number | null;
  area: string;
  priority: number | null;
  description: string;
  acceptanceCriteria: string;
  testCaseIds: number[];
  attachments: { id: string; name: string; comment: string }[];
};
type RequirementsData = {
  requirements: RequirementDetail[];
  classification: { areas: string[]; iterations: string[] };
  summary: {
    epics: number;
    features: number;
    stories: number;
    coveredStories: number;
  };
};
type View =
  | "requirements"
  | "design"
  | "testplans"
  | "automation"
  | "runs"
  | "settings";

async function readJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal });
  const payload = await response.json() as { error?: string } & T;
  if (!response.ok)
    throw new Error(payload.error ?? "No fue posible consultar Azure DevOps.");
  return payload as T;
}
const nav: Array<{ id: View; label: string; icon: string }> = [
  { id: "requirements", label: "Requisitos", icon: "◇" },
  { id: "testplans", label: "Test Plans", icon: "▣" },
  { id: "design", label: "Diseño de pruebas", icon: "✦" },
  { id: "automation", label: "Automatización", icon: "⌘" },
  { id: "runs", label: "Ejecuciones", icon: "▶" },
  { id: "settings", label: "Configuración", icon: "⚙" },
];

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]),
    [project, setProject] = useState(""),
    [filter, setFilter] = useState("");
  const [view, setView] = useState<View>("requirements"),
    [plans, setPlans] = useState<Plan[]>([]),
    [suites, setSuites] = useState<Suite[]>([]),
    [details, setDetails] = useState<SuiteDetails | null>(null);
  const [requirements, setRequirements] = useState<RequirementsData | null>(
      null,
    ),
    [selectedRequirements, setSelectedRequirements] = useState<number[]>([]);
  const [planId, setPlanId] = useState<number | null>(null),
    [suiteId, setSuiteId] = useState<number | null>(null),
    [preparingDesign, setPreparingDesign] = useState(false),
    [loading, setLoading] = useState("Conectando con Azure DevOps…"),
    [error, setError] = useState("");
  useEffect(() => {
    readJson<{ projects: Project[] }>("/api/azure/projects")
      .then((data) => {
        setProjects(data.projects);
        setLoading("");
      })
      .catch((err) => {
        setError(err.message);
        setLoading("");
      });
  }, []);
  useEffect(() => {
    if (!project) return;
    const controller = new AbortController();
    setView("requirements");
    setRequirements(null);
    setSelectedRequirements([]);
    setPlans([]);
    setSuites([]);
    setDetails(null);
    setPlanId(null);
    setSuiteId(null);
    setError("");
    setLoading("");
    return () => controller.abort();
  }, [project]);
  useEffect(() => {
    if (
      !project ||
      !["requirements", "design", "testplans"].includes(view) ||
      requirements
    )
      return;
    const controller = new AbortController();
    setError("");
    setLoading("Construyendo jerarquía de requisitos…");
    readJson<RequirementsData>(
      `/api/azure/projects/${encodeURIComponent(project)}/requirements`,
      controller.signal,
    )
      .then((data) => {
        setRequirements(data);
        setLoading("");
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          setError(err.message);
          setLoading("");
        }
      });
    return () => controller.abort();
  }, [project, view, requirements]);
  useEffect(() => {
    if (!project || !["requirements", "testplans", "automation"].includes(view) || plans.length)
      return;
    const controller = new AbortController();
    setLoading("Cargando Test Plans…");
    setError("");
    readJson<{ plans: Plan[] }>(
      `/api/azure/projects/${encodeURIComponent(project)}/plans`,
      controller.signal,
    )
      .then((data) => {
        setPlans(data.plans);
        setLoading("");
        if (data.plans[0]) setPlanId(data.plans[0].id);
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          setError(err.message);
          setLoading("");
        }
      });
    return () => controller.abort();
  }, [project, view, plans.length]);
  useEffect(() => {
    if (!project || !["testplans", "automation"].includes(view) || !planId) return;
    const controller = new AbortController();
    setLoading("Cargando Test Suites…");
    setError("");
    setSuites([]);
    setDetails(null);
    setSuiteId(null);
    readJson<{ suites: Suite[] }>(
      `/api/azure/projects/${encodeURIComponent(project)}/plans/${planId}/suites`,
      controller.signal,
    )
      .then((data) => {
        setSuites(data.suites);
        setLoading("");
        const first =
          data.suites.find((item) =>
            item.suiteType.toLowerCase().includes("requirement"),
          ) ?? data.suites[0];
        if (first) setSuiteId(first.id);
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          setError(err.message);
          setLoading("");
        }
      });
    return () => controller.abort();
  }, [project, view, planId]);
  useEffect(() => {
    if (
      !project ||
      view !== "testplans" ||
      !planId ||
      !suiteId ||
      !suites.some((item) => item.id === suiteId)
    )
      return;
    const controller = new AbortController();
    setLoading("Cargando casos y configuraciones…");
    setError("");
    setDetails(null);
    readJson<SuiteDetails>(
      `/api/azure/projects/${encodeURIComponent(project)}/plans/${planId}/suites/${suiteId}`,
      controller.signal,
    )
      .then((data) => {
        setDetails(data);
        setLoading("");
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          setError(err.message);
          setLoading("");
        }
      });
    return () => controller.abort();
  }, [project, view, planId, suiteId, suites]);
  const visibleProjects = useMemo(
    () =>
      projects.filter((item) =>
        item.name.toLowerCase().includes(filter.toLowerCase()),
      ),
    [projects, filter],
  );
  const selectProject = (name: string) => {
    if (name === project) {
      setView("requirements");
      return;
    }
    setProject(name);
  };
  return (
    <main className="portal-shell">
      <aside className="project-rail">
        <div className="brand">
          <span>SG</span>
          <strong>QA Control</strong>
        </div>
        <div className="rail-title">
          <div>
            <small>AZURE DEVOPS</small>
            <b>Seleccionar proyecto</b>
          </div>
          <span>{projects.length}</span>
        </div>
        <input
          className="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Buscar proyecto…"
        />
        <div className="project-list">
          {visibleProjects.map((item) => (
            <button
              key={item.id}
              className={project === item.name ? "selected" : ""}
              onClick={() => selectProject(item.name)}
            >
              <span>{item.name.slice(0, 2).toUpperCase()}</span>
              <div>
                <b>{item.name}</b>
                <small>
                  {item.state} · {item.visibility}
                </small>
              </div>
            </button>
          ))}
        </div>
        <div className="local-badge">
          <i /> Ejecución local segura
        </div>
      </aside>
      <section className="main-stage">
        <header className="portal-header">
          <div>
            <small>{project || "Seleccione un proyecto para comenzar"}</small>
            <h1>
              {project
                ? "Centro de calidad del proyecto"
                : "Portal de automatización QA"}
            </h1>
          </div>
          <div className="connection">
            <i /> Conectado
          </div>
        </header>
        {!project ? (
          <Welcome count={projects.length} />
        ) : (
          <>
            <nav className="section-nav">
              {nav.map((item) => (
                <button
                  key={item.id}
                  className={view === item.id ? "active" : ""}
                  onClick={() => setView(item.id)}
                >
                  <span>{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </nav>
            {error && <div className="error-banner">{error}</div>}
            {loading && (
              <div className="loading-card">
                <span />
                <b>{loading}</b>
              </div>
            )}
            {!loading && !error && view === "requirements" && requirements && (
              <RequirementsPanel
                data={requirements}
                selected={selectedRequirements}
                setSelected={setSelectedRequirements}
                openDesign={() => setPreparingDesign(true)}
              />
            )}{" "}
            {!loading && !error && view === "design" && requirements && (
              <TestDesignPanel
                project={project}
                planId={planId}
                selectedHuIds={selectedRequirements}
                requirements={requirements.requirements}
                onRemoveHu={(id) => setSelectedRequirements((current) => current.filter((item) => item !== id))}
              />
            )}{" "}
            {!loading && !error && view === "testplans" && (
              <TestPlansPanel
                project={project}
                plans={plans}
                suites={suites}
                details={details}
                requirements={requirements?.requirements ?? []}
                classification={requirements?.classification ?? { areas: [], iterations: [] }}
                selectedRequirementIds={selectedRequirements}
                planId={planId}
                suiteId={suiteId}
                setPlanId={setPlanId}
                setSuiteId={setSuiteId}
                onPlanCreated={(created) => {
                  setPlans((current) => [created, ...current]);
                  setPlanId(created.id);
                }}
                onPlanUpdated={(updated) => setPlans((current) => current.map((item) => item.id === updated.id ? updated : item))}
                onPlanDeleted={(deletedId) => {
                  const remaining = plans.filter((item) => item.id !== deletedId);
                  setPlans(remaining);
                  setPlanId(remaining[0]?.id ?? null);
                }}
                onSuitesPrepared={(prepared) => setSuites((current) => {
                  const merged = new Map(current.map((item) => [item.id, item]));
                  prepared.forEach((item) => merged.set(item.id, item));
                  return [...merged.values()];
                })}
              />
            )}{" "}
            {!loading && !error && view === "automation" && (
              <AutomationPanel project={project} plans={plans} suites={suites} selectedPlanId={planId} selectedSuiteId={suiteId} />
            )}{" "}
            {!loading && !error && view === "runs" && (
              <ExecutionsPanel project={project} />
            )}{" "}
            {!loading &&
              !error &&
              ![
                "requirements",
                "design",
                "testplans",
                "automation",
                "runs",
              ].includes(view) && (
                <ModulePlaceholder
                  view={view}
                  project={project}
                />
              )}
          </>
        )}
        {preparingDesign && requirements && (
          <DesignPreparationModal
            project={project}
            plans={plans}
            selectedRequirements={requirements.requirements.filter((item) => selectedRequirements.includes(item.id))}
            selectedPlanId={planId}
            onClose={() => setPreparingDesign(false)}
            onPlanCreated={(created) => {
              setPlans((current) => [created, ...current]);
              setPlanId(created.id);
            }}
            onContinue={(destinationPlanId) => {
              setPlanId(destinationPlanId);
              setPreparingDesign(false);
              setView("design");
            }}
          />
        )}
      </section>
    </main>
  );
}

function Welcome({ count }: { count: number }) {
  return (
    <section className="welcome">
      <div className="welcome-mark">SG</div>
      <small>PASO 1 DE TU FLUJO QA</small>
      <h2>¿En qué proyecto vas a trabajar?</h2>
      <p>
        Selecciona uno de los {count} proyectos disponibles. Las HUs, casos,
        planes, configuraciones y ejecuciones quedarán aislados dentro de ese
        proyecto.
      </p>
      <div>
        <span>1</span>Selecciona un proyecto en el panel izquierdo
      </div>
    </section>
  );
}
function RequirementsPanel({
  data,
  selected,
  setSelected,
  openDesign,
}: {
  data: RequirementsData;
  selected: number[];
  setSelected: (ids: number[]) => void;
  openDesign: () => void;
}) {
  const [focused, setFocused] = useState<number | null>(
    data.requirements.find((item) =>
      ["User Story", "Product Backlog Item"].includes(item.type),
    )?.id ??
      data.requirements[0]?.id ??
      null,
  );
  const [query, setQuery] = useState("");
  const current = data.requirements.find((item) => item.id === focused);
  const children = (parentId: number | null) =>
    data.requirements.filter((item) => item.parentId === parentId);
  const toggle = (id: number) =>
    setSelected(
      selected.includes(id)
        ? selected.filter((item) => item !== id)
        : [...selected, id],
    );
  const stories = data.requirements.filter((item) =>
    ["User Story", "Product Backlog Item"].includes(item.type),
  );
  const roots = data.requirements.filter(
    (item) =>
      item.type === "Epic" || (!item.parentId && item.type === "Feature"),
  );
  const matches = (item: RequirementDetail) =>
    !query ||
    `${item.id} ${item.title}`.toLowerCase().includes(query.toLowerCase());
  return (
    <div className="requirements-page">
      <section className="requirements-stats">
        <article>
          <b>{data.summary.epics}</b>
          <span>Epics</span>
        </article>
        <article>
          <b>{data.summary.features}</b>
          <span>Features</span>
        </article>
        <article>
          <b>{data.summary.stories}</b>
          <span>Historias/PBI</span>
        </article>
        <article>
          <b>{data.summary.coveredStories}</b>
          <span>Con cobertura</span>
        </article>
        <article>
          <b>{data.summary.stories - data.summary.coveredStories}</b>
          <span>Sin casos</span>
        </article>
      </section>
      <section className="requirements-layout">
        <article className="tree-panel">
          <div className="tree-head">
            <div>
              <small>JERARQUÍA DEL PROYECTO</small>
              <h3>Requisitos</h3>
            </div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar ID o título…"
            />
          </div>
          <div className="tree-list">
            {roots.map((epic) => (
              <div key={epic.id} className="tree-group">
                <button
                  onClick={() => setFocused(epic.id)}
                  className={focused === epic.id ? "focused" : ""}
                >
                  <span className="type epic">EPIC</span>
                  <b>
                    {epic.id} · {epic.title}
                  </b>
                </button>
                {children(epic.id)
                  .filter(matches)
                  .map((feature) => (
                    <div className="feature-branch" key={feature.id}>
                      <button
                        onClick={() => setFocused(feature.id)}
                        className={focused === feature.id ? "focused" : ""}
                      >
                        <span className="type feature">FEATURE</span>
                        <b>
                          {feature.id} · {feature.title}
                        </b>
                      </button>
                      {children(feature.id)
                        .filter(matches)
                        .map((story) => (
                          <label
                            className={
                              focused === story.id
                                ? "focused story-row"
                                : "story-row"
                            }
                            key={story.id}
                          >
                            <input
                              type="checkbox"
                              checked={selected.includes(story.id)}
                              onChange={() => toggle(story.id)}
                            />
                            <button onClick={() => setFocused(story.id)}>
                              <span className="type story">HU</span>
                              <span>
                                {story.id} · {story.title}
                              </span>
                            </button>
                            <em
                              className={
                                story.testCaseIds.length
                                  ? "covered"
                                  : "uncovered"
                              }
                            >
                              {story.testCaseIds.length} TC
                            </em>
                          </label>
                        ))}
                    </div>
                  ))}
              </div>
            ))}
          </div>
        </article>
        <aside className="requirement-detail">
          {current ? (
            <>
              <div className="detail-title">
                <span
                  className={`type ${current.type.toLowerCase().includes("story") || current.type.includes("Backlog") ? "story" : current.type.toLowerCase()}`}
                >
                  {current.type}
                </span>
                <h2>
                  {current.id} · {current.title}
                </h2>
                <div>
                  <em className="state active">{current.state}</em>
                  <span>{current.iteration || "Sin iteración"}</span>
                </div>
              </div>
              <dl className="detail-meta">
                <div>
                  <dt>Responsable</dt>
                  <dd>{current.assignedTo || "Sin asignar"}</dd>
                </div>
                <div>
                  <dt>Área</dt>
                  <dd>{current.area || "—"}</dd>
                </div>
                <div>
                  <dt>Prioridad</dt>
                  <dd>{current.priority ?? "—"}</dd>
                </div>
                <div>
                  <dt>Cobertura</dt>
                  <dd>{current.testCaseIds.length} Test Cases</dd>
                </div>
              </dl>
              <section>
                <h4>Descripción</h4>
                <p>{current.description || "Sin descripción registrada."}</p>
              </section>
              <section>
                <h4>Criterios de aceptación</h4>
                <pre>
                  {current.acceptanceCriteria ||
                    "Sin criterios de aceptación registrados."}
                </pre>
              </section>
              {current.testCaseIds.length > 0 && (
                <section>
                  <h4>Test Cases vinculados</h4>
                  <div className="chips">
                    {current.testCaseIds.map((id) => (
                      <span key={id}>TC {id}</span>
                    ))}
                  </div>
                </section>
              )}
            </>
          ) : (
            <div className="empty">Selecciona un requisito.</div>
          )}
        </aside>
      </section>
      <footer className="selection-bar">
        <div>
          <b>{selected.length} HUs seleccionadas</b>
          <span>de {stories.length} disponibles</span>
        </div>
        <button disabled={!selected.length} onClick={openDesign}>
          Continuar con diseño de pruebas →
        </button>
      </footer>
    </div>
  );
}
function ModulePlaceholder({
  view,
  project,
}: {
  view: View;
  project: string;
}) {
  const titles: Record<string, string> = {
    requirements: "Requisitos del proyecto",
    design: "Diseño y generación de casos",
    automation: "Cobertura de automatización",
    runs: "Ejecuciones y evidencias",
    settings: "Configuración del proyecto",
  };
  return (
    <section className="module-placeholder">
      <small>{project.toUpperCase()}</small>
      <h2>{titles[view]}</h2>
      <p>
        Este módulo utilizará únicamente la información y numeración de{" "}
        <b>{project}</b>.
      </p>
    </section>
  );
}
