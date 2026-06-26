import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { ConsoleLog, LogLevel, LogCategory } from "@btstudio/bt-core";
import { newLogId, nowIso } from "@btstudio/bt-core";

export type LogFilter = "all" | LogLevel;

export const useConsoleStore = defineStore("console", () => {
  const logs = ref<ConsoleLog[]>([]);
  const filter = ref<LogFilter>("all");
  const height = ref(180);
  const collapsed = ref(false);

  function toggleCollapsed(): void {
    collapsed.value = !collapsed.value;
  }
  function setHeight(h: number): void {
    height.value = Math.min(600, Math.max(110, Math.round(h)));
  }

  const filtered = computed(() =>
    filter.value === "all" ? logs.value : logs.value.filter((l) => l.level === filter.value),
  );

  function unreadByLevel(level: LogLevel): number {
    return logs.value.filter((l) => l.level === level && !l.read).length;
  }

  const totalUnread = computed(() => logs.value.filter((l) => !l.read).length);

  function append(
    level: LogLevel,
    category: LogCategory,
    message: string,
    extra: Partial<ConsoleLog> = {},
  ): void {
    logs.value.unshift({
      logId: newLogId(),
      level,
      category,
      message,
      timestamp: nowIso(),
      read: false,
      ...extra,
    });
    if (logs.value.length > 1000) logs.value.length = 1000;
  }

  const info = (c: LogCategory, m: string, e?: Partial<ConsoleLog>) => append("info", c, m, e);
  const success = (c: LogCategory, m: string, e?: Partial<ConsoleLog>) => append("success", c, m, e);
  const warning = (c: LogCategory, m: string, e?: Partial<ConsoleLog>) => append("warning", c, m, e);
  const error = (c: LogCategory, m: string, e?: Partial<ConsoleLog>) => append("error", c, m, e);

  function markRead(): void {
    for (const l of filtered.value) l.read = true;
  }

  /** 标记单条已读(点击某条日志时调用,使其未读计数减一)。 */
  function markOneRead(logId: string): void {
    const l = logs.value.find((x) => x.logId === logId);
    if (l && !l.read) l.read = true;
  }

  /** 标记某级别全部已读(点击该级别徽标/过滤按钮时清掉它的未读数)。 */
  function markLevelRead(level: LogLevel): void {
    for (const l of logs.value) if (l.level === level && !l.read) l.read = true;
  }

  function clear(): void {
    if (filter.value === "all") logs.value = [];
    else logs.value = logs.value.filter((l) => l.level !== filter.value);
  }

  function exportText(): string {
    const header = `# BT Studio 控制台日志导出  filter=${filter.value}  time=${nowIso()}\n`;
    const body = filtered.value
      .map((l) => `[${l.timestamp}] [${l.level}] [${l.category}] ${l.message}${l.detail ? "  | " + l.detail : ""}`)
      .join("\n");
    return header + body + "\n";
  }

  return {
    logs,
    filter,
    height,
    collapsed,
    toggleCollapsed,
    setHeight,
    filtered,
    totalUnread,
    unreadByLevel,
    append,
    info,
    success,
    warning,
    error,
    markRead,
    markOneRead,
    markLevelRead,
    clear,
    exportText,
  };
});
