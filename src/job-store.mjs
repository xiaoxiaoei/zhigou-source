import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const SAFE_JOB_ID = /^[a-zA-Z0-9-]{8,80}$/;

function jobTimestamp(job) {
  const value = Date.parse(job?.updatedAt || job?.createdAt || "");
  return Number.isFinite(value) ? value : 0;
}

function interruptedProgress(now, interruption = {}) {
  return {
    at: now,
    phase: "interrupted",
    title: interruption.title || "分析因服务重启而中断",
    detail: interruption.detail || "已恢复重启前保存的阶段成果，可在资源工坊中继续使用或重新分析。",
  };
}

export class AnalysisJobStore {
  constructor({ directory, retentionMs = DEFAULT_RETENTION_MS, interruption = {} } = {}) {
    if (!directory) throw new Error("AnalysisJobStore requires a directory");
    this.directory = path.resolve(directory);
    this.retentionMs = retentionMs;
    this.interruption = interruption;
    this.pendingWrites = new Map();
  }

  filePath(jobId) {
    if (!SAFE_JOB_ID.test(String(jobId || ""))) throw new Error("Invalid analysis job id");
    return path.join(this.directory, `${jobId}.json`);
  }

  async init() {
    await fs.mkdir(this.directory, { recursive: true });
    const names = await fs.readdir(this.directory);
    const nowMs = Date.now();
    const restored = [];

    for (const name of names.filter((item) => item.endsWith(".json"))) {
      const file = path.join(this.directory, name);
      try {
        const job = JSON.parse(await fs.readFile(file, "utf8"));
        if (!job?.id || !SAFE_JOB_ID.test(String(job.id)) || name !== `${job.id}.json`) continue;
        if (this.retentionMs > 0 && nowMs - jobTimestamp(job) > this.retentionMs) {
          await fs.rm(file, { force: true });
          continue;
        }
        if (job.state === "running") {
          const now = new Date().toISOString();
          const progress = interruptedProgress(now, this.interruption);
          job.state = "failed";
          job.updatedAt = now;
          job.progress = progress;
          job.error = {
            code: this.interruption.code || "ANALYSIS_INTERRUPTED",
            message: this.interruption.message || "本地服务在分析过程中重启，已恢复重启前保存的中间成果。",
            status: 503,
            recovery: this.interruption.recovery,
          };
          job.events = [...(Array.isArray(job.events) ? job.events : []), progress].slice(-60);
          await this.save(job);
        }
        restored.push(job);
      } catch (error) {
        console.warn(`跳过无法恢复的分析任务 ${name}: ${error.message}`);
      }
    }
    return restored;
  }

  async save(job) {
    const file = this.filePath(job?.id);
    const updatedAt = new Date().toISOString();
    job.updatedAt = updatedAt;
    const content = `${JSON.stringify(job)}\n`;
    const write = (this.pendingWrites.get(file) || Promise.resolve()).catch(()=>{}).then(async()=>{
      await fs.mkdir(this.directory, { recursive: true });
      const temporary = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
      await fs.writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
      await fs.rename(temporary, file);
    });
    this.pendingWrites.set(file, write);
    try { await write; } finally { if(this.pendingWrites.get(file)===write)this.pendingWrites.delete(file); }
  }

  async remove(jobId) {
    await fs.rm(this.filePath(jobId), { force: true });
  }
}
