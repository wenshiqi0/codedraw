# CodeDraw

用 TypeScript 绘制可编辑的视觉素材，在 Bun 上运行，由 Pi 生成绘图代码，再由外层观察者查看渲染结果并迭代。

适合图标、游戏道具和程序化矢量插画。每轮保留 `draw.ts`、SVG、PNG 预览与回执，便于调整参数、重绘和复用。

## 工作方式

CodeDraw 参考 Codeflow 的内外层分工与 `runtime/` 组织方式：

```text
用户需求
   ↓
外层观察者：整理 brief、查看图片、提出修改、决定验收
   │ exec / revise                         ↑ preview.png + receipt
   ↓                                       │
Bun Runtime → Pi 编写 draw.ts → Bun 执行 → SVG → PNG
   ↑
   └── accept → 校验产物哈希 → 最终 receipt
```

外层观察者可以是加载此 skill 的宿主模型，也可以是直接使用 CLI 的人。每次 `exec` 或 `revise` 执行一轮；外层根据预览决定下一步。渲染成功时进入 `awaiting_review`，只有观察者执行 `accept` 后才进入 `completed`。

Pi、绘图程序与渲染入口均由 Bun 执行。运行代码位于 `runtime/`，无需预编译。

## 成套素材的画风一致性

画风口径由使用方提供，使用方可以是用户、Codeflow 或其他宿主。提供参考图、已认可的素材或具体文字规范，并明确相关的配色、视角、比例、边缘处理、光照和显示尺寸。已有规范可以直接复用；缺失或冲突的口径由外层观察者反馈给使用方，补齐后再开始绘图。CodeDraw 不自行选定画风。[Brief 模板](assets/brief.template.md)列出了输入项。

制作整套游戏素材时，先按这个口径画一小组能放在同一场景中比较的样张，例如角色、家具和地面，并按游戏实际显示尺寸查看。样张符合口径后，把相关绘图规则与 TypeScript 函数作为共同基准，再展开后续素材。

每批都要与基准一起放入对比图或游戏场景中验收。图集格子齐全、物品可辨认和测试通过，都不能证明画面好看或画风统一。具体流程见[成套素材制作与验收](references/asset-sets.md)。

Runtime 支持 `--style style.json --asset-id ID`：固定风格锁、相邻手册与 SHA 校验过的参考 PNG，每轮向 Pi 注入同一份规则并附上图片。`--reference` 可单独附图；带参考图时会检查模型的图像能力。设置显示倍率后自动输出棋盘格、暗底的实际尺寸预览。`completed` 表示观察者提交了验收文本且产物哈希通过校验，整组质量仍由观察者判断。

使用 `codedraw sheet` 把基准与候选按各自显示倍率排在一起，查看后用 `accept --comparison` 将对照图和来源哈希纳入最终回执。完整选项、对照表格式与 HA 的 `art brief / sheet / frame` 接入见[生产输入与显示尺寸验收](references/production-inputs.md)。

## 快速开始

运行环境：macOS 或 Linux，Bun 1.3.14 或更高版本。Pi 是项目固定版本依赖，由 `bun install` 安装。

```bash
git clone https://github.com/wenshiqi0/codedraw.git
cd codedraw
bun install --frozen-lockfile
bun run demo
```

`demo` 使用仓库中的[确定性绘图示例](runtime/templates/draw.example.ts)，模型调用为 0。结果保存在：

```text
.codedraw/demo-bun/
  draw.ts       可编辑的 TypeScript 源码
  asset.svg     矢量素材
  preview.png   渲染预览
  render.json   尺寸、透明像素统计与哈希
```

打开 `preview.png` 即可查看结果。示例中的几何、配色和气泡位置均由 TypeScript 参数控制。

## 安装

### 作为宿主 skill

按宿主自身的 skill 安装或发现机制加载本仓库的 [SKILL.md](SKILL.md)，并保留完整目录结构。在实际安装目录执行 `bun install --frozen-lockfile`。

宿主需要能够读取 skill、执行本地 Bun 命令，并打开 PNG 预览。安装位置和注册方式遵循宿主的约定；CodeDraw 的运行入口和任务协议不依赖特定宿主。外层模型使用 `SKILL.md` 中的流程观察结果、反馈重绘并验收。

### 直接使用 CLI

在仓库内运行：

```bash
./runtime/bin/codedraw --help
```

也可以从其他工作目录通过仓库的绝对路径调用这个入口。`--output` 指向目标项目下的新任务目录，依赖与 runtime 仍从安装目录加载。

如需在任意目录使用 `codedraw` 命令，可参考 Codeflow，安装一个指向真实仓库入口的启动脚本。在仓库根目录执行以下命令；若已有同名命令，先检查它的用途再决定是否更新：

```bash
mkdir -p "$HOME/.local/bin"
printf '#!/bin/sh\nexec "%s/runtime/bin/codedraw" "$@"\n' "$PWD" > "$HOME/.local/bin/codedraw"
chmod 755 "$HOME/.local/bin/codedraw"
```

确保 `$HOME/.local/bin` 在 `PATH` 中。启动脚本引用当前仓库位置，移动仓库后需要更新该路径。

## 模型配置

真实绘图使用 Pi 中已经配置好的模型与认证。可以通过项目自带入口打开 Pi 进行配置：

```bash
./runtime/bin/pi
```

Pi 支持在交互界面使用 `/login`，也支持相应 provider 的环境变量。具体配置见 [Pi 文档](https://github.com/earendil-works/pi/tree/main/packages/coding-agent)。

CodeDraw 默认沿用 Pi 的模型配置；`exec --model <provider>/<model>` 可覆盖当前任务的模型。凭证保留在 Pi 配置或环境变量中。

## 绘图与迭代

以下命令均从仓库根目录执行。使用全局启动脚本时，可将 `./runtime/bin/codedraw` 替换为 `codedraw`。

### 1. 准备需求并生成

Brief 描述主体、用途、尺寸、背景，以及使用方提供的画风口径、配色和可观察的验收要求。使用[输入模板](assets/brief.template.md)整理实际需求；下面的[药水道具示例](assets/brief.example.md)包含一份完整文字口径，仅用于演示：

```bash
./runtime/bin/codedraw exec assets/brief.example.md \
  --output .codedraw/potion \
  --max-rounds 3 \
  --timeout 300
```

`--output` 必须是尚不存在的目录。`--max-rounds` 包含首次生成，默认共 3 轮；`--timeout` 是每轮 Pi、代码执行和渲染合计的秒数，默认 300 秒。每轮会启动新的 Pi 会话，后续轮次带上原始需求、上一轮源码和本轮反馈。

项目已提供风格锁时，可增加 `--style path/to/style.json --asset-id interface.tag`；独立素材可增加 `--reference target.png --display-scale 0.5 --medium smooth`。使用参考图需要支持图像的 Pi 模型；像素素材用 `--medium pixel` 和整数倍率。每个任务固定输入快照，后续修改风格需要新建任务。

### 2. 查看结果

```bash
./runtime/bin/codedraw status .codedraw/potion
./runtime/bin/codedraw events .codedraw/potion --since 0
./runtime/bin/codedraw usage .codedraw/potion
```

按状态中的当前轮次，打开对应的 `rounds/NNN/preview.png`；第一轮是 `.codedraw/potion/rounds/001/preview.png`。设置显示倍率后还要打开同轮 `display.png`，按 1:1 屏幕像素查看。对照 brief 检查构图、轮廓、颜色、透明背景和目标显示尺寸下的辨识度。

事件以 NDJSON 输出；后续读取将最后一个事件的 `seq` 传给 `--since`。用量按任务和轮次汇总 calls、input、output、cache-read、cache-write、reasoning 和 total，缺失的 reasoning 为 `null`。这些数据覆盖内层 Pi 调用。

### 3. 反馈重绘

根据实际观察写反馈。例如确实发现高光遮住瓶身轮廓时：

```bash
printf '%s\n' '缩窄左侧高光，保留连续的瓶身轮廓；保持现有配色和透明背景。' > .codedraw/potion/feedback.txt
./runtime/bin/codedraw revise .codedraw/potion \
  --feedback .codedraw/potion/feedback.txt
```

新结果保存在下一轮目录中，先前的源码与回执保留。查看新预览，再决定继续修改或验收。

### 4. 验收

看过当前预览并确认满足 brief 后，创建 `.codedraw/potion/review.txt`，记录查看的图片、验收依据和结论，然后执行：

```bash
./runtime/bin/codedraw accept .codedraw/potion \
  --review .codedraw/potion/review.txt
```

Runtime 会复核源码、SVG、PNG 和渲染报告的哈希，保留候选回执，并写入任务根目录的最终 `receipt.json`。

## 产物与当前边界

每个任务包含 `task.json`、`events.jsonl` 和 `rounds/NNN/`。每轮保存源码、素材、预览、技术报告与候选回执；验收后增加 review 和最终回执。约定将任务产物放在 `.codedraw/`，该目录已被 `.gitignore` 排除。

首版支持自包含 SVG 的形状、路径、渐变、遮罩和本地片段引用。SVG 最大 2 MiB，每个维度最大 4096 像素；文字需要转为路径。渲染报告只验证技术结果，视觉质量由外层观察者判断。

Pi 工具和生成的 TypeScript 以当前用户权限执行，工作目录约束不构成操作系统沙箱。运行时会记录能够捕获的失败与中断；重绘受轮次上限约束。

## 开发

```text
runtime/bin/                 Bun 启动入口
runtime/cli/                 任务、渲染与离线示例命令
runtime/lib/                 状态、进程、事件、用量和回执
runtime/render/              SVG 渲染与技术检查
runtime/templates/           TypeScript 绘图示例
tests/                       Bun 测试及模型响应 fixture
SKILL.md                     外层观察者操作流程
references/architecture.md   运行时与产物协议
```

```bash
bun run typecheck
bun test
bun run test:pi
```

`bun test` 验证任务协议和实际渲染，默认跳过 Pi 集成测试。`test:pi` 启动真实 Pi，连接本地 SSE 模拟模型，验证工具调用、绘图执行和验收协议；这项测试不评估真实模型的自主绘图质量。

详细约定见 [AGENTS.md](AGENTS.md) 和[架构说明](references/architecture.md)。
