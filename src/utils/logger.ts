import pc from "picocolors";

const CATEGORY_ICONS: Record<string, string> = {
  cabalspy: "📡",
  executor: "💰",
  engine: "⚙️",
  price: "💵",
  jupiter: "🪐",
  telegram: "📱",
  store: "💾",
  bot: "🤖",
  pipeline: "🔄",
  pumpdev: "🔌",
  pumpapi: "🔌",
};

function stamp(): string {
  return pc.dim(new Date().toLocaleTimeString());
}

function icon(cat: string): string {
  return CATEGORY_ICONS[cat] ?? "•";
}

export const log = {
  info(category: string, message: string, ...args: unknown[]) {
    console.log(
      `${stamp()}  ${icon(category)} ${pc.cyan(category)} ${message}`,
      ...args,
    );
  },

  success(category: string, message: string, ...args: unknown[]) {
    console.log(
      `${stamp()}  ${icon(category)} ${pc.green(category)} ${pc.green(message)}`,
      ...args,
    );
  },

  warn(category: string, message: string, ...args: unknown[]) {
    console.warn(
      `${stamp()}  ${icon(category)} ${pc.yellow(category)} ${pc.yellow(message)}`,
      ...args,
    );
  },

  error(category: string, message: string, ...args: unknown[]) {
    console.error(
      `${stamp()}  ${icon(category)} ${pc.red(category)} ${pc.red(message)}`,
      ...args,
    );
  },

  dev(category: string, message: string, ...args: unknown[]) {
    if (process.env.DEBUG) {
      console.log(
        `${stamp()}  ${icon(category)} ${pc.dim(category)} ${pc.dim(message)}`,
        ...args,
      );
    }
  },

  divider() {
    console.log(pc.dim("─".repeat(50)));
  },
};
