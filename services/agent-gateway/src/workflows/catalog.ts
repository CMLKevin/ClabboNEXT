import {WorkflowDefinition} from "./types.js";

const workflowCatalog = [
  {
    id: "room.onboarding.greeter",
    title: "Room Greeter Onboarding",
    description: "Greets a new user, signals attention, and posts a welcome orientation prompt.",
    requiredCapabilities: ["room.chat.send", "room.chat.whisper", "room.user.expression"],
    minimumTrustTier: "external",
    risk: "low",
    steps: [
      {
        id: "wave",
        actionId: "room.user.expression",
        mode: "execute",
        haltOnError: false,
        inputTemplate: {
          room_id: "{{payload.room_id}}",
          expression: 1
        }
      },
      {
        id: "greet-public",
        actionId: "room.chat.send",
        mode: "execute",
        haltOnError: true,
        inputTemplate: {
          room_id: "{{payload.room_id}}",
          text: "{{payload.public_welcome_text}}",
          style_id: "{{payload.style_id}}"
        }
      },
      {
        id: "guide-private",
        actionId: "room.chat.whisper",
        mode: "execute",
        haltOnError: false,
        inputTemplate: {
          room_id: "{{payload.room_id}}",
          recipient_name: "{{payload.recipient_name}}",
          text: "{{payload.private_hint_text}}",
          style_id: "{{payload.style_id}}"
        }
      }
    ]
  },
  {
    id: "room.event.poll.launch",
    title: "Event Poll Launch",
    description: "Announces and starts an in-room poll with optional kickoff chat.",
    requiredCapabilities: ["room.poll.manage", "room.chat.shout"],
    minimumTrustTier: "partner",
    risk: "medium",
    steps: [
      {
        id: "announce",
        actionId: "room.chat.shout",
        mode: "execute",
        haltOnError: false,
        inputTemplate: {
          room_id: "{{payload.room_id}}",
          text: "{{payload.announcement_text}}",
          style_id: "{{payload.style_id}}"
        }
      },
      {
        id: "start-poll",
        actionId: "room.poll.start",
        mode: "execute",
        haltOnError: true,
        inputTemplate: {
          room_id: "{{payload.room_id}}",
          poll_id: "{{payload.poll_id}}"
        }
      }
    ]
  },
  {
    id: "room.moderation.soft-lockdown",
    title: "Moderation Soft Lockdown",
    description: "Warns, then mutes a disruptive user with approval metadata.",
    requiredCapabilities: ["room.chat.whisper", "room.mod.mute"],
    minimumTrustTier: "partner",
    risk: "high",
    steps: [
      {
        id: "warn-user",
        actionId: "room.chat.whisper",
        mode: "execute",
        haltOnError: false,
        inputTemplate: {
          room_id: "{{payload.room_id}}",
          recipient_name: "{{payload.recipient_name}}",
          text: "{{payload.warning_text}}",
          style_id: "{{payload.style_id}}"
        }
      },
      {
        id: "mute-user",
        actionId: "room.user.mute",
        mode: "execute",
        haltOnError: true,
        inputTemplate: {
          room_id: "{{payload.room_id}}",
          user_id: "{{payload.user_id}}",
          minutes: "{{payload.minutes}}"
        },
        metadataTemplate: {
          approved_by_human: "{{payload.approved_by_human}}",
          approval_ticket: "{{payload.approval_ticket}}"
        }
      }
    ]
  },
  {
    id: "room.pet.care-cycle",
    title: "Pet Care Cycle",
    description: "Feeds product to pet then harvests it.",
    requiredCapabilities: ["room.pet.manage"],
    minimumTrustTier: "partner",
    risk: "medium",
    steps: [
      {
        id: "use-product",
        actionId: "room.pet.use_product",
        mode: "execute",
        haltOnError: true,
        inputTemplate: {
          room_id: "{{payload.room_id}}",
          item_id: "{{payload.item_id}}",
          pet_id: "{{payload.pet_id}}"
        }
      },
      {
        id: "harvest",
        actionId: "room.pet.harvest",
        mode: "execute",
        haltOnError: false,
        inputTemplate: {
          room_id: "{{payload.room_id}}",
          pet_id: "{{payload.pet_id}}"
        }
      }
    ]
  },
  {
    id: "room.rights.rotate",
    title: "Room Rights Rotation",
    description: "Revoke and re-grant rights for controlled rights reset flows.",
    requiredCapabilities: ["room.rights.revoke", "room.rights.grant"],
    minimumTrustTier: "partner",
    risk: "high",
    steps: [
      {
        id: "revoke-rights",
        actionId: "room.rights.revoke",
        mode: "execute",
        haltOnError: true,
        inputTemplate: {
          room_id: "{{payload.room_id}}",
          user_id: "{{payload.user_id}}"
        },
        metadataTemplate: {
          approved_by_human: "{{payload.approved_by_human}}",
          approval_ticket: "{{payload.approval_ticket}}"
        }
      },
      {
        id: "grant-rights",
        actionId: "room.rights.grant",
        mode: "execute",
        haltOnError: false,
        inputTemplate: {
          room_id: "{{payload.room_id}}",
          user_id: "{{payload.user_id}}"
        },
        metadataTemplate: {
          approved_by_human: "{{payload.approved_by_human}}",
          approval_ticket: "{{payload.approval_ticket}}"
        }
      }
    ]
  },
  {
    id: "hotel.profile.motto-refresh",
    title: "Profile Motto Refresh",
    description: "Updates motto and confirms via room chat.",
    requiredCapabilities: ["workspace.write", "room.chat.send"],
    minimumTrustTier: "external",
    risk: "low",
    steps: [
      {
        id: "set-motto",
        actionId: "hotel.user.motto.set",
        mode: "execute",
        haltOnError: true,
        inputTemplate: {
          motto: "{{payload.motto}}"
        }
      },
      {
        id: "announce",
        actionId: "room.chat.send",
        mode: "execute",
        haltOnError: false,
        inputTemplate: {
          room_id: "{{payload.room_id}}",
          text: "{{payload.confirmation_text}}",
          style_id: "{{payload.style_id}}"
        }
      }
    ]
  }
] as const satisfies ReadonlyArray<WorkflowDefinition>;

export const WORKFLOW_CATALOG = Object.freeze(
  workflowCatalog.reduce<Record<string, WorkflowDefinition>>((accumulator, workflow) => {
    accumulator[workflow.id] = workflow;
    return accumulator;
  }, {})
);

export const WORKFLOW_CATALOG_LIST = Object.freeze([...workflowCatalog]);

export function getWorkflowDefinition(workflowId: string): WorkflowDefinition | null {
  return WORKFLOW_CATALOG[workflowId] ?? null;
}
