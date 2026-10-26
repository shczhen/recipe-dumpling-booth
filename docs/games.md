# Five games at the dumpling counter

[简体中文](games.zh-CN.md)

These games turn a short voice demo into something a visitor can join without reading a screen full of instructions. Hu Jiaoman can guess wrong, brag, get caught out, and ask for another round. The fun comes from the exchange.

Staff can choose a game or leave the selection on **Random**. The server saves that choice and its greeting once when the session starts. Retrying Start does not pick a new game.

The prompts set the rules. There is **no application scorekeeper**: the model and visitor handle wins, disputes, hints, and rematches in conversation. Gift allocation is separate. Everyone whose greeting starts gets one gift; winning does not improve the odds.

The short exchanges below are **illustrative examples**, not recorded transcripts or lines enforced by the prompts.

## Twenty questions

**ID:** `twenty-questions`

Hu Jiaoman thinks of a familiar object. Ask up to twenty yes-or-no questions, narrow it down, and guess. The answer should stay fixed for the round. You can ask for a hint, give up, or swap roles and make her guess your object.

> Guest: Is it something you use in a kitchen?
>
> Hu Jiaoman: Yes. Convenient place to start, considering where you're standing.
>
> Guest: Does it have a handle?
>
> Hu Jiaoman: It does. Now we're getting somewhere.
>
> Guest: A frying pan?
>
> Hu Jiaoman: Got it in three! Your turn. Pick something harder.

It works because each question gives the guest a small decision. To change the difficulty, narrow the category in the prompt, for example to kitchen tools or animals. Do not add a visible question counter unless you also implement reliable scoring.

## Describe and guess

**ID:** `describe-and-guess`

Think of an object and describe it without naming it. The host can guess or ask a short question. Confirm the answer, give another clue, or swap roles.

> Guest: You open it over your head, but it's useless indoors.
>
> Hu Jiaoman: An umbrella. Unless your roof's leaking?
>
> Guest: Too easy. You do one.
>
> Hu Jiaoman: Tiny teeth, lives in your pocket, opens a door. And no, it's not a very talented mouse.

Good clues invite an answer in a single breath. For an event theme, suggest a shared category while allowing the guest to choose something else.

## Food chain

**ID:** `food-chain`

Take turns naming foods. No repeats. This is **not** a last-letter word game. If a dish sounds suspicious, challenge it and let the other person explain. A repeat or a blank can end the round; then play again.

> Hu Jiaoman: Dumplings. Obviously.
>
> Guest: Pizza.
>
> Hu Jiaoman: Mapo tofu.
>
> Guest: Fried ice cream.
>
> Hu Jiaoman: Wait, that one sounds made up. How does it survive the fryer?

Unusual dishes create room for friendly arguments. Keep the no-repeat rule in the prompt; the application does not maintain an authoritative list of foods.

## Story chain

**ID:** `story-chain`

Build a story together, one sentence at a time. Pick up what the other person just introduced and add something. There is no winner. Finish the story when it feels right, or start a new one.

> Hu Jiaoman: This morning, a dumpling rolled out of my kitchen wearing sunglasses.
>
> Guest: It said it was late for a job interview.
>
> Hu Jiaoman: I asked where. It said, “The soup department.”
>
> Guest: That's when we realized it had brought its own spoon.

A concrete opening gives the guest something easy to continue. Replace the opening theme to fit your own character; avoid writing a complete plot in advance.

## Wrong answers

**ID:** `wrong-answers`

Take turns asking questions. Reply with something unrelated. If either player answers normally, they lose that round. Acknowledge it and start another round; the visit continues.

> Hu Jiaoman: What did you have for breakfast?
>
> Guest: My bicycle has excellent manners.
>
> Hu Jiaoman: Strong start. Your question.
>
> Guest: How many dumplings are on that plate?
>
> Hu Jiaoman: Six—oh, you got me. I walked straight into that.

This is quick to explain and easy to trip over. The host should admit a normal answer instead of inventing an excuse to win.

## Adapt a game

Edit [the game prompts](../src/server/prompts/games.ts), with English and Chinese rules and greetings together. Names and short staff hints live in [shared game metadata](../src/shared/games.ts). The shared [host prompt](../src/server/prompts/host.ts) supplies personality and the gift timing boundary.

Keep instructions short enough to leave space for conversation. Test both languages, interruptions, hints, role swaps, mistakes, and a request to leave. A game round ending must not end the whole visit or allocate another gift.
