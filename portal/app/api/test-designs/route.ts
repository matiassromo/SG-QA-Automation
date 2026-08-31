import { and, asc, eq, inArray, max } from "drizzle-orm";
import { NextResponse } from "next/server";
import { ensureSchema, getDb } from "@/db";
import { testCaseDrafts } from "@/db/schema";

const decode = (row: typeof testCaseDrafts.$inferSelect) => ({
  ...row,
  steps: JSON.parse(row.steps),
  configurations: JSON.parse(row.configurations),
});

export async function GET(request: Request) {
  const project = new URL(request.url).searchParams.get("project")?.trim();
  if (!project)
    return NextResponse.json({ error: "Falta el proyecto." }, { status: 400 });
  await ensureSchema();
  const rows = await getDb()
    .select()
    .from(testCaseDrafts)
    .where(eq(testCaseDrafts.project, project))
    .orderBy(asc(testCaseDrafts.sequence));
  return NextResponse.json({ cases: rows.map(decode) });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    project?: string;
    requirements?: Array<{
      id: number;
      title: string;
      description?: string;
      acceptanceCriteria?: string;
    }>;
  };
  const project = String(body.project ?? "").trim(),
    requirements = body.requirements ?? [];
  if (!project || !requirements.length)
    return NextResponse.json(
      { error: "Selecciona al menos una HU." },
      { status: 400 },
    );
  await ensureSchema();
  const existing = await getDb().select().from(testCaseDrafts).where(and(
    eq(testCaseDrafts.project, project),
    inArray(testCaseDrafts.requirementId, requirements.map(item => item.id)),
  ));
  const covered = new Set(existing.filter(item => item.status !== "discarded").map(item => item.requirementId));
  const pendingRequirements = requirements.filter(item => !covered.has(item.id));
  if (!pendingRequirements.length) return NextResponse.json({ cases: existing.map(decode), reused: true });
  const [{ value }] = await getDb()
    .select({ value: max(testCaseDrafts.sequence) })
    .from(testCaseDrafts)
    .where(eq(testCaseDrafts.project, project));
  let sequence = (value ?? 0) + 1;
  const now = new Date().toISOString();
  const values = pendingRequirements.flatMap((hu) => {
    const criterion = (hu.acceptanceCriteria || hu.description || hu.title)
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);
    return [
      {
        kind: "Positivo",
        summary: `Validar ${hu.title}`,
        expected: `La funcionalidad cumple el criterio de aceptación: ${criterion || hu.title}.`,
      },
      {
        kind: "Negativo",
        summary: `Validar restricciones de ${hu.title}`,
        expected:
          "El sistema impide la operación inválida y presenta un mensaje claro sin perder la información válida.",
      },
      {
        kind: "Límite",
        summary: `Validar datos límite de ${hu.title}`,
        expected:
          "El sistema procesa correctamente los valores permitidos y rechaza los que exceden las reglas definidas.",
      },
    ].map((item, index) => {
      const current = sequence++;
      return {
        project,
        requirementId: hu.id,
        rfcId: null,
        sequence: current,
        title: `QA - TC-${String(current).padStart(3, "0")} Caso ${index + 1}: ${item.summary}`,
        caseType: item.kind,
        preconditions: `Usuario de pruebas habilitado y ambiente disponible. HU #${hu.id}.`,
        steps: JSON.stringify([
          `Ingresar al flujo correspondiente a ${hu.title}.`,
          index === 0
            ? "Completar el flujo con datos válidos."
            : index === 1
              ? "Ingresar datos inválidos o ejecutar una acción no permitida."
              : "Probar los valores mínimo, máximo y fuera de rango.",
          "Confirmar el comportamiento y registrar evidencia.",
        ]),
        expectedResult: item.expected,
        configurations: JSON.stringify(["Chrome", "Android", "iOS"]),
        automatable: true,
        automationReason:
          "Flujo funcional repetible con datos y resultado verificable.",
        status: "draft",
        createdAt: now,
        updatedAt: now,
      };
    });
  });
  const created: typeof testCaseDrafts.$inferSelect[] = [];
  for (let index = 0; index < values.length; index += 3) {
    created.push(...await getDb().insert(testCaseDrafts).values(values.slice(index, index + 3)).returning());
  }
  return NextResponse.json({ cases: created.map(decode) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  const id = Number(body.id),
    project = String(body.project ?? "");
  if (!Number.isInteger(id) || !project)
    return NextResponse.json({ error: "Caso inválido." }, { status: 400 });
  const allowed: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  for (const key of [
    "title",
    "caseType",
    "preconditions",
    "expectedResult",
    "automationReason",
    "status",
  ] as const)
    if (body[key] !== undefined) allowed[key] = String(body[key]);
  if (Array.isArray(body.steps)) allowed.steps = JSON.stringify(body.steps);
  if (Array.isArray(body.configurations))
    allowed.configurations = JSON.stringify(body.configurations);
  if (typeof body.automatable === "boolean")
    allowed.automatable = body.automatable;
  await ensureSchema();
  const [updated] = await getDb()
    .update(testCaseDrafts)
    .set(allowed)
    .where(and(eq(testCaseDrafts.id, id), eq(testCaseDrafts.project, project)))
    .returning();
  return NextResponse.json(
    updated ? decode(updated) : { error: "No encontrado." },
    { status: updated ? 200 : 404 },
  );
}
