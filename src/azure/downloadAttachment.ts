import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import dotenv from 'dotenv';

dotenv.config();

const pat = process.env.AZURE_DEVOPS_PAT!;

async function downloadAndReadDocx(
  attachmentUrl: string,
  fileName: string
) {
  const auth = Buffer.from(`:${pat}`).toString('base64');

  const response = await fetch(
    `${attachmentUrl}?download=true`,
    {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(
      `Error descargando adjunto: ${response.status} ${response.statusText}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const downloadsDir = path.resolve('tmp', 'rfc');
  fs.mkdirSync(downloadsDir, { recursive: true });

  const filePath = path.join(downloadsDir, fileName);

  fs.writeFileSync(filePath, buffer);

  console.log(`RFC descargado en: ${filePath}`);

  const result = await mammoth.extractRawText({
    buffer,
  });

  console.log('\n===== TEXTO RFC =====\n');
  console.log(result.value);
}

downloadAndReadDocx(
  'https://dev.azure.com/SGAplicaciones/700b57fb-b876-4abd-a11b-0cd15a4fc4a1/_apis/wit/attachments/423d479d-4bb2-49c7-be69-eab453cf794c',
  'rfc-perfilamiento.docx'
).catch(error => {
  console.error(error);
});