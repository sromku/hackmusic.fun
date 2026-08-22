import { hostControl, joinParty, reactToCurrent, readParty, submitTrack } from "../../../db/party";

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected party error.";
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code") ?? "LIME-42";
    const participantId = url.searchParams.get("participantId") ?? "p-you";
    return Response.json({ party: await readParty(code, participantId) });
  } catch (error) {
    return Response.json({ error: messageFrom(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      action?: "join" | "react" | "submit" | "skip" | "end";
      code?: string;
      participantId?: string;
      kind?: "up" | "down";
      pin?: string;
      name?: string;
      track?: { id: string; title: string; artist: string; duration: string; color: string };
    };
    const code = body.code ?? "LIME-42";
    const participantId = body.participantId ?? "p-you";
    let skipped = false;

    if (body.action === "join" && body.name) {
      await joinParty(code, participantId, body.name);
    } else if (body.action === "react" && body.kind) {
      ({ skipped } = await reactToCurrent(code, participantId, body.kind));
    } else if (body.action === "submit" && body.track) {
      await submitTrack(code, participantId, body.track);
    } else if ((body.action === "skip" || body.action === "end") && body.pin) {
      await hostControl(code, body.pin, body.action);
    } else {
      return Response.json({ error: "Invalid party action." }, { status: 400 });
    }

    return Response.json({ party: await readParty(code, participantId), skipped });
  } catch (error) {
    const message = messageFrom(error);
    const status = message.includes("Wrong host") ? 403 : message.includes("cannot") || message.includes("already") || message.includes("valid") ? 400 : 500;
    return Response.json({ error: message }, { status });
  }
}
