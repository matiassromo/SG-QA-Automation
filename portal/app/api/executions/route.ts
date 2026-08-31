import { NextResponse } from 'next/server';

import { getChatGPTUser } from '@/app/chatgpt-auth';
import { ensureSchema, getDb } from '@/db';
import { executionRequests } from '@/db/schema';

const allowedConfigurations = new Set(['Chrome', 'Android', 'iOS']);

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const body = await request.json() as Record<string, unknown>;
  const planId = Number(body.planId);
  const suiteId = Number(body.suiteId);
  const project = String(body.project ?? '').trim();
  const configuration = String(body.configuration ?? '').trim();
  if (!project || !Number.isInteger(planId) || !Number.isInteger(suiteId) ||
      !allowedConfigurations.has(configuration)) {
    return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 });
  }

  await ensureSchema();
  const [created] = await getDb().insert(executionRequests).values({
    requestedBy: user.email,
    project,
    planId,
    suiteId,
    configuration,
    status: 'queued',
    createdAt: new Date().toISOString(),
  }).returning();

  return NextResponse.json({
    id: created.id,
    status: created.status,
    message: 'Solicitud registrada; pendiente de asignación al runner.',
  }, { status: 201 });
}
