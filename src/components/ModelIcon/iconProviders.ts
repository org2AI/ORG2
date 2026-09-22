/**
 * Icon provider registry: the brand union, each brand's glyph source, and the
 * provider lists derived from them. A new brand is added here; map model types
 * to it in `modelTypeIcons.ts` and model names in `modelNameIcons.ts`.
 */
import type { FC, SVGProps } from "react";

import AiderIcon from "@src/assets/modelIcons/aider.svg?url";
import AiHubMixIcon from "@src/assets/modelIcons/aihubmix.svg?url";
import AmpIcon from "@src/assets/modelIcons/amp.svg?url";
import AntigravityIcon from "@src/assets/modelIcons/antigravity.svg?url";
import AtlasCloudIcon from "@src/assets/modelIcons/atlascloud.svg";
import AugmentIcon from "@src/assets/modelIcons/augment.svg";
import AutoHandIcon from "@src/assets/modelIcons/autohand.svg";
import AWSIcon from "@src/assets/modelIcons/aws.svg";
import AzureIcon from "@src/assets/modelIcons/azure.svg?url";
import BaichuanIcon from "@src/assets/modelIcons/baichuan.svg?url";
import ByteDanceIcon from "@src/assets/modelIcons/bytedance.svg?url";
import CherryInIcon from "@src/assets/modelIcons/cherryin.svg?url";
import ClaudeIcon from "@src/assets/modelIcons/claude.svg?url";
import ClineIcon from "@src/assets/modelIcons/cline.svg";
import CohereIcon from "@src/assets/modelIcons/cohere.svg?url";
import ContinueIcon from "@src/assets/modelIcons/continue.svg";
import CopilotIcon from "@src/assets/modelIcons/copilot.svg";
import CursorIcon from "@src/assets/modelIcons/cursor.svg";
import CustomGatewayIcon from "@src/assets/modelIcons/custom.svg";
import DeepSeekIcon from "@src/assets/modelIcons/deepseek.svg?url";
import DevinIcon from "@src/assets/modelIcons/devin.svg?url";
import DoubaoIcon from "@src/assets/modelIcons/doubao.svg?url";
import DroidIcon from "@src/assets/modelIcons/droid.svg";
import GeminiIcon from "@src/assets/modelIcons/gemini";
import GooseIcon from "@src/assets/modelIcons/goose.svg";
import GrokIcon from "@src/assets/modelIcons/grok.svg";
import GroqIcon from "@src/assets/modelIcons/groq.svg";
import HermesIcon from "@src/assets/modelIcons/hermes.svg";
import HunyuanIcon from "@src/assets/modelIcons/hunyuan.svg?url";
import InfinityAgentIcon from "@src/assets/modelIcons/infinity-agent.svg";
import KiloIcon from "@src/assets/modelIcons/kilo.svg";
import KimiIcon from "@src/assets/modelIcons/kimi.svg?url";
import KiroIcon from "@src/assets/modelIcons/kiro.svg?url";
import LlamaCppIcon from "@src/assets/modelIcons/llama-cpp.svg?url";
import LmStudioIcon from "@src/assets/modelIcons/lmstudio.svg";
import LongCatIcon from "@src/assets/modelIcons/longcat.svg";
import MetaAiIcon from "@src/assets/modelIcons/meta-ai.svg?url";
import MetaIcon from "@src/assets/modelIcons/meta.svg?url";
import MinimaxIcon from "@src/assets/modelIcons/minimax.svg?url";
import MistralIcon from "@src/assets/modelIcons/mistral.svg?url";
import ModelScopeIcon from "@src/assets/modelIcons/modelscope.svg?url";
import NvidiaIcon from "@src/assets/modelIcons/nvidia.svg?url";
import OllamaIcon from "@src/assets/modelIcons/ollama.svg";
import OmpIcon from "@src/assets/modelIcons/omp.svg?url";
import OpenAIIcon from "@src/assets/modelIcons/openai.svg";
import OpenClawIcon from "@src/assets/modelIcons/openclaw.svg?url";
import OpenCodeIcon from "@src/assets/modelIcons/opencode.svg";
import OpenRouterIcon from "@src/assets/modelIcons/openrouter.svg";
import OrgiiIcon from "@src/assets/modelIcons/org2-session.svg?url";
import PerplexityIcon from "@src/assets/modelIcons/perplexity.svg?url";
import PiIcon from "@src/assets/modelIcons/pi.svg?url";
import QoderIcon from "@src/assets/modelIcons/qoder.svg";
import QwenIcon from "@src/assets/modelIcons/qwen.svg?url";
import RovoIcon from "@src/assets/modelIcons/rovo.svg?url";
import SiliconFlowIcon from "@src/assets/modelIcons/siliconflow.svg?url";
import TraeIcon from "@src/assets/modelIcons/trae.svg";
import VllmIcon from "@src/assets/modelIcons/vllm.svg?url";
import VolcengineIcon from "@src/assets/modelIcons/volcengine.svg?url";
import WarpIcon from "@src/assets/modelIcons/warp.svg";
import WindsurfIcon from "@src/assets/modelIcons/windsurf.svg";
import WorkBuddyIcon from "@src/assets/modelIcons/workbuddy.svg?url";
import XaiIcon from "@src/assets/modelIcons/xai.svg";
import XiaomiIcon from "@src/assets/modelIcons/xiaomi.svg?url";
import YiIcon from "@src/assets/modelIcons/yi.svg";
import ZcodeIcon from "@src/assets/modelIcons/zcode.svg";
import ZenMuxIcon from "@src/assets/modelIcons/zenmux.svg";
import ZhipuIcon from "@src/assets/modelIcons/zhipu.svg?url";

// ============================================
// Types
// ============================================

/**
 * Icon provider — short brand name for icon lookup.
 *
 * This is a UI/display layer type that maps from business types
 * (`ModelType`, model names) to brand icons.
 */
export type IconProvider =
  | "openai"
  | "atlascloud"
  | "codex"
  | "aws"
  | "azure"
  | "claude"
  | "claude_code"
  | "copilot"
  | "cursor"
  | "windsurf"
  | "trae"
  | "workbuddy"
  | "warp"
  | "amp"
  | "devin"
  | "rovo"
  | "hermes"
  | "openclaw"
  | "aug"
  | "codebuff"
  | "qwen_code"
  | "mimo_code"
  | "antigravity"
  | "continue_cli"
  | "droid"
  | "mistral_vibe"
  | "autohand"
  | "omp"
  | "pi"
  | "kilo"
  | "gemini"
  | "grok"
  | "xai"
  | "groq"
  | "cohere"
  | "deepseek"
  | "mistral"
  | "qwen"
  | "meta"
  | "meta_ai"
  | "nvidia"
  | "perplexity"
  | "kiro"
  | "kimi"
  | "hunyuan"
  | "ollama"
  | "lm_studio"
  | "llamacpp"
  | "bytedance"
  | "volcengine"
  | "xiaomi"
  | "yi"
  | "zhipu"
  | "zcode"
  | "qoder"
  | "baichuan"
  | "minimax"
  | "longcat"
  | "siliconflow"
  | "modelscope"
  | "aihubmix"
  | "cherryin"
  | "custom"
  | "doubao"
  | "openrouter"
  | "zenmux"
  | "vllm"
  | "orgii"
  // Inactive agents (kept for future use)
  | "aider"
  | "cline"
  | "goose"
  | "opencode"
  | "unknown";

// ============================================
// Icon Map
// ============================================

/**
 * A provider glyph is either a URL to brand artwork with its own palette,
 * drawn through `<img>` so it costs no JS module, or, for marks authored in
 * `currentColor`, the svgr component that inherits the surrounding text color.
 * `config.test.ts` checks each import against the SVG's own content.
 */
export type ModelIconSource = string | FC<SVGProps<SVGSVGElement>>;

/** Maps icon providers to their glyph source (asset URL or svgr component) */
export const ICON_MAP: Record<IconProvider, ModelIconSource | undefined> = {
  // CLI agents (active)
  cursor: CursorIcon,
  windsurf: WindsurfIcon,
  trae: TraeIcon,
  workbuddy: WorkBuddyIcon,
  warp: WarpIcon,
  claude_code: ClaudeIcon,
  copilot: CopilotIcon,
  gemini: GeminiIcon,
  kiro: KiroIcon,
  // OpenAI-related
  openai: OpenAIIcon,
  atlascloud: AtlasCloudIcon,
  codex: OpenAIIcon,
  // Anthropic
  claude: ClaudeIcon,
  // ORGII
  orgii: OrgiiIcon,
  // API providers
  aws: AWSIcon,
  azure: AzureIcon,
  cohere: CohereIcon,
  deepseek: DeepSeekIcon,
  grok: GrokIcon,
  xai: XaiIcon,
  groq: GroqIcon,
  mistral: MistralIcon,
  qwen: QwenIcon,
  meta: MetaIcon,
  meta_ai: MetaAiIcon,
  nvidia: NvidiaIcon,
  perplexity: PerplexityIcon,
  kimi: KimiIcon,
  hunyuan: HunyuanIcon,
  ollama: OllamaIcon,
  lm_studio: LmStudioIcon,
  llamacpp: LlamaCppIcon,
  bytedance: ByteDanceIcon,
  volcengine: VolcengineIcon,
  xiaomi: XiaomiIcon,
  yi: YiIcon,
  zhipu: ZhipuIcon,
  zcode: ZcodeIcon,
  qoder: QoderIcon,
  baichuan: BaichuanIcon,
  minimax: MinimaxIcon,
  longcat: LongCatIcon,
  siliconflow: SiliconFlowIcon,
  modelscope: ModelScopeIcon,
  aihubmix: AiHubMixIcon,
  cherryin: CherryInIcon,
  custom: CustomGatewayIcon,
  doubao: DoubaoIcon,
  openrouter: OpenRouterIcon,
  zenmux: ZenMuxIcon,
  vllm: VllmIcon,
  // Active agent
  opencode: OpenCodeIcon,
  // Inactive agents (kept for future use)
  aider: AiderIcon,
  cline: ClineIcon,
  goose: GooseIcon,
  // Extended CLI agents — lobehub icons where available, infinity fallback otherwise
  amp: AmpIcon,
  devin: DevinIcon,
  rovo: RovoIcon,
  hermes: HermesIcon,
  openclaw: OpenClawIcon,
  aug: AugmentIcon,
  codebuff: InfinityAgentIcon,
  qwen_code: QwenIcon,
  mimo_code: XiaomiIcon,
  antigravity: AntigravityIcon,
  continue_cli: ContinueIcon,
  droid: DroidIcon,
  mistral_vibe: MistralIcon,
  autohand: AutoHandIcon,
  omp: OmpIcon,
  pi: PiIcon,
  kilo: KiloIcon,
  // Fallback
  unknown: undefined,
};

/** Active icon providers available for user selection (excludes unknown + inactive agents) */
export const SELECTABLE_ICON_PROVIDERS: IconProvider[] = [
  "openai",
  "atlascloud",
  "claude",
  "claude_code",
  "gemini",
  "deepseek",
  "cursor",
  "copilot",
  "kiro",
  "codex",
  "grok",
  "groq",
  "cohere",
  "mistral",
  "qwen",
  "meta",
  "meta_ai",
  "nvidia",
  "perplexity",
  "kimi",
  "hunyuan",
  "ollama",
  "lm_studio",
  "llamacpp",
  "aws",
  "azure",
  "bytedance",
  "volcengine",
  "xiaomi",
  "yi",
  "zhipu",
  "zcode",
  "qoder",
  "baichuan",
  "minimax",
  "longcat",
  "siliconflow",
  "modelscope",
  "aihubmix",
  "cherryin",
  "custom",
  "doubao",
  "openrouter",
  "zenmux",
  "vllm",
  "orgii",
  "opencode",
];

/**
 * ORGII orchestrator + CLI coding-agent brands — excluded from custom model icon
 * picker (only API / model-hosting providers).
 */
const EXCLUDED_MODEL_ALIAS_ICON_PROVIDER: ReadonlySet<IconProvider> = new Set([
  "orgii",
  "cursor",
  "claude_code",
  "copilot",
  "kiro",
  "codex",
  "opencode",
]);

/** Model/API provider icons for KeyVault custom model table (no ORGII, no CLI agents). */
export const MODEL_PROVIDER_ICON_PROVIDERS: IconProvider[] =
  SELECTABLE_ICON_PROVIDERS.filter(
    (provider) => !EXCLUDED_MODEL_ALIAS_ICON_PROVIDER.has(provider)
  );

// ============================================
// Theming
// ============================================

/**
 * Icons that use fill="currentColor" and should respond to text color classes.
 * Brand-colored icons have their colors baked in and should NOT be themed.
 */
export const THEMEABLE_ICONS = new Set<IconProvider>([
  "unknown",
  "openai",
  "codex",
  "aws",
  "cursor",
  "copilot",
  "grok",
  "xai",
  "groq",
  "openrouter",
  "zenmux",
  "custom",
  "yi",
  "zcode",
  "orgii",
  // Inactive agents that use currentColor
  "goose",
  "cline",
  "opencode",
  "kimi",
  // Extended CLI agents using monochrome/currentColor icons.
  "codebuff",
  "qwen_code",
  "mimo_code",
  "mistral_vibe",
  "autohand",
]);
