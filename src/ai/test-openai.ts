import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',
    input: 'Responde únicamente con la palabra: conectado',
  });

  console.log('\nRespuesta de OpenAI:\n');
  console.log(response.output_text);
}

main().catch((error) => {
  console.error('\nError:');
  console.error(error);
});