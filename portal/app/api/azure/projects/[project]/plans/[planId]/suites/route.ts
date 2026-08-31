import { NextResponse } from 'next/server';
import { ensureRequirementSuites, listSuites } from '@/lib/azure-devops';

export async function GET(_request: Request, context: { params: Promise<{ project: string; planId: string }> }) {
  try { const { project, planId } = await context.params; return NextResponse.json({ suites: await listSuites(decodeURIComponent(project), Number(planId)) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Error consultando suites.' }, { status: 500 }); }
}

export async function POST(request: Request, context: { params: Promise<{ project: string; planId: string }> }) {
  try {
    const { project, planId } = await context.params;
    const body = await request.json() as { parentSuiteId?: number; requirements?: Array<{ id: number; title: string }> };
    const parentSuiteId = Number(body.parentSuiteId);
    const requirements = (body.requirements ?? []).filter(item => Number(item.id) > 0 && String(item.title ?? '').trim());
    if (!parentSuiteId || !requirements.length) {
      return NextResponse.json({ error: 'Falta la suite raíz o las HUs seleccionadas.' }, { status: 400 });
    }
    const result = await ensureRequirementSuites(decodeURIComponent(project), Number(planId), parentSuiteId, requirements);
    return NextResponse.json(result, { status: result.createdIds.length ? 201 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No fue posible preparar las suites.' }, { status: 500 });
  }
}
