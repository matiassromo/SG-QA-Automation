import OpenAI from 'openai';
import { AiProvider } from './aiProvider';

export class OpenAiProvider implements AiProvider {
  private client: OpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error(
        'Falta OPENAI_API_KEY en las variables de entorno'
      );
    }

    this.client = new OpenAI({
      apiKey,
    });
  }

  async generate(prompt: string): Promise<string> {
    const response = await this.client.responses.create({
      model: process.env.OPENAI_MODEL ?? 'gpt-5.6-mini',
      input: prompt,
    });

    return response.output_text;
  }
}