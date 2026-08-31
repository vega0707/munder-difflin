import { draftBuiltinReply } from '../shared/builtinAgent';
import type { HiveManager } from './hive';
import type { SeatOccupancy } from '../shared/seats';

/**
 * Polls builtin-provider agents and answers hive mail on disk. No PTY, no
 * hosted model — this is the product's spare worker when a CLI is missing.
 */
export class BuiltinAgentHost {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(private opts: {
    listHives: () => HiveManager[];
    occupancy: (projectId: string, agentId: string) => SeatOccupancy | Promise<SeatOccupancy>;
    intervalMs?: number;
  }) {}

  start(): void {
    if (this.timer) return;
    const ms = this.opts.intervalMs ?? 2000;
    this.timer = setInterval(() => { void this.tick(); }, ms);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<number> {
    if (this.ticking) return 0;
    this.ticking = true;
    let handled = 0;
    try {
      for (const hive of this.opts.listHives()) {
        let reg: ReturnType<HiveManager['registry']>;
        try { reg = hive.registry(); } catch { continue; }
        for (const [id, agent] of Object.entries(reg.agents)) {
          if (agent.provider !== 'builtin' || agent.archived) continue;
          const occ = await this.opts.occupancy(hive.projectId, id);
          if (occ === 'remote') continue;
          const mail = hive.inbox(id);
          for (const msg of mail) {
            const reply = draftBuiltinReply(msg, { id, name: agent.name });
            if (reply) {
              hive.send({
                to: reply.to,
                act: reply.act,
                subject: reply.subject,
                body: reply.body,
                in_reply_to: reply.in_reply_to,
                conversation: reply.conversation,
                requires_reply: false
              }, id);
            }
            hive.archiveInbox(id, msg.id);
            handled++;
          }
        }
      }
    } finally {
      this.ticking = false;
    }
    return handled;
  }
}
