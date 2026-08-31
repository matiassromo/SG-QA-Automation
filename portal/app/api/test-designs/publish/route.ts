import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { ensureSchema, getDb } from '@/db';
import { testCaseDrafts } from '@/db/schema';
import { getProjectRequirements, publishDraftTestCase, resolveProjectContext } from '@/lib/azure-devops';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { project?: string; planId?: number; draftId?: number };
    const project = String(body.project ?? '').trim(), planId = Number(body.planId), draftId = Number(body.draftId);
    if (!project || !planId || !draftId) return NextResponse.json({ error: 'Falta proyecto, Test Plan o caso.' }, { status: 400 });
    await ensureSchema();
    const [draft] = await getDb().select().from(testCaseDrafts).where(and(eq(testCaseDrafts.project, project), eq(testCaseDrafts.id, draftId)));
    if (!draft) return NextResponse.json({ error: 'No se encontró el caso de prueba.' }, { status: 404 });
    if (draft.status === 'published') return NextResponse.json({ error: 'Este caso ya fue publicado en Azure DevOps.' }, { status: 409 });
    const context = await resolveProjectContext(project), requirements = await getProjectRequirements(context);
    const requirement = requirements.requirements.find(item => item.id === draft.requirementId);
    if (!requirement) return NextResponse.json({ error: `No se encontró la HU ${draft.requirementId}.` }, { status: 404 });
    const published = await publishDraftTestCase(project, planId, {
      title: draft.title, requirementId: draft.requirementId, caseType: draft.caseType,
      preconditions: draft.preconditions, steps: JSON.parse(draft.steps), expectedResult: draft.expectedResult,
      configurations: JSON.parse(draft.configurations), automationReason: draft.automationReason,
    }, requirement);
    await getDb().update(testCaseDrafts).set({ status: 'published', updatedAt: new Date().toISOString() }).where(eq(testCaseDrafts.id, draft.id));
    return NextResponse.json({ ...published, status: 'published' }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No fue posible publicar el Test Case.' }, { status: 500 });
  }
}
