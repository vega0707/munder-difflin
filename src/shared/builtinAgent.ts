/**
 * Built-in office agent — fills a seat when the operator has no CLI of their
 * own. It drains hive inbox on disk (no PTY) and writes protocol-shaped replies.
 * This is a local runner, not a hosted model.
 */

import type { MessageAct } from './hiveMessageActs';

export interface BuiltinMail {
  id: string;
  from: string;
  to: string;
  act: MessageAct;
  subject: string;
  body: string;
  conversation?: string;
  requires_reply?: boolean;
}

export interface BuiltinReply {
  to: string;
  act: 'done' | 'inform';
  subject: string;
  body: string;
  in_reply_to: string;
  conversation?: string;
  requires_reply: false;
}

const REPLY_ACTS: ReadonlySet<string> = new Set(['request', 'query', 'propose']);

export function builtinShouldReply(act: string, requiresReply?: boolean): boolean {
  if (requiresReply === false) return false;
  if (requiresReply === true) return true;
  return REPLY_ACTS.has(act);
}

export function draftBuiltinReply(
  mail: BuiltinMail,
  agent: { id: string; name: string }
): BuiltinReply | null {
  if (!builtinShouldReply(mail.act, mail.requires_reply)) return null;
  const subject = mail.subject?.trim() || '(no subject)';
  return {
    to: mail.from,
    act: 'done',
    subject: `Re: ${subject}`,
    body: [
      `${agent.name} (${agent.id}) is the built-in office agent on this seat — there is no CLI session here.`,
      '',
      `I received your ${mail.act} and logged it. I cannot edit the repo or run tools.`,
      'If this needs real work, promote a CLI agent into the seat or route it to a floor that has one.',
      '',
      `Original: ${subject}`
    ].join('\n'),
    in_reply_to: mail.id,
    conversation: mail.conversation,
    requires_reply: false
  };
}

export function isBuiltinProvider(value: unknown): boolean {
  return value === 'builtin';
}
