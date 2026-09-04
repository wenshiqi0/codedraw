import { renderSvg } from '../render/svg.ts';

if (import.meta.main) {
  try {
    const args = Bun.argv.slice(2);
    const [inputPath, pngPath, reportPath] = args;
    if (args.length !== 3 || !inputPath || !pngPath || !reportPath) {
      throw new Error('Usage: bun runtime/cli/render.ts <asset.svg> <preview.png> <render.json>');
    }
    const report = await renderSvg(inputPath, pngPath, reportPath);
    console.log(JSON.stringify(report));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`render: ${message.split('\n')[0]!.slice(0, 240)}`);
    process.exitCode = 1;
  }
}
