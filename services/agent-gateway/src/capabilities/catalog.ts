export const CAPABILITY_CATALOG = [
  "session.validate",
  "session.start",
  "session.end",
  "session.status",
  "room.chat.send",
  "room.chat.shout",
  "room.chat.whisper",
  "room.user.movement",
  "room.user.expression",
  "room.settings.manage",
  "room.mod.kick",
  "room.mod.mute",
  "room.mod.ban",
  "room.rights.grant",
  "room.rights.revoke",
  "room.poll.manage",
  "room.poll.vote",
  "room.pet.manage",
  "room.furni.interact",
  "room.furni.manage",
  "room.trade.manage",
  "room.bot.manage",
  "room.queue.change",
  "workspace.read",
  "workspace.write"
] as const;

export type CapabilityName = (typeof CAPABILITY_CATALOG)[number];

export const DEFAULT_CAPABILITIES: CapabilityName[] = [...CAPABILITY_CATALOG];
