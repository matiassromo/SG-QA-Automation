import { NextResponse } from 'next/server';
import { downloadWorkItemAttachment } from '@/lib/azure-devops';

export async function GET(request: Request, context: { params: Promise<{ project: string; attachmentId: string }> }) {
  try {
    const { project, attachmentId } = await context.params;
    const attachment = await downloadWorkItemAttachment(decodeURIComponent(project), attachmentId);
    const requestedName = new URL(request.url).searchParams.get('name') ?? `attachment-${attachmentId}`;
    const safeName = requestedName.replace(/[\r\n"\\/]/g, '_').slice(0, 180);
    return new NextResponse(attachment.data, { headers: {
      'Content-Type': attachment.contentType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`,
      'Cache-Control': 'no-store',
    } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No fue posible descargar el adjunto.' }, { status: 500 });
  }
}
