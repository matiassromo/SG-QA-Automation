import { NextResponse } from 'next/server';
import { deleteTestPlan, updateTestPlan } from '@/lib/azure-devops';

type Context = { params: Promise<{ project: string; planId: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const { project, planId } = await context.params;
    const body = await request.json() as { name?: string; iteration?: string };
    const name = String(body.name ?? '').trim();
    const iteration = String(body.iteration ?? '').trim();
    if (!name || !iteration) return NextResponse.json({ error: 'Falta nombre o iteración.' }, { status: 400 });
    const plan = await updateTestPlan(decodeURIComponent(project), Number(planId), { name, iteration });
    return NextResponse.json({ plan });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No fue posible actualizar el Test Plan.' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const { project, planId } = await context.params;
    await deleteTestPlan(decodeURIComponent(project), Number(planId));
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No fue posible eliminar el Test Plan.' }, { status: 500 });
  }
}
