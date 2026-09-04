import {
  assertMusicSource,
  assertPartyParticipant,
  cancelHostTransfer,
  claimHostTransfer,
  createRoom,
  guessSubmitter,
  hostControl,
  joinParty,
  reactToCurrent,
  readParty,
  recordFlair,
  readRoomSummary,
  prepareHostTransfer,
  renameParty,
  recordBooSkipProgress,
  removePendingTrack,
  setParticipantAvatar,
  setParticipantName,
  setQueueMode,
  setRevealPickers,
  setRoomPasscode,
  setRoundTheme,
  shieldCurrentSong,
  submitTrack,
} from "../../../db/party";
import type { PartyAction, PartyRequest } from "../../../lib/party-contract";
import { PublicError } from "../../../lib/public-error";
import { protectPartyAction, protectRoomCreation } from "../../../lib/room-creation-guard";
import { resolveTrack, trackSource, type ResolvedTrack } from "../../../lib/track-link";

export function partyActionFallback(action?: PartyAction) {
  if (action === "create") return "We could not create the room right now. Wait a moment and try again.";
  if (action === "join") return "We could not join the room. Check the room code and passcode, then try again.";
  if (action === "submit") return "We could not check that song right now. Check the Spotify or YouTube link and try again in a moment.";
  if (action === "react") return "Your reaction did not go through. Check your connection and try again.";
  if (action === "remove") return "We could not remove that song. Refresh your list and try again.";
  if (action === "avatar") return "Your party face did not change. Try another emoji.";
  if (action === "profileName") return "Your party name did not change. Your previous masterpiece is still intact.";
  if (action === "rename") return "We could not rename the event. The current name is still safely intact.";
  if (action === "passcode") return "We could not update the room passcode. Try again—the current passcode is still active.";
  if (action === "prepareHostTransfer") return "We could not prepare the host handoff. The current host still has control.";
  if (action === "cancelHostTransfer") return "We could not cancel the host handoff. Create a new handoff link to replace it.";
  if (action === "claimHost") return "That host handoff could not be accepted. Ask the current host for a fresh link.";
  if (action === "queueMode") return "We could not change the queue mode. Refresh the host page and try again.";
  if (action === "flair") return "That emoji did not reach the host screen. Try again.";
  if (action === "shield") return "The shield did not activate. Try again while your song is still playing.";
  if (action === "guess") return "Your guess did not go through. Try again.";
  if (action === "theme") return "The theme did not save. Try again.";
  if (action === "revealPickers") return "The reveal setting did not save. Try again.";
  return "That host action did not finish. Refresh the host page and try again.";
}

type ActionResult = {
  status?: number;
  body: Record<string, unknown>;
};

function invalidAction(): never {
  throw new PublicError("Invalid party action.");
}

export async function executePartyAction(request: Request, input: PartyRequest): Promise<ActionResult> {
  const code = input.code ?? "";
  const participantId = input.participantId ?? "";
  let skipped = false;
  let shieldAbsorbed = false;
  let boosted = false;
  let submittedTrack: ResolvedTrack | undefined;

  switch (input.action) {
    case "create": {
      if (!input.title || !input.name || !input.passcode) invalidAction();
      await protectRoomCreation(request, input.website);
      const room = await createRoom(input.title, input.name, {
        passcode: input.passcode,
        musicSource: input.musicSource,
        preParty: input.preParty,
        scheduledFor: input.scheduledFor,
      });
      return { status: 201, body: { room } };
    }
    case "join":
      if (!input.name) invalidAction();
      await protectPartyAction(request, input.action, code);
      await joinParty(code, participantId, input.name, input.passcode ?? "");
      break;
    case "react":
      if (!input.kind) invalidAction();
      await protectPartyAction(request, input.action, code, participantId);
      ({ skipped, shieldAbsorbed, boosted } = await reactToCurrent(code, participantId, input.kind, Boolean(input.boost), input.trackId ?? ""));
      break;
    case "flair":
      if (!input.emoji) invalidAction();
      await protectPartyAction(request, input.action, code, participantId);
      await recordFlair(code, participantId, input.emoji);
      break;
    case "shield":
      await protectPartyAction(request, input.action, code, participantId);
      await shieldCurrentSong(code, participantId);
      break;
    case "guess":
      if (!input.guessParticipantId) invalidAction();
      await protectPartyAction(request, input.action, code, participantId);
      await guessSubmitter(code, participantId, input.guessParticipantId);
      break;
    case "revealPickers":
      if (typeof input.revealPickers !== "boolean" || !input.pin) invalidAction();
      await protectPartyAction(request, input.action, code);
      await setRevealPickers(code, input.pin, input.revealPickers);
      break;
    case "theme":
      if (typeof input.theme !== "string" || !input.pin) invalidAction();
      await protectPartyAction(request, input.action, code);
      await setRoundTheme(code, input.pin, input.theme);
      break;
    case "submit": {
      const trackReference = input.trackUrl ?? input.track?.id;
      if (!trackReference) invalidAction();
      await protectPartyAction(request, input.action, code, participantId);
      await assertPartyParticipant(code, participantId);
      if (trackReference.length > 512) throw new PublicError("That link is too long. Copy the song link directly from Spotify or YouTube and try again.");
      const roomSummary = await readRoomSummary(code);
      assertMusicSource(roomSummary.musicSource, trackSource(trackReference) ?? roomSummary.musicSource);
      submittedTrack = await resolveTrack(trackReference);
      await submitTrack(code, participantId, submittedTrack);
      break;
    }
    case "remove":
      if (!input.submissionId) invalidAction();
      await protectPartyAction(request, input.action, code, participantId);
      await removePendingTrack(code, participantId, input.submissionId);
      break;
    case "avatar":
      if (!input.avatarEmoji) invalidAction();
      await protectPartyAction(request, input.action, code, participantId);
      await setParticipantAvatar(code, participantId, input.avatarEmoji);
      break;
    case "profileName":
      if (!input.name) invalidAction();
      await protectPartyAction(request, input.action, code, participantId);
      await setParticipantName(code, participantId, input.name);
      break;
    case "start":
    case "skip":
    case "advance":
    case "end":
      if (!input.pin) invalidAction();
      await protectPartyAction(request, input.action, code);
      await hostControl(code, input.pin, input.action);
      break;
    case "queueMode":
      if (!input.queueMode || !input.pin) invalidAction();
      await protectPartyAction(request, input.action, code);
      await setQueueMode(code, input.pin, input.queueMode);
      break;
    case "rename":
      if (!input.title || !input.pin) invalidAction();
      await protectPartyAction(request, input.action, code);
      await renameParty(code, input.pin, input.title);
      break;
    case "passcode":
      if (!input.passcode || !input.pin) invalidAction();
      await protectPartyAction(request, input.action, code);
      await setRoomPasscode(code, input.pin, input.passcode);
      break;
    case "prepareHostTransfer": {
      if (!input.pin || !input.targetParticipantId) invalidAction();
      await protectPartyAction(request, input.action, code);
      const transfer = await prepareHostTransfer(code, participantId, input.pin, input.targetParticipantId);
      return { body: { party: await readParty(code, participantId, input.pin), transfer } };
    }
    case "cancelHostTransfer":
      if (!input.pin) invalidAction();
      await protectPartyAction(request, input.action, code);
      await cancelHostTransfer(code, input.pin);
      break;
    case "claimHost": {
      if (!input.transferToken) invalidAction();
      await protectPartyAction(request, input.action, code, participantId);
      const nextHostKey = await claimHostTransfer(code, participantId, input.transferToken);
      return { body: { party: await readParty(code, participantId, nextHostKey), hostKey: nextHostKey } };
    }
    case "skipProgress":
      if (!input.trackId || typeof input.skipPercent !== "number" || !input.pin) invalidAction();
      await protectPartyAction(request, input.action, code);
      await recordBooSkipProgress(code, input.pin, input.trackId, input.skipPercent);
      break;
    default:
      invalidAction();
  }

  return { body: { party: await readParty(code, participantId, input.pin), skipped, shieldAbsorbed, boosted, submittedTrack } };
}
