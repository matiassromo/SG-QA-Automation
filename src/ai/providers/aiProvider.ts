export interface AiProvider {
  generate(prompt: string): Promise<string>;
}