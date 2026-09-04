import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** Exercise drawing and rendering locally without calling a model. */
export async function runDemo(destinationPath?: string): Promise<string> {
  const root = resolve(import.meta.dir, '../..');
  const destination = resolve(destinationPath ?? join(root, '.codedraw', 'demo-bun'));
  await mkdir(destination, { recursive: true });
  const drawing = join(destination, 'draw.ts');
  await Bun.write(drawing, Bun.file(join(root, 'runtime', 'templates', 'draw.example.ts')));
  for (const args of [
    [drawing],
    [join(root, 'runtime', 'cli', 'render.ts'), join(destination, 'asset.svg'),
      join(destination, 'preview.png'), join(destination, 'render.json')],
  ]) {
    const result = Bun.spawnSync({
      cmd: [process.execPath, ...args],
      cwd: destination,
      stdout: 'inherit',
      stderr: 'inherit',
    });
    if (!result.success) throw new Error(`Offline demo failed with exit code ${result.exitCode}`);
  }
  return destination;
}

if (import.meta.main) {
  try {
    if (Bun.argv.length > 3) throw new Error('Usage: bun runtime/cli/demo.ts [output-directory]');
    const directory = await runDemo(Bun.argv[2]);
    console.log(JSON.stringify({ kind: 'offline_demo', modelCalls: 0, directory }));
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
