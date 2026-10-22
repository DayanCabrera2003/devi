// Archivos de texto que se importan con `with { type: "text" }` (Bun los incrusta también en el binario).
declare module "*.md" {
  const text: string;
  export default text;
}
