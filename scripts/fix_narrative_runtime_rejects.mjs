import { readFile, writeFile } from "node:fs/promises";

const path = "supabase/functions/online-runtime-tick/index.ts";
let source = await readFile(path, "utf8");

function replaceOnce(label, before, after) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing runtime patch anchor: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Ambiguous runtime patch anchor: ${label}`);
  }
  source = `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

replaceOnce(
  "director suppression result",
  "      if (stepsOnMoment(dirMem, priority)) return;",
  "      if (stepsOnMoment(dirMem, priority)) return \"memory_only\";",
);
replaceOnce(
  "duplicate suppression result",
  "        if (dup) return;",
  "        if (dup) return \"memory_only\";",
);
replaceOnce(
  "speaker cooldown result",
  "        if (lastMine?.created_at && Date.now() - new Date(lastMine.created_at).getTime() < 15000) return;",
  "        if (lastMine?.created_at && Date.now() - new Date(lastMine.created_at).getTime() < 15000) return \"memory_only\";",
);

replaceOnce(
  "settlement moment packet",
  "    const boardCards = Array.isArray(hand?.board_cards) ? hand.board_cards : [];\n    const { events: memEvents, aftermath } = classifySettle({ players: settlePlayers, boardCards, potBb, handNo });\n    // Emotions and relationships update FIRST",
  `    const boardCards = Array.isArray(hand?.board_cards) ? hand.board_cards : [];
    const { events: memEvents, aftermath } = classifySettle({ players: settlePlayers, boardCards, potBb, handNo });
    const sourceEventSeq = events.reduce((max: number, event: any) => Math.max(max, Number(event?.seq || 0)), 0);
    const settleSummary = aftermath.kind === "hero_call"
      ? \`${"${aftermath.winnerName || \"the caller\"}"}'s hero call on ${"${aftermath.caughtName || \"the bluffer\"}"} in a ${"${Math.round(potBb)}"}bb pot\`
      : aftermath.kind === "bluff_called"
        ? \`${"${aftermath.caughtName || \"the bluffer\"}"}'s bluff getting shown in a ${"${Math.round(potBb)}"}bb pot\`
        : aftermath.kind === "cooler"
          ? \`${"${aftermath.winnerName || \"the winner\"}"} cooling ${"${aftermath.loserName || \"the loser\"}"} in a ${"${Math.round(potBb)}"}bb pot\`
          : \`${"${aftermath.winnerName || \"the winner\"}"} taking a ${"${Math.round(potBb)}"}bb pot\`;
    const settleMoment = freezeNarrativeMoment({
      sourceHandId: handId,
      sourceEventSeq,
      sourcePhase: "settle_result",
      momentType: aftermath.kind,
      street: boardCards.length >= 5 ? "river" : boardCards.length === 4 ? "turn" : boardCards.length >= 3 ? "flop" : "preflop",
      potBb,
      actor: { name: aftermath.winnerName || null, action: "win" },
      opponent: { name: aftermath.caughtName || aftermath.loserName || null },
      result: {
        winner: aftermath.winnerName || null,
        loser: aftermath.loserName || null,
        caughtBluff: aftermath.caughtName || null,
        winnerLabel: aftermath.winnerLabel || null,
        loserLabel: aftermath.loserLabel || null,
      },
      board: boardCards,
      contextSummary: settleSummary,
      callbackEligible: true,
    }, { immediateMs: 18_000, callbackMs: 90_000 });
    const settlePrivateMoment = freezeNarrativeMoment({ ...settleMoment, callbackEligible: false });
    // Emotions and relationships update FIRST`,
);

replaceOnce(
  "settlement primary delivery",
  "          await onlineClient.postBotChat({ tableId, groupPlayerId: speaker.groupPlayerId, message: line, voice: true, character: speaker.characterId, mood, priority: 2 });",
  "          await onlineClient.postBotChat({ tableId, groupPlayerId: speaker.groupPlayerId, message: line, voice: true, character: speaker.characterId, mood, priority: 2, moment: settleMoment });",
);
replaceOnce(
  "settlement comeback delivery",
  "              await onlineClient.postBotChat({ tableId, groupPlayerId: rival.groupPlayerId, message: comeback, voice: true, character: String(rival.botCharacter), mood: \"banter\", priority: 3 });",
  "              await onlineClient.postBotChat({ tableId, groupPlayerId: rival.groupPlayerId, message: comeback, voice: true, character: String(rival.botCharacter), mood: \"banter\", priority: 3, moment: settleMoment });",
);

replaceOnce(
  "mid-hand delivery classification",
  `              character: String(actingSeat.bot_character),
              mood: "needle",
              priority: 3,
            });
            // Clap-back from another seated character`,
  `              character: String(actingSeat.bot_character),
              mood: "needle",
              priority: 3,
              moment: midHandMoment,
            });
            if (deliveryMode === "memory_only") return;
            noteNeedle(memMid, String(target.name));
            saveTableMemory(onlineClient.client, tableId, memMid);
            // Clap-back from another seated character`,
);

replaceOnce(
  "mid-hand private thought packet",
  "      const mem = await loadTableMemory(onlineClient.client, tableId);\n      const streetForThought = String(liveHand?.state || hand.state || \"the hand\");\n      const actionWord =",
  `      const mem = await loadTableMemory(onlineClient.client, tableId);
      const streetForThought = String(liveHand?.state || hand.state || "the hand");
      const thoughtMoment = freezeNarrativeMoment({
        ...midHandMomentBase,
        contextSummary: \`${"${narrativeActorName}"}'s ${"${decision.actionType}"} on the ${"${narrativeStreet}"} in a ${"${Math.round(narrativePotBb)}"}bb pot\`,
        callbackEligible: false,
      }, { now: midHandMomentBase.createdAt, immediateMs: 8_000, callbackMs: 8_000 });
      const actionWord =`,
);

await writeFile(path, source);
console.log("applied rejected narrative runtime hunks");
