import {z} from "zod";

import {ActionDefinition} from "./types.js";

const userIdSchema = z.number().int().positive();
const roomIdSchema = z.number().int().nonnegative();
const styleIdSchema = z.number().int().min(0).max(1000).default(0);
const tileCoordinateSchema = z.number().int().min(0).max(1024);

const chatBaseSchema = z.object({
  room_id: roomIdSchema,
  text: z.string().trim().min(1).max(300),
  style_id: styleIdSchema.optional()
});

const actionCatalog = [
  {
    id: "room.chat.send",
    title: "Send Room Chat",
    description: "Send a standard chat message to the active room session.",
    bridgeCommand: "room.sendChatMessage",
    inputSchema: chatBaseSchema,
    requiredCapabilities: ["room.chat.send"],
    minimumTrustTier: "external",
    risk: "low"
  },
  {
    id: "room.chat.shout",
    title: "Send Room Shout",
    description: "Broadcast a shout message to the active room session.",
    bridgeCommand: "room.sendShoutMessage",
    inputSchema: chatBaseSchema,
    requiredCapabilities: ["room.chat.shout"],
    minimumTrustTier: "external",
    risk: "low"
  },
  {
    id: "room.chat.whisper",
    title: "Send Whisper",
    description: "Send a private whisper to a room user.",
    bridgeCommand: "room.sendWhisperMessage",
    inputSchema: chatBaseSchema.extend({
      recipient_name: z.string().trim().min(1).max(64)
    }),
    requiredCapabilities: ["room.chat.whisper"],
    minimumTrustTier: "external",
    risk: "low"
  },
  {
    id: "room.user.typing",
    title: "Set Typing State",
    description: "Toggle typing indicator for the agent-controlled user.",
    bridgeCommand: "room.sendChatTypingMessage",
    inputSchema: z.object({
      room_id: roomIdSchema,
      is_typing: z.boolean()
    }),
    requiredCapabilities: ["room.chat.send"],
    minimumTrustTier: "external",
    risk: "low"
  },
  {
    id: "room.user.expression",
    title: "Set Avatar Expression",
    description: "Trigger avatar expression actions such as wave, laugh, idle.",
    bridgeCommand: "room.sendExpressionMessage",
    inputSchema: z.object({
      room_id: roomIdSchema,
      expression: z.number().int().min(0).max(1000)
    }),
    requiredCapabilities: ["room.user.expression"],
    minimumTrustTier: "external",
    risk: "low"
  },
  {
    id: "room.user.sign",
    title: "Show Hand Sign",
    description: "Display an in-room hand sign.",
    bridgeCommand: "room.sendSignMessage",
    inputSchema: z.object({
      room_id: roomIdSchema,
      sign: z.number().int().min(0).max(17)
    }),
    requiredCapabilities: ["room.user.expression"],
    minimumTrustTier: "external",
    risk: "low"
  },
  {
    id: "room.user.dance",
    title: "Set Dance",
    description: "Set current dance style.",
    bridgeCommand: "room.sendDanceMessage",
    inputSchema: z.object({
      room_id: roomIdSchema,
      dance_id: z.number().int().min(0).max(6)
    }),
    requiredCapabilities: ["room.user.expression"],
    minimumTrustTier: "external",
    risk: "low"
  },
  {
    id: "room.user.posture",
    title: "Set Posture",
    description: "Set the avatar posture code.",
    bridgeCommand: "room.sendPostureMessage",
    inputSchema: z.object({
      room_id: roomIdSchema,
      posture: z.number().int().min(0).max(100)
    }),
    requiredCapabilities: ["room.user.expression"],
    minimumTrustTier: "external",
    risk: "low"
  },
  {
    id: "room.settings.update_moodlight",
    title: "Update Moodlight",
    description: "Update room moodlight values and optionally apply immediately.",
    bridgeCommand: "room.updateMoodlightData",
    inputSchema: z.object({
      room_id: roomIdSchema,
      id: z.number().int().positive(),
      effect_id: z.number().int().min(0).max(255),
      color: z.number().int().min(0).max(0xffffff),
      brightness: z.number().int().min(0).max(255),
      apply: z.boolean()
    }),
    requiredCapabilities: ["room.settings.manage"],
    minimumTrustTier: "partner",
    risk: "medium"
  },
  {
    id: "room.settings.toggle_moodlight",
    title: "Toggle Moodlight",
    description: "Toggle moodlight on or off.",
    bridgeCommand: "room.toggleMoodlightState",
    inputSchema: z.object({
      room_id: roomIdSchema
    }),
    requiredCapabilities: ["room.settings.manage"],
    minimumTrustTier: "partner",
    risk: "medium"
  },
  {
    id: "room.user.walk_to_tile",
    title: "Walk To Tile",
    description: "Move agent avatar to a target room tile.",
    bridgeCommand: "room.walkToTile",
    inputSchema: z.object({
      room_id: roomIdSchema,
      x: tileCoordinateSchema,
      y: tileCoordinateSchema
    }),
    requiredCapabilities: ["room.user.movement"],
    minimumTrustTier: "external",
    risk: "low"
  },
  {
    id: "room.user.look_to",
    title: "Look To Direction",
    description: "Turn avatar direction in current room.",
    bridgeCommand: "room.lookToDirection",
    inputSchema: z.object({
      room_id: roomIdSchema,
      direction: z.number().int().min(0).max(7)
    }),
    requiredCapabilities: ["room.user.movement"],
    minimumTrustTier: "external",
    risk: "low"
  },
  {
    id: "room.user.kick",
    title: "Kick User",
    description: "Kick a user from the room.",
    bridgeCommand: "room.sendKickMessage",
    inputSchema: z.object({
      room_id: roomIdSchema,
      user_id: userIdSchema
    }),
    requiredCapabilities: ["room.mod.kick"],
    minimumTrustTier: "partner",
    risk: "high"
  },
  {
    id: "room.user.mute",
    title: "Mute User",
    description: "Mute a room user for a number of minutes.",
    bridgeCommand: "room.sendMuteMessage",
    inputSchema: z.object({
      room_id: roomIdSchema,
      user_id: userIdSchema,
      minutes: z.number().int().min(1).max(10080)
    }),
    requiredCapabilities: ["room.mod.mute"],
    minimumTrustTier: "partner",
    risk: "high"
  },
  {
    id: "room.user.ban",
    title: "Ban User",
    description: "Ban a user from a room using emulator-supported ban type.",
    bridgeCommand: "room.sendBanMessage",
    inputSchema: z.object({
      room_id: roomIdSchema,
      user_id: userIdSchema,
      ban_type: z.string().trim().min(1).max(64)
    }),
    requiredCapabilities: ["room.mod.ban"],
    minimumTrustTier: "internal",
    risk: "critical"
  },
  {
    id: "room.mod.alert_user",
    title: "Alert User",
    description: "Send moderation alert message to user.",
    bridgeCommand: "room.sendModeratorAlertMessage",
    inputSchema: z.object({
      room_id: roomIdSchema,
      user_id: userIdSchema,
      text: z.string().trim().min(1).max(300),
      category_id: z.number().int().min(-999).max(9999).default(-999)
    }),
    requiredCapabilities: ["room.mod.kick"],
    minimumTrustTier: "partner",
    risk: "medium"
  },
  {
    id: "room.mod.message_user",
    title: "Message User",
    description: "Send direct moderation message to user.",
    bridgeCommand: "room.sendModeratorMessage",
    inputSchema: z.object({
      room_id: roomIdSchema,
      user_id: userIdSchema,
      text: z.string().trim().min(1).max(300),
      category_id: z.number().int().min(-999).max(9999).default(-999)
    }),
    requiredCapabilities: ["room.mod.kick"],
    minimumTrustTier: "partner",
    risk: "medium"
  },
  {
    id: "room.rights.grant",
    title: "Grant Rights",
    description: "Grant room rights to a user.",
    bridgeCommand: "room.sendGiveRightsMessage",
    inputSchema: z.object({
      room_id: roomIdSchema,
      user_id: userIdSchema
    }),
    requiredCapabilities: ["room.rights.grant"],
    minimumTrustTier: "partner",
    risk: "high"
  },
  {
    id: "room.rights.revoke",
    title: "Revoke Rights",
    description: "Revoke room rights from a user.",
    bridgeCommand: "room.sendTakeRightsMessage",
    inputSchema: z.object({
      room_id: roomIdSchema,
      user_id: userIdSchema
    }),
    requiredCapabilities: ["room.rights.revoke"],
    minimumTrustTier: "partner",
    risk: "high",
    reversibleBy: "room.rights.grant"
  },
  {
    id: "room.poll.start",
    title: "Start Poll",
    description: "Start an in-room poll flow.",
    bridgeCommand: "room.sendPollStartMessage",
    inputSchema: z.object({
      room_id: roomIdSchema,
      poll_id: z.number().int().positive()
    }),
    requiredCapabilities: ["room.poll.manage"],
    minimumTrustTier: "partner",
    risk: "medium"
  },
  {
    id: "room.poll.reject",
    title: "Reject Poll",
    description: "Reject an in-room poll prompt.",
    bridgeCommand: "room.sendPollRejectMessage",
    inputSchema: z.object({
      room_id: roomIdSchema,
      poll_id: z.number().int().positive()
    }),
    requiredCapabilities: ["room.poll.manage"],
    minimumTrustTier: "external",
    risk: "low"
  },
  {
    id: "room.poll.answer",
    title: "Answer Poll",
    description: "Submit poll answers.",
    bridgeCommand: "room.sendPollAnswerMessage",
    inputSchema: z.object({
      room_id: roomIdSchema,
      poll_id: z.number().int().positive(),
      question_id: z.number().int().min(0),
      answers: z.array(z.string().trim().max(200)).min(1).max(30)
    }),
    requiredCapabilities: ["room.poll.vote"],
    minimumTrustTier: "external",
    risk: "low"
  },
  {
    id: "room.poll.counter_vote",
    title: "Vote Poll Counter",
    description: "Vote in a poll counter flow.",
    bridgeCommand: "room.votePoll",
    inputSchema: z.object({
      room_id: roomIdSchema,
      counter: z.number().int().min(0).max(99999)
    }),
    requiredCapabilities: ["room.poll.vote"],
    minimumTrustTier: "external",
    risk: "low"
  },
  {
    id: "room.pet.pickup",
    title: "Pickup Pet",
    description: "Pickup a room pet.",
    bridgeCommand: "room.pickupPet",
    inputSchema: z.object({
      room_id: roomIdSchema,
      pet_id: z.number().int().positive()
    }),
    requiredCapabilities: ["room.pet.manage"],
    minimumTrustTier: "partner",
    risk: "medium"
  },
  {
    id: "room.pet.mount",
    title: "Mount Pet",
    description: "Mount a rideable pet.",
    bridgeCommand: "room.mountPet",
    inputSchema: z.object({
      room_id: roomIdSchema,
      pet_id: z.number().int().positive()
    }),
    requiredCapabilities: ["room.pet.manage"],
    minimumTrustTier: "external",
    risk: "low"
  },
  {
    id: "room.pet.dismount",
    title: "Dismount Pet",
    description: "Dismount a rideable pet.",
    bridgeCommand: "room.dismountPet",
    inputSchema: z.object({
      room_id: roomIdSchema,
      pet_id: z.number().int().positive()
    }),
    requiredCapabilities: ["room.pet.manage"],
    minimumTrustTier: "external",
    risk: "low"
  },
  {
    id: "room.pet.toggle_breeding",
    title: "Toggle Pet Breeding",
    description: "Toggle breeding mode for a pet.",
    bridgeCommand: "room.togglePetBreeding",
    inputSchema: z.object({
      room_id: roomIdSchema,
      pet_id: z.number().int().positive()
    }),
    requiredCapabilities: ["room.pet.manage"],
    minimumTrustTier: "partner",
    risk: "medium"
  },
  {
    id: "room.pet.toggle_riding",
    title: "Toggle Pet Riding",
    description: "Toggle riding permission for a pet.",
    bridgeCommand: "room.togglePetRiding",
    inputSchema: z.object({
      room_id: roomIdSchema,
      pet_id: z.number().int().positive()
    }),
    requiredCapabilities: ["room.pet.manage"],
    minimumTrustTier: "partner",
    risk: "medium"
  },
  {
    id: "room.pet.use_product",
    title: "Use Pet Product",
    description: "Use consumable product on a pet.",
    bridgeCommand: "room.usePetProduct",
    inputSchema: z.object({
      room_id: roomIdSchema,
      item_id: z.number().int().positive(),
      pet_id: z.number().int().positive()
    }),
    requiredCapabilities: ["room.pet.manage"],
    minimumTrustTier: "partner",
    risk: "medium"
  },
  {
    id: "room.pet.harvest",
    title: "Harvest Pet",
    description: "Harvest pet production output.",
    bridgeCommand: "room.harvestPet",
    inputSchema: z.object({
      room_id: roomIdSchema,
      pet_id: z.number().int().positive()
    }),
    requiredCapabilities: ["room.pet.manage"],
    minimumTrustTier: "partner",
    risk: "medium"
  },
  {
    id: "room.furni.move",
    title: "Move Furniture",
    description: "Move floor furniture to coordinates and direction.",
    bridgeCommand: "room.moveFurniture",
    inputSchema: z.object({
      room_id: roomIdSchema,
      object_id: z.number().int().positive(),
      x: tileCoordinateSchema,
      y: tileCoordinateSchema,
      direction: z.number().int().min(0).max(7)
    }),
    requiredCapabilities: ["room.furni.manage"],
    minimumTrustTier: "partner",
    risk: "medium"
  },
  {
    id: "room.furni.rotate",
    title: "Rotate Furniture",
    description: "Rotate floor furniture object.",
    bridgeCommand: "room.rotateFurniture",
    inputSchema: z.object({
      room_id: roomIdSchema,
      object_id: z.number().int().positive(),
      direction: z.number().int().min(0).max(7)
    }),
    requiredCapabilities: ["room.furni.manage"],
    minimumTrustTier: "partner",
    risk: "medium"
  },
  {
    id: "room.furni.pickup",
    title: "Pickup Furniture",
    description: "Remove furniture object from room to inventory.",
    bridgeCommand: "room.pickupFurniture",
    inputSchema: z.object({
      room_id: roomIdSchema,
      object_id: z.number().int().positive()
    }),
    requiredCapabilities: ["room.furni.manage"],
    minimumTrustTier: "partner",
    risk: "medium"
  },
  {
    id: "room.furni.multistate",
    title: "Use Multi-State Furniture",
    description: "Trigger state toggle on multi-state furniture.",
    bridgeCommand: "room.useMultistateItem",
    inputSchema: z.object({
      room_id: roomIdSchema,
      object_id: z.number().int().positive()
    }),
    requiredCapabilities: ["room.furni.interact"],
    minimumTrustTier: "external",
    risk: "low"
  },
  {
    id: "room.furni.open_gift",
    title: "Open Gift",
    description: "Open present furniture item.",
    bridgeCommand: "room.openGift",
    inputSchema: z.object({
      room_id: roomIdSchema,
      object_id: z.number().int().positive()
    }),
    requiredCapabilities: ["room.furni.interact"],
    minimumTrustTier: "external",
    risk: "low"
  },
  {
    id: "room.furni.open_pet_package",
    title: "Open Pet Package",
    description: "Open pet package with selected pet name.",
    bridgeCommand: "room.sendOpenPetPackageMessage",
    inputSchema: z.object({
      room_id: roomIdSchema,
      object_id: z.number().int().positive(),
      pet_name: z.string().trim().min(1).max(32)
    }),
    requiredCapabilities: ["room.furni.interact", "room.pet.manage"],
    minimumTrustTier: "partner",
    risk: "medium"
  },
  {
    id: "room.trade.open",
    title: "Open Trade",
    description: "Open a trade session with a room user.",
    bridgeCommand: "room.openTrade",
    inputSchema: z.object({
      room_id: roomIdSchema,
      user_id: userIdSchema
    }),
    requiredCapabilities: ["room.trade.manage"],
    minimumTrustTier: "partner",
    risk: "medium"
  },
  {
    id: "room.trade.accept",
    title: "Accept Trade",
    description: "Accept current trade offer.",
    bridgeCommand: "room.acceptTrade",
    inputSchema: z.object({
      room_id: roomIdSchema
    }),
    requiredCapabilities: ["room.trade.manage"],
    minimumTrustTier: "partner",
    risk: "medium"
  },
  {
    id: "room.trade.cancel",
    title: "Cancel Trade",
    description: "Cancel current trade session.",
    bridgeCommand: "room.cancelTrade",
    inputSchema: z.object({
      room_id: roomIdSchema
    }),
    requiredCapabilities: ["room.trade.manage"],
    minimumTrustTier: "partner",
    risk: "low"
  },
  {
    id: "room.queue.change",
    title: "Change Queue",
    description: "Switch queue/teleport queue target.",
    bridgeCommand: "room.changeQueue",
    inputSchema: z.object({
      room_id: roomIdSchema,
      target_queue: z.number().int().min(0).max(50)
    }),
    requiredCapabilities: ["room.queue.change"],
    minimumTrustTier: "external",
    risk: "low"
  },
  {
    id: "room.bot.command",
    title: "Run Bot Command",
    description: "Send command payload to rentable bot automation.",
    bridgeCommand: "room.botSkillSave",
    inputSchema: z.object({
      room_id: roomIdSchema,
      bot_id: z.number().int().positive(),
      skill_type: z.number().int().min(0).max(1000),
      value: z.string().max(300).optional().default("")
    }),
    requiredCapabilities: ["room.bot.manage"],
    minimumTrustTier: "partner",
    risk: "medium"
  },
  {
    id: "room.bot.remove",
    title: "Remove Bot",
    description: "Remove a bot from room.",
    bridgeCommand: "room.botRemove",
    inputSchema: z.object({
      room_id: roomIdSchema,
      bot_id: z.number().int().positive()
    }),
    requiredCapabilities: ["room.bot.manage"],
    minimumTrustTier: "partner",
    risk: "high"
  },
  {
    id: "room.alert.ambassador",
    title: "Send Ambassador Alert",
    description: "Send ambassador alert for user moderation workflows.",
    bridgeCommand: "room.sendAmbassadorAlertMessage",
    inputSchema: z.object({
      room_id: roomIdSchema,
      user_id: userIdSchema
    }),
    requiredCapabilities: ["room.mod.kick"],
    minimumTrustTier: "internal",
    risk: "critical"
  },
  {
    id: "room.navigation.goto",
    title: "Go To Room",
    description: "Navigate client to another room ID.",
    bridgeCommand: "room.gotoRoom",
    inputSchema: z.object({
      room_id: roomIdSchema
    }),
    requiredCapabilities: ["workspace.read"],
    minimumTrustTier: "external",
    risk: "low"
  },
  {
    id: "room.navigation.follow_friend",
    title: "Follow Friend",
    description: "Follow friend to their active room.",
    bridgeCommand: "room.followFriend",
    inputSchema: z.object({
      friend_id: z.number().int().positive()
    }),
    requiredCapabilities: ["workspace.read"],
    minimumTrustTier: "external",
    risk: "medium"
  },
  {
    id: "room.floorplan.update",
    title: "Update Floorplan Properties",
    description: "Update room floorplan and wall height settings.",
    bridgeCommand: "room.updateFloorProperties",
    inputSchema: z.object({
      room_id: roomIdSchema,
      wall_thickness: z.number().int().min(-2).max(2),
      floor_thickness: z.number().int().min(-2).max(2),
      wall_height: z.number().int().min(0).max(64),
      fixed_walls: z.boolean().default(false)
    }),
    requiredCapabilities: ["room.settings.manage"],
    minimumTrustTier: "internal",
    risk: "high"
  },
  {
    id: "hotel.user.relationship.set",
    title: "Set Relationship Status",
    description: "Set relationship status for a user profile.",
    bridgeCommand: "hotel.setRelationshipStatus",
    inputSchema: z.object({
      user_id: userIdSchema,
      relationship: z.number().int().min(0).max(3)
    }),
    requiredCapabilities: ["workspace.write"],
    minimumTrustTier: "external",
    risk: "low"
  },
  {
    id: "hotel.user.motto.set",
    title: "Set Motto",
    description: "Set the active user motto string.",
    bridgeCommand: "room.sendMottoMessage",
    inputSchema: z.object({
      motto: z.string().trim().min(1).max(64)
    }),
    requiredCapabilities: ["workspace.write"],
    minimumTrustTier: "external",
    risk: "low"
  }
] as const satisfies ReadonlyArray<ActionDefinition>;

export const ACTION_CATALOG: Readonly<Record<string, ActionDefinition>> = Object.freeze(
  actionCatalog.reduce<Record<string, ActionDefinition>>((accumulator, definition) => {
    accumulator[definition.id] = definition;

    return accumulator;
  }, {})
);

export const ACTION_CATALOG_LIST: ReadonlyArray<ActionDefinition> = Object.freeze([...actionCatalog]);

export function getActionDefinition(actionId: string): ActionDefinition | null {
  return ACTION_CATALOG[actionId] ?? null;
}
